import type { D1DatabaseLike } from './types';
import { pausedAtColumn, pauseSupported, shownToSubscriber } from './feedPause';
import type { ArticleItem, FolderItem } from '../client/api';
import type { ReaderSyncCursor, ReaderSyncDelta, SubscriptionCounts, SubscriptionMetadata } from '../shared/readerSync';
import { articleBlockCountFilter } from './articleBlocks';
import type { ArticleBlockRule } from '../shared/articleBlocks';

const DAY = 86400_000;
// 계정의 저장 목록에서 시작해 피드별 개수를 한 번만 센다.
export const savedCountsJoin = (visible: string) => `LEFT JOIN (
  SELECT a.feed_id, COUNT(*) AS saved_count
  FROM article_states st CROSS JOIN articles a ON a.id=st.article_id
  WHERE st.user_id=? AND st.is_saved=1 AND ${visible}
  GROUP BY a.feed_id
) saved ON saved.feed_id=s.feed_id`;

export async function syncHead(db: D1DatabaseLike) {
  return (await db.prepare(`SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='reader_sync_changes'),0) AS sequence, (SELECT floor FROM reader_sync_meta WHERE id=1) AS floor`).first<{ sequence: number; floor: number }>())!;
}
async function nextBoundary(db: D1DatabaseLike, userId: string, now: number) {
  const rows = await db.prepare(`SELECT
    (SELECT MIN(a.published_at) FROM articles a WHERE a.feed_id=s.feed_id AND a.published_at>=?) AS today,
    (SELECT MIN(a.published_at) FROM articles a WHERE a.feed_id=s.feed_id AND a.published_at>=?) AS unread
    FROM subscriptions s WHERE s.user_id=?`).bind(new Date(now - DAY).toISOString(), new Date(now - 30 * DAY).toISOString(), userId).all<{ today: string | null; unread: string | null }>();
  let next = now + DAY;
  for (const row of rows.results) {
    if (row.today) next = Math.min(next, Date.parse(row.today) + DAY + 1);
    if (row.unread) next = Math.min(next, Date.parse(row.unread) + 30 * DAY + 1);
  }
  return Math.max(now + 1000, next);
}
export async function initialSyncCursor(db: D1DatabaseLike, userId: string, blockRevision = 0): Promise<ReaderSyncCursor> {
  const now = Date.now(), head = await syncHead(db);
  return { sequence: Number(head.sequence), checkedAt: now, nextBoundary: await nextBoundary(db, userId, now), account: userId, blockRevision };
}

type Change = { version: number; kind: string; entity_id: string; feed_id: string | null; operation: string };
const emptyDelta = (cursor: ReaderSyncCursor): ReaderSyncDelta => ({ cursor, changed: false, articles: [], articleChangedIds: [], removedIds: [], subscriptionCounts: [] });

