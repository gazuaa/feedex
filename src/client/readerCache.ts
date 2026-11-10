import type { ArticleItem, BootstrapResponse } from './api';
import type { ReaderSyncDelta } from '../shared/readerSync';
import { hasVisibleArticles, patchPage } from './syncPages';
import { openDeviceDatabase as openDatabase } from './deviceDatabase';
import { retentionAge, SNAPSHOT_LIMITS } from './cachePolicy';
import { rememberArticles } from './deviceContent';

export interface ArticlePage { articles: ArticleItem[]; hasMore?: boolean; syncSequence?: number; syncEpoch?: string; needsRefresh?: boolean }
export interface Snapshot { account: string; key: string; data: BootstrapResponse | ArticlePage; savedAt: number; size: number }
export interface SnapshotStorage {
  read(account: string, key: string): Promise<Snapshot | undefined>;
  write(snapshot: Snapshot): Promise<void>;
  remove(account: string): Promise<void>;
  keys?(account: string): Promise<string[]>;
}
export const CACHE_LIMITS = { entries: 48, bytes: 8 * 1024 * 1024, age: 30 * 86400_000 };
export const deviceSnapshots: SnapshotStorage = {
  async keys(account) {
    const db = await openDatabase();
    if (!db) return [];
    return new Promise((resolve) => {
      const keys: string[] = [];
      try {
        const cursor = db.transaction('snapshots').objectStore('snapshots').index('account').openKeyCursor(IDBKeyRange.only(account));
        cursor.onerror = () => resolve(keys);
        cursor.onsuccess = () => { if (cursor.result) { keys.push(String((cursor.result.primaryKey as string[])[1])); cursor.result.continue(); } else resolve(keys); };
      } catch { resolve(keys); }
    });
  },
  async read(account, key) {
    const db = await openDatabase();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const request = db.transaction('snapshots').objectStore('snapshots').get([account, key]);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(undefined);
      } catch { resolve(undefined); }
    });
  },
  async write(snapshot) {
    const db = await openDatabase();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const transaction = db.transaction('snapshots', 'readwrite');
        transaction.oncomplete = transaction.onabort = transaction.onerror = () => resolve();
        const store = transaction.objectStore('snapshots');
        store.put(snapshot);
        const rows: { key: IDBValidKey; size: number; at: number }[] = [];
        const cursor = store.index('age-size').openKeyCursor();
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (item) { const [at, size] = item.key as number[]; rows.push({ key: item.primaryKey, size, at }); item.continue(); return; }
          let bytes = rows.reduce((sum, row) => sum + row.size, 0), count = rows.length;
          for (const row of rows) {
            if (row.at + retentionAge(String((row.key as string[])[0])) > Date.now() && count <= SNAPSHOT_LIMITS.entries && bytes <= SNAPSHOT_LIMITS.bytes) break;
            store.delete(row.key); count--; bytes -= row.size;
          }
        };
      } catch { resolve(); }
    });
  },
  async remove(account) {
    const db = await openDatabase();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const transaction = db.transaction('snapshots', 'readwrite');
        transaction.oncomplete = transaction.onabort = transaction.onerror = () => resolve();
        const store = transaction.objectStore('snapshots');
        const cursor = store.index('account').openKeyCursor(IDBKeyRange.only(account));
        cursor.onsuccess = () => { if (cursor.result) { store.delete(cursor.result.primaryKey); cursor.result.continue(); } };
      } catch { resolve(); }
    });
  },
};

// 렌더링 스레드에서 큰 HTML 문자열을 직렬화하지 않고 크기를 어림한다.
function sizeOf(value: unknown): number {
  if (typeof value === 'string') return value.length * 2;
  if (!value || typeof value !== 'object') return 8;
  return Object.entries(value).reduce((sum, [key, child]) => sum + key.length * 2 + sizeOf(child), 32);
}
export function updateCounts(counts: BootstrapResponse['counts'], before: ArticleItem, after: ArticleItem, now = Date.now()) {
  const age = now - Date.parse(before.published_at);
  const unread = Number(!after.is_read) - Number(!before.is_read);
  return { ...counts,
    totalUnread: Math.max(0, counts.totalUnread + (age <= 30 * 86400_000 ? unread : 0)),
    todayCount: Math.max(0, counts.todayCount + (age <= 86400_000 ? unread : 0)),
    savedCount: Math.max(0, counts.savedCount + Number(after.is_saved) - Number(before.is_saved)),
  };
}
export function updateSubscription<T extends BootstrapResponse['subscriptions'][number]>(subscription: T, before: ArticleItem, after: ArticleItem, now = Date.now()): T {
  if (subscription.feed_id !== before.feed_id) return subscription;
  const unread = now - Date.parse(before.published_at) <= 30 * 86400_000 ? Number(!after.is_read) - Number(!before.is_read) : 0;
  return { ...subscription, unread_count: Math.max(0, subscription.unread_count + unread), saved_count: Math.max(0, subscription.saved_count + Number(after.is_saved) - Number(before.is_saved)) };
}
export const articlePageKey = (query: URLSearchParams) => { const sorted = new URLSearchParams(query); sorted.sort(); return `articles?${sorted}`; };

