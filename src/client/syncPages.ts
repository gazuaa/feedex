import { scopedExcludedFeeds } from '../shared/feedExclusions';
import type { ArticleItem, BootstrapResponse } from './api';
import type { ArticlePage } from './readerCache';

export function matchesPage(query: URLSearchParams, article: ArticleItem, now = Date.now()) {
  const scope = query.get('scope');
  if (scope === 'folder' && article.folder_id !== query.get('folderId')) return false;
  if (scope === 'feed' && article.feed_id !== query.get('feedId')) return false;
  const saved = scope === 'saved' || query.get('savedOnly') === 'true';
  if (scopedExcludedFeeds(scope, saved, query.get('excludedFeedIds')).includes(article.feed_id)) return false;
  if (saved && !article.is_saved) return false;
  const age = now - Date.parse(article.published_at);
  if (scope === 'today' && age > 86400_000) return false;
  if (!saved && query.get('unreadOnly') === 'true' && (article.is_read || age > 30 * 86400_000)) return false;
  const search = query.get('search')?.trim().toLocaleLowerCase();
  return !search || [article.title, article.summary, article.feed_title].some((value) => value?.toLocaleLowerCase().includes(search));
}
const order = (a: ArticleItem, b: ArticleItem) => b.published_at.localeCompare(a.published_at) || b.id.localeCompare(a.id);
// 같은 목록에서 탭(전체·안 읽음·저장)만 바꿀 때, 이미 받은 글로 새 탭의 목록을 먼저 그린다. 서버 답이 오면 그것으로 바꾼다.
export function filteredPage(query: URLSearchParams, pool: Iterable<ArticleItem>, now = Date.now()): ArticleItem[] {
  const compare = query.get('sort') === 'oldest' ? (a: ArticleItem, b: ArticleItem) => -order(a, b) : order;
  return [...pool].filter((article) => matchesPage(query, article, now)).sort(compare).slice(0, Math.min(200, Number(query.get('limit') || 80)));
}
/** 앞 목록과 탭(안 읽음·저장 거르기)만 다른 목록인지. */
export function sameListOtherTab(before: string, after: URLSearchParams): boolean {
  const list = (query: URLSearchParams) => { const copy = new URLSearchParams(query); copy.delete('unreadOnly'); copy.delete('savedOnly'); copy.sort(); return copy.toString(); };
  return Boolean(before) && before !== after.toString() && list(new URLSearchParams(before)) === list(after);
}
export function patchPage(page: ArticlePage, key: string, changes: ArticleItem[], removed: Set<string>, changedBodies: Set<string>, bootstrap?: BootstrapResponse): ArticlePage {
  const query = new URLSearchParams(key.slice(9));
  const compare = query.get('sort') === 'oldest' ? (a: ArticleItem, b: ArticleItem) => -order(a, b) : order;
  const rows = new Map(page.articles.map((article) => [article.id, article]));
  const last = page.articles.at(-1);
  for (const article of changes) {
    const before = rows.get(article.id);
    if (!before && page.hasMore && last && compare(article, last) > 0) continue;
    // 본문 없이 남은 글에 본문이 함께 오면(X 글) 그 본문을 쓴다.
    rows.set(article.id, before && !changedBodies.has(article.id) && !(before.body_deferred && !article.body_deferred) ? { ...before, ...article,
      content_html: before.content_html, full_content_html: before.full_content_html, ai_summary: before.ai_summary, body_deferred: before.body_deferred,
    } : article);
  }
  const subscriptions = bootstrap ? new Map(bootstrap.subscriptions.map((sub) => [sub.feed_id, sub])) : null;
  const folders = new Map(bootstrap?.folders.map((folder) => [folder.id, folder.name]) ?? []);
  const articles = [...rows.values()].filter((article) => !removed.has(article.id) && (!subscriptions || subscriptions.has(article.feed_id))).map((article) => {
    const sub = subscriptions?.get(article.feed_id);
    return sub ? { ...article, feed_title: sub.title, feed_favicon: sub.favicon_url, feed_html_url: sub.html_url, folder_id: sub.folder_id, folder_name: sub.folder_id ? folders.get(sub.folder_id) ?? null : null } : article;
  }).filter((article) => matchesPage(query, article)).sort(compare);
  const limit = Math.min(200, Number(query.get('limit') || 80));
  const hasMore = Boolean(page.hasMore || articles.length > limit);
  return { ...page, articles: articles.slice(0, limit), hasMore, needsRefresh: Boolean(page.needsRefresh || hasMore && articles.length === 0), syncEpoch: bootstrap?.cacheEpoch ?? page.syncEpoch };
}
