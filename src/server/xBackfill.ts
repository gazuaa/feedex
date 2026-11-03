import type { D1DatabaseLike } from './types';
import { parseXmlFeedContent, type ParsedFeed } from './rssParser';
import { fetchXOlderPage } from './xFeed';
import { saveFeedArticles } from './seedService';

// X 계정은 공개 미러 RSS가 최신 글 약 20개만 준다. 미러가 알려 주는 다음 쪽으로 예전 글을 채운다.
// 미러는 요청 한도가 빡빡하므로, 정기 새로고침 뒤에 몇 쪽씩만 천천히 받는다.
/** 첫 쪽을 포함해 계정마다 받는 쪽 수. 한 쪽은 약 20개다. */
export const X_BACKFILL_PAGES = 10;
/** 정기 새로고침 한 번에 보내는 다음 쪽 요청 수. */
const BACKFILL_REQUESTS = 10;
/** 새로고침 사이에 빠진 글을 채울 때 더 받는 쪽 수. */
const GAP_PAGES = 3;
/** 같은 쪽을 이만큼 연달아 받지 못하면 그 계정의 예전 글 채우기를 그만둔다. */
const MAX_FAILURES = 5;
const DAY = 86_400_000;

const support = new WeakMap<D1DatabaseLike, { supported: boolean; at: number }>();
/** 운영 DB에 migrations/0006_x_backfill.sql을 적용하기 전에는 예전 글 채우기만 쉬고, 빠진 글 채우기는 그대로 한다. */
export async function xBackfillSupported(db: D1DatabaseLike): Promise<boolean> {
  const known = support.get(db);
  if (known && (known.supported || Date.now() - known.at < 60_000)) return known.supported;
  const supported = await db.prepare('SELECT feed_id FROM x_backfill LIMIT 0').all().then(() => true, () => false);
  support.set(db, { supported, at: Date.now() });
  return supported;
}

/**
 * X 계정 피드를 새로고침한 뒤 부른다. 처음 보는 계정이면 예전 글을 받을 위치를 기억하고,
 * 받은 첫 쪽이 모두 새 글이면 지난 새로고침과의 사이에 빠진 글을 다음 쪽으로 채운다.
 */
export async function noteXFeed(db: D1DatabaseLike, feedId: string, parsed: ParsedFeed, insertedCount: number): Promise<void> {
  const start = parsed.xOlder;
  if (!start) return;
  if (await xBackfillSupported(db)) {
    await db.prepare('INSERT INTO x_backfill(feed_id,provider,cursor,pages,failures,updated_at) VALUES(?,?,?,1,0,?) ON CONFLICT(feed_id) DO NOTHING')
      .bind(feedId, start.provider, start.cursor, new Date(0).toISOString()).run();
  }
  if (!insertedCount || insertedCount < parsed.articles.length) return;
  // 처음 구독한 계정은 모든 글이 새 글이다. 그 전에 받아 둔 글이 있을 때만 빠진 구간이 있다.
  const stored = await db.prepare('SELECT COUNT(*) AS count FROM articles WHERE feed_id=?').bind(feedId).first<{ count: number }>();
  if (Number(stored?.count || 0) <= insertedCount) return;
  let page = start;
  for (let step = 0; step < GAP_PAGES; step++) {
    const result = await fetchXOlderPage(parsed.xmlUrl, page, parseXmlFeedContent);
    if (typeof result === 'string') return;
    const saved = await saveFeedArticles(db, feedId, result.articles);
    // 이미 받은 글이 나오면 빠진 구간을 다 채운 것이다.
    if (!result.older || saved.insertedCount < result.articles.length) return;
    page = result.older;
  }
}

/** 정기 새로고침 뒤에 돈다. 오래 기다린 계정부터 다음 쪽을 하나씩 받는다. */
export async function backfillXFeeds(db: D1DatabaseLike, requests = BACKFILL_REQUESTS): Promise<number> {
  if (!await xBackfillSupported(db)) return 0;
  const rows = await db.prepare(`SELECT x.feed_id,x.provider,x.cursor,f.xml_url FROM x_backfill x JOIN feeds f ON f.id=x.feed_id
    WHERE x.cursor IS NOT NULL AND x.pages<? AND EXISTS(SELECT 1 FROM subscriptions s WHERE s.feed_id=x.feed_id)
    ORDER BY x.updated_at ASC LIMIT ?`).bind(X_BACKFILL_PAGES, requests).all<{ feed_id: string; provider: string; cursor: string; xml_url: string }>();
  let inserted = 0;
  for (const row of rows.results || []) {
    const now = new Date().toISOString();
    const result = await fetchXOlderPage(row.xml_url, { provider: row.provider, cursor: row.cursor }, parseXmlFeedContent);
    // 미러가 한도를 알렸으면 이번에는 그만 받는다. 위치는 그대로 두고 다음에 이어 받는다.
    if (result === 'limited') break;
    if (result === 'failed') {
      await db.prepare(`UPDATE x_backfill SET failures=failures+1,cursor=CASE WHEN failures+1>=? THEN NULL ELSE cursor END,updated_at=? WHERE feed_id=?`)
        .bind(MAX_FAILURES, now, row.feed_id).run();
      continue;
    }
    const saved = await saveFeedArticles(db, row.feed_id, result.articles, now);
    inserted += saved.insertedCount;
    await markHistoryRead(db, row.feed_id, saved.insertedIds);
    await db.prepare('UPDATE x_backfill SET provider=?,cursor=?,pages=pages+1,failures=0,updated_at=? WHERE feed_id=?')
      .bind(result.older?.provider ?? row.provider, result.older?.cursor ?? null, now, row.feed_id).run();
  }
  return inserted;
}

// 뒤늦게 채운 예전 글은 새 글이 아니므로, 구독자에게 읽은 글로 둔다. 안 읽음 개수가 한꺼번에 불어나지 않는다.
// 30일보다 오래된 글은 원래 읽은 글로 보이므로 따로 적지 않는다.
async function markHistoryRead(db: D1DatabaseLike, feedId: string, ids: string[]) {
  const cutoff = new Date(Date.now() - 30 * DAY).toISOString(), now = new Date().toISOString();
  for (let at = 0; at < ids.length; at += 40) {
    const chunk = ids.slice(at, at + 40);
    await db.prepare(`INSERT INTO article_states(user_id,article_id,is_read,is_saved,read_at)
      SELECT s.user_id,a.id,1,0,? FROM subscriptions s JOIN articles a ON a.feed_id=s.feed_id
      WHERE s.feed_id=? AND a.published_at>=? AND a.id IN (${chunk.map(() => '?').join(',')})
      ON CONFLICT(user_id,article_id) DO NOTHING`).bind(now, feedId, cutoff, ...chunk).run();
  }
}
