import type { D1DatabaseLike } from './types';
import type { ParsedFeed } from './rssParser';
import { normalizeBlockTitle } from '../shared/articleBlocks';

export function generateId(prefix = ''): string {
  const uuid = crypto.randomUUID();
  return prefix ? `${prefix}_${uuid}` : uuid;
}

interface ExistingArticle {
  id: string;
  guid: string;
  date_source: string | null;
  published_at: string;
  created_at: string;
  no_thumbnail: number;
  no_content: number;
}

const FETCH_TIME_TOLERANCE_MS = 5 * 60_000;
const FUTURE_AT_FETCH_MS = 10 * 60_000;
const DATE_REPAIR_MIN_SHIFT_MS = 60 * 60_000;
const KST_OFFSET_MS = 9 * 60 * 60_000;

// 아래 upsert의 published_at CASE와 똑같이 맞춘다.
function needsDateRepair(row: ExistingArticle, feedDate: string): boolean {
  const stored = Date.parse(row.published_at);
  const fetched = Date.parse(row.created_at);
  const fromFeed = Date.parse(feedDate);
  const suspect =
    Math.abs(stored - fetched) < FETCH_TIME_TOLERANCE_MS || stored > fetched + FUTURE_AT_FETCH_MS;
  return (
    (suspect && fromFeed < stored - DATE_REPAIR_MIN_SHIFT_MS) ||
    Math.abs(stored - fromFeed - KST_OFFSET_MS) < 1000
  );
}

