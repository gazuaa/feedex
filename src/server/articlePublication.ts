import type { D1DatabaseLike } from './types';
import { extractOriginalPublishedAt, extractSummaryPublishedAt } from './publicationDate';

export interface PublicationArticle {
  id: string;
  url: string;
  title: string;
  content_html: string | null;
  full_content_html?: string | null;
  summary: string | null;
  published_at: string;
  date_source?: string | null;
  checked_at?: string | null;
}

export async function findOriginalPublication(article: PublicationArticle): Promise<string | null> {
  const saved = extractOriginalPublishedAt(article.content_html, article.url) || extractOriginalPublishedAt(article.full_content_html, article.url) || extractSummaryPublishedAt(article.summary, article.title, article.url);
  if (saved) return saved;
  try {
    const url = new URL(article.url);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const response = await fetch(url, { signal: AbortSignal.timeout(7000), headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Mozilla/5.0 (compatible; FeedEx/1.0; +https://feedex.jyk.workers.dev)' } });
    if (!response.ok) return null;
    const text = await response.text();
    return extractOriginalPublishedAt(text, article.url);
  } catch { return null; }
}

export async function resolveArticlePublication(db: D1DatabaseLike, article: PublicationArticle) {
  if ((article.checked_at && Date.now() - Date.parse(article.checked_at) < 86400000) || article.date_source === 'original') return { publishedAt: article.published_at, dateSource: article.date_source || 'feed' };
  const publishedAt = await findOriginalPublication(article);
  const dateSource = publishedAt ? 'original' : article.date_source || 'feed';
  const statements = [db.prepare(`INSERT INTO article_date_checks(article_id,source,checked_at) VALUES(?,?,?) ON CONFLICT(article_id) DO UPDATE SET source=excluded.source,checked_at=excluded.checked_at`).bind(article.id, dateSource, new Date().toISOString())];
  if (publishedAt) statements.push(db.prepare('UPDATE articles SET published_at = ? WHERE id = ?').bind(publishedAt, article.id));
  await db.batch(statements);
  return { publishedAt: publishedAt || article.published_at, dateSource };
}

// 예약 실행 한 번에 확인하는 피드 수와, 피드마다 살펴보는 최근 글 수.
// D1은 10초 단위로 부하를 재서, 한꺼번에 많이 읽으면 그 순간의 사용자 요청까지 함께 실패한다.
export const PUBLICATION_CHECK_FEEDS = 25;
export const PUBLICATION_CHECK_RECENT = 200;

// 큰 뉴스 피드가 확인을 독차지하지 않도록 모든 피드에 차례를 준다.
// 예약 실행 때마다 피드 몇 개를 무작위로 골라 하나씩 차례로, 피드당 확인 안 된 최근 글 하나를 확인한다.
// 목록은 새로고침이 오래된 순이라, 자리로 고르면 같은 자리에 돌아오는 피드가 계속 빠질 수 있다.
export async function checkFeedPublicationDates(db: D1DatabaseLike, feedIds: string[]) {
  const picked = [...feedIds];
  const count = Math.min(PUBLICATION_CHECK_FEEDS, picked.length);
  const since = new Date(Date.now() - 86400000).toISOString();
  for (let index = 0; index < count; index++) {
    const swap = index + Math.floor(Math.random() * (picked.length - index));
    [picked[index], picked[swap]] = [picked[swap], picked[index]];
    try {
      const article = await db.prepare(`SELECT a.id,a.url,a.title,a.content_html,a.summary,a.published_at,d.source AS date_source,d.checked_at
        FROM (SELECT id FROM articles WHERE feed_id=? ORDER BY published_at DESC,id DESC LIMIT ?) recent JOIN articles a ON a.id=recent.id
        LEFT JOIN article_date_checks d ON d.article_id=a.id
        WHERE (d.checked_at IS NULL OR d.checked_at<?) AND COALESCE(d.source,'feed')<>'original' ORDER BY a.published_at DESC LIMIT 1`)
        .bind(picked[index], PUBLICATION_CHECK_RECENT, since).first<PublicationArticle>();
      if (article) await resolveArticlePublication(db, article);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('발행일 확인 실패:', message);
      // DB가 과부하면 사용자 요청에 자리를 내주고 다음 예약 실행으로 넘긴다. 다른 오류는 이 피드만 건너뛴다.
      if (/overloaded/i.test(message)) return;
    }
  }
}
