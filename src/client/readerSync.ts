import { apiRequest, type ArticleItem, type BootstrapResponse } from './api';
import type { ReaderSyncDelta } from '../shared/readerSync';
import { ReaderCache, type ArticlePage, articlePageKey } from './readerCache';
import { hasVisibleArticles } from './syncPages';

type Request = typeof apiRequest;
interface SyncResult { bootstrap?: BootstrapResponse; changed: boolean; reset: boolean; delta?: ReaderSyncDelta }
export class ReaderSync {
  private flight: Promise<SyncResult> | null = null;
  constructor(private cache: ReaderCache, private request: Request = apiRequest, private onNewArticles?: (articles: ArticleItem[]) => void | Promise<void>) {}
  check(current: () => boolean, pending: () => Promise<unknown>) {
    if (this.flight) return this.flight;
    const run = async (attempt = 0): Promise<SyncResult> => {
      await pending();
      if (!current() || !this.cache.active) return { changed: false, reset: false };
      const revision = this.cache.revision;
      const cached = await this.cache.get<BootstrapResponse>('bootstrap');
      // 수정 권한 항목이 없던 저장본은 빌더 피드를 구독한 계정에 한해 한 번 갱신한다.
      const missingBuilderMetadata = cached?.subscriptions.some((feed) => feed.builder_id === undefined && /\/rss\/rss_[\w-]+\.xml(?:[?#]|$)/.test(feed.xml_url));
      if (!cached?.syncCursor || !cached.cacheEpoch || missingBuilderMetadata) return this.reset(current, pending);
      const delta = await this.request<ReaderSyncDelta>('/api/sync', { method: 'POST', body: JSON.stringify({ cursor: cached.syncCursor }) });
      if (!current() || !this.cache.active) return { changed: false, reset: false };
      if (revision !== this.cache.revision) return attempt < 2 ? run(attempt + 1) : { bootstrap: await this.cache.get<BootstrapResponse>('bootstrap'), changed: false, reset: false };
      if (delta.reset) return this.reset(current, pending);
      const bootstrap = await this.cache.applySync(delta, current);
      if (!bootstrap && current() && this.cache.active && attempt < 2) return run(attempt + 1);
      if (bootstrap && this.onNewArticles && current()) {
        const ids = new Set(delta.newArticleIds), subscribed = new Set(cached.subscriptions.map((sub) => sub.feed_id));
        const fresh = delta.articles.filter((article) => ids.has(article.id) && subscribed.has(article.feed_id) && !article.is_read);
        if (fresh.length) void Promise.resolve().then(() => this.onNewArticles!(fresh)).catch(() => {});
      }
      return { bootstrap, changed: Boolean(bootstrap && delta.changed), reset: false, delta };
    };
    const flight = run().finally(() => { if (this.flight === flight) this.flight = null; });
    this.flight = flight;
    return flight;
  }
  private async reset(current: () => boolean, pending: () => Promise<unknown>) {
    await pending();
    const revision = this.cache.revision;
    const response = await this.request<BootstrapResponse>('/api/bootstrap');
    if (!current() || !this.cache.active || revision !== this.cache.revision) return { changed: false, reset: false };
    this.cache.invalidate();
    const bootstrap = { ...response, cacheEpoch: crypto.randomUUID() };
    this.cache.put('bootstrap', bootstrap);
    return { bootstrap, changed: true, reset: true };
  }
  // 읽은 글이 빠져 차단·제외된 글만 남은 불완전한 캐시 조각은 서버의 첫 페이지로 다시 채운다.
  private usable(cached: ArticlePage | undefined, query: URLSearchParams): cached is ArticlePage {
    if (!cached || cached.needsRefresh || !cached.syncEpoch || cached.syncEpoch !== this.cache.epoch) return false;
    // 검색 쿼리에서 글이 0개인 캐시는 빈 화면으로 굳어지지 않도록 서버에서 다시 확인한다.
    if (query.get('search')?.trim() && !cached.articles.length) return false;
    const limit = Math.min(200, Number(query.get('limit') || 80));
    return !(cached.hasMore && cached.articles.length < limit && !hasVisibleArticles(cached.articles, query, this.cache.account));
  }
  /** 이미 메모리에 있는 최신 목록. 그 밖의 것은 page()를 거친다. */
  ready(query: URLSearchParams): ArticlePage | undefined {
    // 검색어가 있으면 사용자가 실시간으로 찾는 중이므로 ready로 캐시를 즉시 확정해 서버 조회를 생략하지 않는다.
    if (query.get('search')?.trim()) return undefined;
    const cached = this.cache.peek<ArticlePage>(articlePageKey(query));
    return this.usable(cached, query) ? cached : undefined;
  }
  async page(query: URLSearchParams, current: () => boolean, pending: () => Promise<unknown>): Promise<ArticlePage | undefined> {
    const key = articlePageKey(query);
    const cached = await this.cache.get<ArticlePage>(key);
    if (this.usable(cached, query)) return cached;
    await pending();
    if (!current() || !this.cache.active) return;
    const revision = this.cache.revision, epoch = this.cache.epoch;
    const page = await this.cache.request(key, () => this.request<ArticlePage>(`/api/articles?${query}`));
    if (!current() || !this.cache.active || revision !== this.cache.revision || epoch !== this.cache.epoch) return;
    const fresh = { ...page, syncEpoch: epoch };
    this.cache.put(key, fresh);
    return fresh;
  }
}