export async function upsertFeedAndArticles(
  db: D1DatabaseLike,
  parsed: ParsedFeed
): Promise<{ feedId: string; insertedCount: number }> {
  const now = new Date().toISOString();

  // xml_url로 피드가 이미 있는지 확인한다
  const existingFeed = await db
    .prepare('SELECT id FROM feeds WHERE xml_url = ?')
    .bind(parsed.xmlUrl)
    .first<{ id: string }>();

  const feedId = existingFeed?.id ?? generateId('feed');
  if (!existingFeed) {
    await db
      .prepare(
        `INSERT INTO feeds (id, xml_url, html_url, title, description, favicon_url, last_fetched_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        feedId,
        parsed.xmlUrl,
        parsed.htmlUrl,
        parsed.title,
        parsed.description,
        parsed.faviconUrl,
        now,
        now
      )
      .run();
  }

  const { insertedCount } = await saveFeedArticles(db, feedId, parsed.articles, now);
  if (existingFeed) {
    await db
      .prepare(
        `UPDATE feeds
         SET title = ?, description = COALESCE(?, description), html_url = COALESCE(?, html_url),
             favicon_url = COALESCE(?, favicon_url), last_fetched_at = ?, last_error = NULL
         WHERE id = ?`
      )
      .bind(
        parsed.title,
        parsed.description,
        parsed.htmlUrl,
        parsed.faviconUrl,
        now,
        feedId
      )
      .run();
  }
  return { feedId, insertedCount };
}

/** 피드 하나의 글을 저장한다. 새로 들어간 글의 id도 돌려준다(X 예전 글 채우기가 읽음 표시에 쓴다). */
export async function saveFeedArticles(db: D1DatabaseLike, feedId: string, articles: ParsedFeed['articles'], now = new Date().toISOString()): Promise<{ insertedCount: number; insertedIds: string[] }> {
  // 기존 행을 한꺼번에 가져오고, 한 문장에 글을 최대 여덟 개까지 쓴다.
  // 그래서 피드 새로고침이 Workers/D1 쿼리 한도 아래에 머문다 (매개변수 최대 96개).
  const existing = new Map<string, ExistingArticle>();
  for (let offset = 0; offset < articles.length; offset += 80) {
    const chunk = articles.slice(offset, offset + 80);
    const rows = await db.prepare(
      `SELECT a.id,a.guid,a.published_at,a.created_at,d.source AS date_source,
              (a.thumbnail_url IS NULL OR a.thumbnail_url = '') AS no_thumbnail,a.content_html IS NULL AS no_content
       FROM articles a LEFT JOIN article_date_checks d ON d.article_id=a.id WHERE a.feed_id = ? AND a.guid IN (${chunk.map(() => '?').join(', ')})`
    ).bind(feedId, ...chunk.map((article) => article.guid)).all<ExistingArticle>();
    for (const row of rows.results || []) existing.set(row.guid, row);
  }

  // 피드는 몇 분마다 새로고침하므로 바뀌는 것만 쓴다: 새 글, 그리고 아래 ON CONFLICT 절이
  // 나아지게 할 기존 행. 새로고침마다 모든 항목을 다시 쓰면 매번 D1 행 쓰기 비용이 든다.
  const toWrite = articles.filter((article) => {
    const row = existing.get(article.guid);
    if (!row) return true;
    return (
      (Boolean(row.no_thumbnail) && Boolean(article.thumbnailUrl)) ||
      (Boolean(row.no_content) && Boolean(article.contentHtml)) ||
      (Boolean(article.originalPublishedAt) && row.published_at !== article.publishedAt) ||
      (row.date_source !== 'original' && needsDateRepair(row, article.publishedAt))
    );
  });

  // 명시적인 원문 발행 메타데이터는 옛 시각이 우리 수집 시각(created_at)과 닮지 않았어도
  // 생성기 시각을 고친다.
  // 그 밖의 published_at 보정: 피드의 날짜 필드를 알아보기 전에 저장된 행은 수집 시각을
  // 갖고 있고(published_at ≈ created_at), 시간대 없는 KST 시각을 UTC로 읽은 행은 자기 수집
  // 시각보다 뒤에 있다. 피드가 실제로 분명히 더 이른 날짜를 주면 그 날짜로 되돌린다.
  // 저장된 날짜가 피드 날짜보다 정확히 9시간 뒤면, 이미 지난 시각이어도 같은 KST 오독이다.
  // 날짜가 없는 항목은 "지금"으로 대신하는데, 이 값은 더 이를 수 없으므로 날짜를 덮어쓰지 않는다.
  let insertedCount = 0;
  const insertedIds: string[] = [];
  const seenGuids = new Set(existing.keys());
  const articleIds = new Map([...existing].map(([guid, row]) => [guid, row.id]));
  const statements = [];
  for (let offset = 0; offset < toWrite.length; offset += 7) {
    const chunk = toWrite.slice(offset, offset + 7);
    const originalDateGuids = chunk.filter((article) => article.originalPublishedAt).map((article) => article.guid);
    const values: unknown[] = [];
    for (const article of chunk) {
      const fresh = !seenGuids.has(article.guid);
      if (fresh) insertedCount++;
      seenGuids.add(article.guid);
      const id = articleIds.get(article.guid) || generateId('art');
      if (fresh) insertedIds.push(id);
      articleIds.set(article.guid, id);
      values.push(
        id, feedId, article.guid, article.title, article.url,
        article.author, article.summary, article.contentHtml, article.thumbnailUrl,
        article.publishedAt, now, normalizeBlockTitle(article.title)
      );
    }
    statements.push(db.prepare(
      `INSERT INTO articles (
        id, feed_id, guid, title, url, author, summary, content_html, thumbnail_url, published_at, created_at, block_title
      ) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}
      ON CONFLICT(feed_id, guid) DO UPDATE SET
        thumbnail_url = COALESCE(NULLIF(articles.thumbnail_url, ''), excluded.thumbnail_url),
        content_html = COALESCE(articles.content_html, excluded.content_html),
        block_title = CASE WHEN articles.title=excluded.title THEN excluded.block_title ELSE articles.block_title END,
        published_at = CASE
          ${originalDateGuids.length ? `WHEN articles.guid IN (${originalDateGuids.map(() => '?').join(', ')}) THEN excluded.published_at` : ''}
          WHEN EXISTS(SELECT 1 FROM article_date_checks d WHERE d.article_id=articles.id AND d.source='original') THEN articles.published_at
          WHEN ((abs(julianday(articles.published_at) - julianday(articles.created_at)) < 5.0 / 1440
                OR julianday(articles.published_at) > julianday(articles.created_at) + 10.0 / 1440)
              AND julianday(excluded.published_at) < julianday(articles.published_at) - 1.0 / 24)
            OR abs(julianday(articles.published_at) - julianday(excluded.published_at) - 9.0 / 24) < 1.0 / 86400
          THEN excluded.published_at
          ELSE articles.published_at
        END`
    ).bind(...values, ...originalDateGuids));
  }
  if (statements.length > 0) await db.batch(statements);

  const dates = articles.filter((article) => {
    const previous = existing.get(article.guid)?.date_source;
    return !previous || (previous !== 'original' && previous !== (article.dateSource || 'feed'));
  });
  const dateStatements = [];
  for (let offset = 0; offset < dates.length; offset += 30) {
    const chunk = dates.slice(offset, offset + 30);
    dateStatements.push(db.prepare(`INSERT INTO article_date_checks(article_id,source,checked_at) VALUES ${chunk.map(() => '(?,?,?)').join(',')} ON CONFLICT(article_id) DO UPDATE SET source=excluded.source,checked_at=COALESCE(excluded.checked_at,article_date_checks.checked_at)`).bind(...chunk.flatMap((article) => [articleIds.get(article.guid), article.dateSource || 'feed', article.originalPublishedAt ? now : null])));
  }
  if (dateStatements.length) await db.batch(dateStatements);

  return { insertedCount, insertedIds };
}