export class ReaderCache {
  private entries = new Map<string, Snapshot>();
  private writes: Promise<unknown> = Promise.resolve();
  private requests = new Map<string, { revision: number; promise: Promise<Snapshot['data']> }>();
  private closed = false;
  private overrides = new Map<string, ArticleItem>();
  revision = 0;
  constructor(readonly account: string, private storage: SnapshotStorage = deviceSnapshots, private now = Date.now) {}
  get active() { return !this.closed; }
  touch() { if (this.active) this.revision++; }
  get epoch() { return (this.entries.get('bootstrap')?.data as BootstrapResponse | undefined)?.cacheEpoch; }
  has(key: string) { const entry = this.entries.get(key); return this.active && Boolean(entry && entry.savedAt + retentionAge(this.account) > this.now()); }
  request<T extends Snapshot['data']>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const previous = this.requests.get(key);
    if (previous?.revision === this.revision) return previous.promise as Promise<T>;
    const promise = Promise.resolve().then(() => {
      if (!this.active) throw new Error('Reader cache closed');
      return fetcher();
    }).finally(() => { if (this.requests.get(key)?.promise === promise) this.requests.delete(key); });
    this.requests.set(key, { revision: this.revision, promise });
    return promise;
  }
  private queue(operation: () => Promise<unknown>) { this.writes = this.writes.then(operation).catch(() => {}); return this.writes; }
  private trim() {
    let bytes = [...this.entries.values()].reduce((sum, entry) => sum + entry.size, 0);
    for (const [key, snapshot] of this.entries) {
      if (this.entries.size <= CACHE_LIMITS.entries && bytes <= CACHE_LIMITS.bytes) break;
      // 처음 받은 데이터에는 저장된 모든 목록을 최신으로 표시하는 동기화 시점이 들어 있다.
      if (key === 'bootstrap') continue;
      this.entries.delete(key); bytes -= snapshot.size;
    }
  }
  async get<T extends Snapshot['data']>(key: string): Promise<T | undefined> {
    if (this.closed) return;
    const revision = this.revision;
    const memory = this.entries.get(key);
    const loaded = memory ?? await this.storage.read(this.account, key).catch(() => undefined);
    // 디스크를 읽는 동안 더 빠른 네트워크 응답이 메모리를 채웠을 수 있다.
    const snapshot = this.entries.get(key) ?? loaded;
    if (this.closed || revision !== this.revision || snapshot?.account !== this.account || snapshot.savedAt + retentionAge(this.account) <= this.now()) return;
    if (key.startsWith('articles?') && this.overrides.size) snapshot.data = patchPage(snapshot.data as ArticlePage, key, [...this.overrides.values()], new Set(), new Set(), this.entries.get('bootstrap')?.data as BootstrapResponse | undefined, this.account);
    this.entries.delete(key); this.entries.set(key, snapshot);
    this.trim();
    return snapshot.data as T;
  }
  /** 이미 메모리에 있을 때의 저장값. 준비된 목록이 한 프레임도 기다리지 않고 그려지게 한다. */
  peek<T extends Snapshot['data']>(key: string): T | undefined {
    const snapshot = this.entries.get(key);
    if (this.closed || !snapshot || snapshot.savedAt + retentionAge(this.account) <= this.now()) return;
    if (key.startsWith('articles?') && this.overrides.size) snapshot.data = patchPage(snapshot.data as ArticlePage, key, [...this.overrides.values()], new Set(), new Set(), this.entries.get('bootstrap')?.data as BootstrapResponse | undefined, this.account);
    return snapshot.data as T;
  }
  put(key: string, data: Snapshot['data']) {
    if (this.closed) return;
    let size = sizeOf(data);
    // 피드에 아주 큰 본문이 있어도 쓸 만한 첫 화면은 남긴다.
    if ('articles' in data) {
      rememberArticles(this.account, data.articles);
      while (size > CACHE_LIMITS.bytes && data.articles.length > 1) {
        data = { ...data, articles: data.articles.slice(0, Math.ceil(data.articles.length / 2)), hasMore: true };
        size = sizeOf(data);
      }
    }
    if (size > CACHE_LIMITS.bytes) return;
    const snapshot: Snapshot = { account: this.account, key, data, savedAt: this.now(), size };
    this.entries.delete(key); this.entries.set(key, snapshot);
    this.trim();
    // 검색 결과는 임시 질의이므로 디스크 스냅샷에 영구 저장하지 않는다.
    if (key.includes('search=')) return;
    // 로그아웃 전에 받은 쓰기는 끝까지 마쳐야 한다. 닫힌 인스턴스는 새 저장을 거부한다.
    void this.queue(() => this.storage.write(snapshot));
  }
  updateArticle(before: ArticleItem, after: ArticleItem, blocked = false) {
    if (this.closed) return false;
    const adjustCounts = !blocked || !this.peek<BootstrapResponse>('bootstrap')?.syncCursor?.blockRevision;
    this.overrides.set(after.id, after);
    this.revision++;
    for (const [key, snapshot] of [...this.entries]) {
      if (key === 'bootstrap') {
        const data = snapshot.data as BootstrapResponse;
        if (adjustCounts) this.put(key, { ...data, counts: updateCounts(data.counts, before, after, this.now()), subscriptions: data.subscriptions.map((sub) => updateSubscription(sub, before, after, this.now())) });
      } else {
        const data = snapshot.data as ArticlePage, query = new URLSearchParams(key.slice(9));
        const saved = query.get('scope') === 'saved' || query.get('savedOnly') === 'true';
        const unread = !saved && query.get('unreadOnly') === 'true';
        const articles = data.articles.map((article) => article.id === after.id ? { ...article, is_read: after.is_read, is_saved: after.is_saved } : article).filter((article) => (!saved || article.is_saved) && (!unread || !article.is_read));
        const needsRefresh = Boolean(data.needsRefresh || data.hasMore && !hasVisibleArticles(articles, query, this.account));
        this.put(key, { ...data, articles, ...(needsRefresh ? { needsRefresh: true } : {}) });
      }
    }
    return adjustCounts;
  }
  updateFields(articleId: string, fields: Partial<ArticleItem>) { this.updateMany(new Map([[articleId, fields]])); }
  /** 여러 글을 한 번에 고친다. 목록 하나는 한 번만 다시 저장한다. */
  updateMany(changes: ReadonlyMap<string, Partial<ArticleItem>>) {
    if (!changes.size) return;
    for (const [id, fields] of changes) { const previous = this.overrides.get(id); if (previous) this.overrides.set(id, { ...previous, ...fields }); }
    this.revision++;
    for (const [key, snapshot] of [...this.entries]) {
      if (key.startsWith('articles?')) {
        const data = snapshot.data as ArticlePage;
        if (!data.articles.some((article) => changes.has(article.id))) continue;
        this.put(key, { ...data, articles: data.articles.map((article) => changes.has(article.id) ? { ...article, ...changes.get(article.id) } : article) });
      }
    }
  }
  updateBootstrap(update: (data: BootstrapResponse) => BootstrapResponse) {
    this.revision++;
    const entry = this.entries.get('bootstrap');
    if (entry) this.put('bootstrap', update(entry.data as BootstrapResponse));
  }
  async applySync(delta: ReaderSyncDelta, current: () => boolean): Promise<BootstrapResponse | undefined> {
    const revision = this.revision;
    const bootstrap = await this.get<BootstrapResponse>('bootstrap');
    if (!bootstrap || !current() || !this.active || revision !== this.revision) return;
    if (!delta.changed) {
      const next = { ...bootstrap, syncCursor: delta.cursor };
      this.put('bootstrap', next); return next;
    }
    const keys = new Set([...this.entries.keys(), ...await this.storage.keys?.(this.account).catch(() => []) ?? []]);
    // 검색 결과 페이지는 백그라운드 동기화 대상이 아니므로 메모리에서 정리한다.
    for (const key of keys) if (key.includes('search=')) this.entries.delete(key);
    const pages = await Promise.all([...keys].filter((key) => key.startsWith('articles?') && !key.includes('search=')).map(async (key) => [key, await this.get<ArticlePage>(key)] as const));
    if (!current() || !this.active || revision !== this.revision) return;
    const old = new Map(bootstrap.subscriptions.map((sub) => [sub.feed_id, sub]));
    const counts = new Map(delta.subscriptionCounts.map((sub) => [sub.feed_id, sub]));
    const subscriptions = (delta.subscriptions ?? bootstrap.subscriptions).map((sub) => ({ total_count: 0, unread_count: 0, saved_count: 0, ...old.get(sub.feed_id), ...sub, ...counts.get(sub.feed_id) }));
    const next: BootstrapResponse = { ...bootstrap, syncCursor: delta.cursor, cacheEpoch: crypto.randomUUID(), folders: delta.folders ?? bootstrap.folders, subscriptions,
      counts: { ...bootstrap.counts, ...delta.today,
        totalArticles: subscriptions.reduce((sum, sub) => sum + sub.total_count, 0), totalUnread: subscriptions.reduce((sum, sub) => sum + sub.unread_count, 0), savedCount: subscriptions.reduce((sum, sub) => sum + sub.saved_count, 0) } };
    this.revision++;
    const removed = new Set(delta.removedIds), changedBodies = new Set(delta.articleChangedIds);
    const bodies = new Map<string, ArticleItem>();
    for (const [, page] of pages) for (const article of page?.articles ?? []) if (!article.body_deferred) bodies.set(article.id, article);
    const changes = delta.articles.map((article) => {
      const body = !changedBodies.has(article.id) ? bodies.get(article.id) : undefined;
      return body ? { ...article, content_html: body.content_html, full_content_html: body.full_content_html, ai_summary: body.ai_summary, body_deferred: false } : article;
    });
    for (const article of delta.articles) this.overrides.delete(article.id);
    for (const id of removed) this.overrides.delete(id);
    this.put('bootstrap', next);
    for (const [key, page] of pages) if (page) {
      const patched = patchPage(page, key, changes, removed, changedBodies, next, this.account);
      const query = new URLSearchParams(key.slice(9));
      // 이미 있는 피드는 글을 쓰지 않고도 새로 구독되거나 캐시된 폴더로 옮겨질 수 있다.
      // 그때 영향을 받는 페이지만 다시 채운다.
      const refill = subscriptions.some((sub) => {
        const before = old.get(sub.feed_id), scope = query.get('scope');
        if (scope === 'folder') return sub.folder_id === query.get('folderId') && (!before || before.folder_id !== sub.folder_id);
        return !before && (scope !== 'feed' || query.get('feedId') === sub.feed_id);
      });
      this.put(key, { ...patched, needsRefresh: patched.needsRefresh || refill });
    }
    return next;
  }
  invalidate() { if (this.closed) return; this.revision++; this.entries.clear(); this.overrides.clear(); void this.queue(() => this.storage.remove(this.account)); }
  close() { this.closed = true; this.revision++; this.entries.clear(); this.requests.clear(); this.overrides.clear(); return this.writes; }
  clear() { this.close(); return this.queue(() => this.storage.remove(this.account)); }
  flushed() { return this.writes; }
}

// 요청이 도는 동안 캐시된 데이터를 먼저 그릴 수 있다. 늦게 끝난 디스크 읽기나
// 예전 응답이 새 데이터, 이동, 먼저 바꾼 화면을 덮어쓰면 안 된다.
export async function revalidate<T extends Snapshot['data']>(cache: ReaderCache, key: string, fetcher: () => Promise<T>, apply: (data: T, source: 'cache' | 'network') => void, current: () => boolean) {
  if (!cache.active || !current()) return false;
  const revision = cache.revision;
  let fresh = false, cached = false;
  const disk = cache.get<T>(key).then((data) => { if (data && !fresh && cache.active && current() && revision === cache.revision) { cached = true; apply(data, 'cache'); } });
  try {
    const data = await cache.request(key, fetcher); fresh = true;
    if (cache.active && current() && revision === cache.revision) { cache.put(key, data); apply(data, 'network'); }
  } catch (error) {
    if (cache.active && current() && revision === cache.revision) throw error;
  } finally { await disk; }
  return cached;
}
