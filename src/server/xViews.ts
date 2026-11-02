import type { D1DatabaseLike } from './types';
import type { ArticleViewMode } from '../client/api';
import { isXProfileFeed } from '../shared/xFeed';

// 이 사용자가 구독한 X 계정 피드. 주소 모양은 SQL로 좁히고, 정확한 판단은 화면과 같은 함수로 한다.
export async function subscribedXFeedIds(db: D1DatabaseLike, userId: string): Promise<string[]> {
  const { results } = await db.prepare(
    `SELECT f.id, f.xml_url FROM subscriptions s JOIN feeds f ON f.id = s.feed_id
     WHERE s.user_id = ? AND f.xml_url LIKE 'https://x.com/%'`
  ).bind(userId).all<{ id: string; xml_url: string }>();
  return results.filter((row) => isXProfileFeed(row.xml_url)).map((row) => row.id);
}

// 한 X 계정에서 고른 보기를 구독 중인 모든 X 계정에 한 번의 쿼리로 저장한다.
export async function saveXView(db: D1DatabaseLike, userId: string, viewMode: ArticleViewMode): Promise<string[]> {
  const feedIds = await subscribedXFeedIds(db, userId);
  if (feedIds.length) {
    await db.prepare(
      `INSERT INTO feed_view_modes (user_id, feed_id, view_mode, updated_at)
       SELECT ?, value, ?, ? FROM json_each(?) WHERE true
       ON CONFLICT(user_id, feed_id) DO UPDATE SET view_mode = excluded.view_mode, updated_at = excluded.updated_at`
    ).bind(userId, viewMode, new Date().toISOString(), JSON.stringify(feedIds)).run();
  }
  return feedIds;
}

// 새로 구독한 X 계정은 다른 X 계정에 가장 최근에 고른 보기를 이어받는다. 이미 고른 보기는 덮어쓰지 않는다.
export async function inheritXView(db: D1DatabaseLike, userId: string, feedId: string): Promise<void> {
  const feed = await db.prepare('SELECT xml_url FROM feeds WHERE id = ?').bind(feedId).first<{ xml_url: string }>();
  if (!isXProfileFeed(feed?.xml_url)) return;
  const { results } = await db.prepare(
    `SELECT v.view_mode, f.xml_url FROM feed_view_modes v
     JOIN subscriptions s ON s.user_id = v.user_id AND s.feed_id = v.feed_id
     JOIN feeds f ON f.id = v.feed_id
     WHERE v.user_id = ? AND v.feed_id <> ? AND f.xml_url LIKE 'https://x.com/%'
     ORDER BY v.updated_at DESC LIMIT 20`
  ).bind(userId, feedId).all<{ view_mode: ArticleViewMode; xml_url: string }>();
  const view = results.find((row) => isXProfileFeed(row.xml_url))?.view_mode;
  if (!view) return;
  await db.prepare(
    `INSERT INTO feed_view_modes (user_id, feed_id, view_mode, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, feed_id) DO NOTHING`
  ).bind(userId, feedId, view, new Date().toISOString()).run();
}