export async function readerDelta(db: D1DatabaseLike, userId: string, input: unknown, blocks: { revision: number; rules: readonly ArticleBlockRule[] } = { revision: 0, rules: [] }): Promise<ReaderSyncDelta> {
  const now = Date.now(), head = await syncHead(db), cursor = input as ReaderSyncCursor | undefined;
  const fallback: ReaderSyncCursor = { sequence: Number(head.sequence), checkedAt: now, nextBoundary: now + DAY, account: userId, blockRevision: blocks.revision };
  if (!cursor || cursor.account !== userId || !Number.isSafeInteger(cursor.sequence) || cursor.sequence < Number(head.floor) || cursor.sequence > Number(head.sequence) || !Number.isFinite(cursor.checkedAt) || cursor.checkedAt < now - DAY || cursor.checkedAt > now + 60_000 || !Number.isFinite(cursor.nextBoundary)) {
    return { ...emptyDelta(fallback), reset: true };
  }
  const blocksChanged = (cursor.blockRevision ?? 0) !== blocks.revision;
  const nextCursor = { ...cursor, sequence: Number(head.sequence), checkedAt: now, blockRevision: blocks.revision };
  if (!blocksChanged && cursor.sequence === Number(head.sequence) && now < cursor.nextBoundary) return emptyDelta(nextCursor);

  const changes = (await db.prepare(`SELECT version,kind,entity_id,feed_id,operation FROM reader_sync_changes
      WHERE owner_id=? AND version>? AND version<=?
    UNION ALL
    SELECT c.version,c.kind,c.entity_id,c.feed_id,c.operation FROM reader_sync_changes c
      JOIN subscriptions s ON s.feed_id=c.feed_id AND s.user_id=?
      WHERE c.owner_id='' AND c.version>? AND c.version<=?
    ORDER BY version LIMIT 201`).bind(userId, cursor.sequence, head.sequence, userId, cursor.sequence, head.sequence).all<Change>()).results;
  // 오래 오프라인이었거나 한꺼번에 가져왔을 때는 기기가 남길 필요 없는 수천 개의 과거
  // 변경을 되풀이하지 않고 현재 스냅숏 하나를 쓴다.
  if (changes.length > 200) return { ...emptyDelta(nextCursor), reset: true };
  const affected = new Set<string>(), articleIds = new Set<string>(), removed = new Set<string>();
  // 규칙 변경은 이미 받아 둔 글 목록을 버리지 않고 모든 구독의 개수만 다시 계산한다.
  if (blocksChanged) {
    const { results } = await db.prepare('SELECT feed_id FROM subscriptions WHERE user_id=?').bind(userId).all<{ feed_id: string }>();
    results.forEach(({ feed_id }) => affected.add(feed_id));
  }
  const articleChanged = new Set<string>();
  let metadata = false, membership = false;
  for (const change of changes) {
    if (change.kind === 'article' || change.kind === 'state') {
      articleIds.add(change.entity_id);
      if (change.feed_id) affected.add(change.feed_id);
      if (change.kind === 'article') articleChanged.add(change.entity_id);
      if (change.kind === 'article' && change.operation === 'delete') removed.add(change.entity_id);
    } else {
      metadata = true;
      if (change.kind === 'subscription') { membership = true; if (change.feed_id) affected.add(change.feed_id); }
    }
  }
  if (now >= cursor.nextBoundary) {
    // 인덱스를 탄 좁은 날짜 범위로 24시간·30일 개수가 만료된 피드만 찾는다.
    const crossed = await db.prepare(`SELECT DISTINCT a.feed_id FROM articles a JOIN subscriptions s ON s.feed_id=a.feed_id
      WHERE s.user_id=? AND a.published_at>=? AND a.published_at<?
      UNION SELECT DISTINCT a.feed_id FROM articles a JOIN subscriptions s ON s.feed_id=a.feed_id
      WHERE s.user_id=? AND a.published_at>=? AND a.published_at<?`)
      .bind(userId, new Date(cursor.checkedAt - DAY).toISOString(), new Date(now - DAY).toISOString(), userId, new Date(cursor.checkedAt - 30 * DAY).toISOString(), new Date(now - 30 * DAY).toISOString()).all<{ feed_id: string }>();
    crossed.results.forEach((row) => affected.add(row.feed_id));
  }
  const delta = emptyDelta(nextCursor);
  delta.changed = changes.length > 0 || affected.size > 0;
  // 멈춘 피드가 숨기는 글은 아래에서 찾지 못하므로 기기가 지운다.
  const paused = await pauseSupported(db), shown = shownToSubscriber(paused);
  const ids = [...articleIds].filter((id) => !removed.has(id));
  for (let at = 0; at < ids.length; at += 40) {
    const chunk = ids.slice(at, at + 40);
    // CROSS JOIN으로 글 id부터 찾게 고정한다. 통계가 없으면 SQLite가 구독부터 읽어 글 40개를 찾으려고 전체를 훑는다.
    const rows = await db.prepare(`SELECT a.id,a.feed_id,COALESCE(s.custom_title,f.title) AS feed_title,
      f.favicon_url AS feed_favicon,f.html_url AS feed_html_url,s.folder_id,fl.name AS folder_name,
      a.guid,a.title,a.url,a.author,a.summary,a.ai_summary,a.thumbnail_url,a.published_at,a.created_at AS collected_at,
      CASE WHEN f.xml_url LIKE 'https://x.com/%' AND length(a.content_html)<=20000 THEN a.content_html END AS x_body,
      COALESCE(dc.source,'feed') AS date_source,
      COALESCE(st.is_read,CASE WHEN a.published_at<? THEN 1 ELSE 0 END) AS is_read,COALESCE(st.is_saved,0) AS is_saved
      FROM articles a CROSS JOIN subscriptions s ON s.feed_id=a.feed_id AND s.user_id=? JOIN feeds f ON f.id=a.feed_id
      LEFT JOIN folders fl ON fl.id=s.folder_id LEFT JOIN article_states st ON st.article_id=a.id AND st.user_id=s.user_id
      LEFT JOIN article_date_checks dc ON dc.article_id=a.id WHERE ${shown} AND a.id IN (${chunk.map(() => '?').join(',')})`)
      .bind(new Date(now - 30 * DAY).toISOString(), userId, ...chunk).all<Record<string, unknown>>();
    const found = new Set(rows.results.map((row) => String(row.id)));
    delta.newArticleIds ??= [];
    delta.newArticleIds.push(...rows.results.filter((row) => articleChanged.has(String(row.id)) && Date.parse(String(row.collected_at)) >= cursor.checkedAt && Date.parse(String(row.published_at)) >= now - DAY).map((row) => String(row.id)));
    chunk.forEach((id) => { if (!found.has(id)) removed.add(id); });
    // 본문은 글을 열 때 받는다. X 글은 짧고 X 타임라인이 본문(사진·영상·인용 글)으로 줄을 그리므로 함께 보낸다.
    delta.articles.push(...rows.results.map(({ x_body, ...row }) => ({ ...row,
      is_read: Boolean(Number(row.is_read)), is_saved: Boolean(Number(row.is_saved)),
      content_html: x_body ?? null, full_content_html: null, body_deferred: !x_body,
    } as unknown as ArticleItem)));
  }
  delta.removedIds = [...removed]; delta.articleChangedIds = [...articleChanged];
  const feeds = [...affected];
  const blockFilter = feeds.length || membership || blocksChanged ? await articleBlockCountFilter(db, userId, blocks.rules) : null;
  for (let at = 0; at < feeds.length; at += 40) {
    const chunk = feeds.slice(at, at + 40);
    const { cte, params, visible } = blockFilter!;
    const counts = await db.prepare(`${cte} SELECT s.feed_id,
      (SELECT COUNT(*) FROM articles a WHERE a.feed_id=s.feed_id AND ${shown} AND ${visible}) AS total_count,
      (SELECT COUNT(*) FROM articles a LEFT JOIN article_states st ON st.article_id=a.id AND st.user_id=s.user_id WHERE a.feed_id=s.feed_id AND a.published_at>=? AND COALESCE(st.is_read,0)=0 AND ${shown} AND ${visible}) AS unread_count,
      COALESCE(saved.saved_count,0) AS saved_count
      FROM subscriptions s ${savedCountsJoin(visible)}
      WHERE s.user_id=? AND s.feed_id IN (${chunk.map(() => '?').join(',')})`)
      .bind(...params, new Date(now - 30 * DAY).toISOString(), userId, userId, ...chunk).all<SubscriptionCounts>();
    delta.subscriptionCounts.push(...counts.results.map((row) => ({ ...row, total_count: Number(row.total_count), unread_count: Number(row.unread_count), saved_count: Number(row.saved_count) })));
  }
  if (metadata) {
    delta.folders = (await db.prepare('SELECT * FROM folders WHERE user_id=? ORDER BY sort_order,name').bind(userId).all<FolderItem>()).results;
    delta.subscriptions = (await db.prepare(`SELECT s.id,s.feed_id,s.folder_id,s.custom_title,${pausedAtColumn(paused)} AS paused_at,f.xml_url,f.html_url,
      COALESCE(s.custom_title,f.title) AS title,f.description,f.favicon_url,f.last_fetched_at,f.last_error,v.view_mode,(SELECT b.id FROM rss_builders b WHERE b.feed_id=s.feed_id AND b.created_by=s.user_id) AS builder_id
      FROM subscriptions s JOIN feeds f ON f.id=s.feed_id LEFT JOIN feed_view_modes v ON v.feed_id=s.feed_id AND v.user_id=s.user_id
      WHERE s.user_id=? ORDER BY title`).bind(userId).all<SubscriptionMetadata>()).results;
  }
  if (blockFilter) {
    const { cte, params, visible } = blockFilter;
    const today = await db.prepare(`${cte} SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN COALESCE(st.is_read,0)=0 THEN 1 ELSE 0 END),0) AS unread
      FROM articles a JOIN subscriptions s ON s.feed_id=a.feed_id LEFT JOIN article_states st ON st.article_id=a.id AND st.user_id=s.user_id
      WHERE s.user_id=? AND a.published_at>=? AND ${shown} AND ${visible}`).bind(...params, userId, new Date(now - DAY).toISOString()).first<{ total: number; unread: number }>();
    delta.today = { todayTotal: Number(today?.total || 0), todayCount: Number(today?.unread || 0) };
  }
  if (articleChanged.size || membership || now >= cursor.nextBoundary) nextCursor.nextBoundary = await nextBoundary(db, userId, now);
  return delta;
}

export async function pruneReaderChanges(db: D1DatabaseLike) {
  const head = await syncHead(db), floor = Number(head.sequence) - 50_000;
  if (floor <= Number(head.floor)) return;
  await db.batch([
    db.prepare('UPDATE reader_sync_meta SET floor=? WHERE id=1').bind(floor),
    db.prepare('DELETE FROM reader_sync_changes WHERE version<=?').bind(floor),
  ]);
}
