import type { BootstrapResponse } from './api';
import { articlePageKey, ReaderCache, type ArticlePage } from './readerCache';

export const PRELOAD_ARTICLE_LIMIT = 20;

// 읽음·저장 변경 때문에 모든 목록을 다시 받을 필요는 없다.
export function feedCacheVersion(data: BootstrapResponse): string {
  return JSON.stringify(data.subscriptions.map((sub) => [sub.feed_id, sub.folder_id, sub.total_count, sub.last_fetched_at]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

export function preloadArticleQueries(current: URLSearchParams, folderIds: string[] = [], excludedFeedIds: string[] = []): URLSearchParams[] {
  if (current.get('search')) return [];
  const queries: URLSearchParams[] = [];
  const scope = current.get('scope');
  const field = scope === 'folder' ? 'folderId' : scope === 'feed' ? 'feedId' : null;
  // 보고 있는 폴더·피드의 다른 탭(전체·안 읽음·저장)을 먼저 받는다. 하단 탭을 누르면 바로 바뀌게 한다.
  if (field && current.get(field)) {
    const base = { scope: scope!, [field]: current.get(field)! };
    queries.push(new URLSearchParams({ ...base, unreadOnly: 'false' }), new URLSearchParams({ ...base, unreadOnly: 'true' }), new URLSearchParams({ ...base, unreadOnly: 'false', savedOnly: 'true' }));
  }
  queries.push(
    new URLSearchParams({ scope: 'all', unreadOnly: 'false' }),
    new URLSearchParams({ scope: 'all', unreadOnly: 'true' }),
    new URLSearchParams({ scope: 'saved', unreadOnly: 'false' }),
  );
  // 지금 쓰는 필터로 모든 폴더의 첫 화면을 받아 두어, 동기화 뒤에 폴더를 열면
  // 바로 보이게 한다.
  for (const folderId of folderIds) {
    const query = new URLSearchParams({ scope: 'folder', unreadOnly: current.get('unreadOnly') ?? 'false', folderId });
    if (current.get('savedOnly') === 'true') query.set('savedOnly', 'true');
    queries.push(query);
  }
  for (const query of queries) {
    if (query.get('scope') === 'all' && excludedFeedIds.length) query.set('excludedFeedIds', JSON.stringify(excludedFeedIds));
  }
  const active = articlePageKey(current);
  if (current.get('sort') === 'oldest') queries.forEach((query) => query.set('sort', 'oldest'));
  // 선택한 폴더는 두 번 나오지만 목록은 한 번만 받는다.
  const seen = new Set([active]);
  return queries.filter((query) => {
    const key = articlePageKey(query);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

// 보이는 화면을 다 불러온 뒤, 백그라운드 요청은 한 번에 하나씩 한다.
// 앞에서 하는 이동은 진행 중인 요청을 ReaderCache를 통해 함께 쓴다.
export class ReaderPreloader {
  private queue: Promise<void> = Promise.resolve();
  private versions = new Map<string, string>();
  constructor(private cache: ReaderCache) {}
  run(queries: URLSearchParams[], version: string, fetcher: (query: URLSearchParams) => Promise<ArticlePage>, current: () => boolean): Promise<void> {
    const revision = this.cache.revision;
    const valid = () => this.cache.active && this.cache.revision === revision && current();
    this.queue = this.queue.then(async () => {
      for (const query of queries) {
        if (!valid()) return;
        const key = articlePageKey(query);
        if (this.cache.epoch) {
          const page = await this.cache.get<ArticlePage>(key);
          if (!valid()) return;
          if (page?.syncEpoch === this.cache.epoch && !page.needsRefresh) continue;
        }
        if (this.versions.get(key) === version && this.cache.has(key)) continue;
        try {
          // 첫 화면만 있으면 이동이 바로 된다. 나머지는 평소 커서가 불러온다.
          // 이동이 이 요청을 함께 쓸 때도 마찬가지다.
          const requestQuery = new URLSearchParams(query);
          requestQuery.set('limit', String(PRELOAD_ARTICLE_LIMIT));
          const data = await this.cache.request(key, () => fetcher(requestQuery));
          if (!valid()) return;
          this.cache.put(key, { ...data, syncEpoch: this.cache.epoch });
          this.versions.set(key, version);
        } catch {
          // 미리 받기 요청이 실패해도 다른 목록이나 화면을 막으면 안 된다.
        }
      }
    });
    return this.queue;
  }
}
