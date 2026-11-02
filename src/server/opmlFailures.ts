import type { OpmlFeed, OpmlImportFailure } from '../shared/opml';
import type { D1DatabaseLike } from './types';

// 확인된 언론사 피드. 제안은 사용자가 골라야 적용한다. 구독을 범위가 다른 뉴스레터나
// 간행물로 몰래 바꾸지 않는다.
const REPLACEMENTS: Record<string, string> = {
  'http://vitalik.ca/feed.xml': 'https://vitalik.eth.limo/feed.xml',
  'https://vitalik.ca/feed.xml': 'https://vitalik.eth.limo/feed.xml',
  'http://www.thebchain.co.kr/rss/allArticle.xml': 'https://www.digitaltoday.co.kr/rss/allArticle.xml',
  'https://a16z.com/feed/': 'https://www.a16z.news/feed',
  'https://medium.com/feed/despread-creative': 'https://research.despread.io/rss/',
  'https://www.getrevue.co/profile/raoulgmi?format=rss': 'https://raoulpal.substack.com/feed',
  'https://nystrom.substack.com/feed/': 'https://www.masonnystrom.com/feed',
};

export async function recordOpmlFailure(db: D1DatabaseLike, userId: string, item: OpmlFeed, error: string) {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO opml_import_failures
      (user_id, xml_url, title, html_url, folder_name, error_message, attempts, first_failed_at, last_failed_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(user_id, xml_url) DO UPDATE SET
       title = excluded.title,
       html_url = COALESCE(excluded.html_url, opml_import_failures.html_url),
       folder_name = COALESCE(excluded.folder_name, opml_import_failures.folder_name),
       error_message = excluded.error_message,
       attempts = opml_import_failures.attempts + 1,
       last_failed_at = excluded.last_failed_at`
  ).bind(userId, item.xmlUrl, item.title || item.xmlUrl, item.htmlUrl || null,
    item.folderName || null, error, now, now).run();
}

export async function clearOpmlFailure(db: D1DatabaseLike, userId: string, url: string, previousUrl?: string) {
  await db.prepare('DELETE FROM opml_import_failures WHERE user_id = ? AND xml_url IN (?, ?)')
    .bind(userId, url, previousUrl || url).run();
}

export async function listOpmlFailures(db: D1DatabaseLike, userId: string): Promise<OpmlImportFailure[]> {
  const rows = await db.prepare(
    `SELECT xml_url, title, html_url, folder_name, error_message, attempts, first_failed_at, last_failed_at
     FROM opml_import_failures WHERE user_id = ? ORDER BY last_failed_at DESC, xml_url ASC`
  ).bind(userId).all<{
    xml_url: string; title: string; html_url: string | null; folder_name: string | null;
    error_message: string; attempts: number; first_failed_at: string; last_failed_at: string;
  }>();
  return rows.results.map((row) => ({
    item: { xmlUrl: row.xml_url, title: row.title, htmlUrl: row.html_url, folderName: row.folder_name },
    error: row.error_message,
    attempts: Number(row.attempts),
    firstFailedAt: row.first_failed_at,
    lastFailedAt: row.last_failed_at,
    suggestedUrl: REPLACEMENTS[row.xml_url] || null,
  }));
}
