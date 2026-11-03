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
    const response = await fetch(url, { signal: AbortSignal.timeout(7000), headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Mozilla/5.0 (compatible; FeedEx/1.0; +https://sfeed.jyk.workers.dev)' } });
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

// 큰 뉴스 피드가 확인을 독차지하지 않도록 모든 피드에 차례를 준다.
// 예약 새로고침 때마다 피드당 확인 안 된 글 하나씩.
export async function checkFeedPublicationDates(db: D1DatabaseLike, feedIds: string[]) {
  for (let offset = 0; offset < feedIds.length; offset += 4) {
    await Promise.all(feedIds.slice(offset, offset + 4).map(async (feedId) => {
      const article = await db.prepare(`SELECT a.id,a.url,a.title,a.content_html,a.summary,a.published_at,d.source AS date_source,d.checked_at FROM articles a LEFT JOIN article_date_checks d ON d.article_id=a.id WHERE a.feed_id=? AND (d.checked_at IS NULL OR d.checked_at<?) AND COALESCE(d.source,'feed')<>'original' ORDER BY a.published_at DESC LIMIT 1`).bind(feedId, new Date(Date.now() - 86400000).toISOString()).first<PublicationArticle>();
      if (article) await resolveArticlePublication(db, article);
    }));
  }
}
