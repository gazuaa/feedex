import { apiRequest, type ArticleItem, type ArticleViewMode } from './api';
import { cachedArticle, readContent, writeContent } from './deviceContent';
import { cacheGeneration } from './cachePolicy';
import { revealCopyImages } from './articleImages';
import { publicDeviceArticle } from '../shared/publicWebPage';
import { loadPublicWebCopy } from './publicWebCopy';

type ReaderResult = { fullContentHtml: string; publishedAt?: string };
type WebResult = { html: string; url: string; phone?: boolean };
export class ArticleResources {
  private requests = new Map<string, Promise<unknown>>();
  private failures = new Map<string, number>();
  private preparedCopies = new Map<string, { source: object; result: WebResult }>();
  private copyOrigins = new Set<string>();
  private webPreloads = 0;
  private webPreloadFlights = new Set<Promise<unknown>>();
  private readerPreloadFlight: Promise<unknown> | null = null;
  constructor(readonly account: string, private current: () => boolean, private request = apiRequest) {}
  hydrate(article: ArticleItem) { return cachedArticle(this.account, article); }
  async cachedWeb(article: ArticleItem): Promise<WebResult | undefined> {
    const stored = await readContent(this.account, `web:${article.id}`);
    if (!stored || !('html' in stored.data)) { this.preparedCopies.delete(article.id); return; }
    try { this.copyOrigins.add(new URL(article.url).origin); } catch {}
    const prepared = this.preparedCopies.get(article.id);
    if (prepared?.source === stored.data) return prepared.result;
    const result = { ...stored.data, html: revealCopyImages(stored.data.html) };
    this.preparedCopies.delete(article.id); this.preparedCopies.set(article.id, { source: stored.data, result });
    if (this.preparedCopies.size > 3) this.preparedCopies.delete(this.preparedCopies.keys().next().value!);
    return result;
  }
  private async once<T>(key: string, load: () => Promise<T>): Promise<T> {
    const running = this.requests.get(key); if (running) return running as Promise<T>;
    const work = load().finally(() => this.requests.delete(key)); this.requests.set(key, work); return work;
  }
  reader(article: ArticleItem): Promise<ArticleItem> {
    return this.once(`reader:${article.id}`, async () => {
      const generation = cacheGeneration.get(this.account), cached = await this.hydrate(article);
      if (cached.full_content_html) return cached;
      if (!this.current()) throw new Error('Session changed');
      const result = await this.request<ReaderResult>(`/api/articles/${article.id}/reader-view`, { method: 'POST', body: '{}' });
      const updated = { ...cached, full_content_html: result.fullContentHtml, body_deferred: false, ...(result.publishedAt ? { published_at: result.publishedAt } : {}) };
      if (this.current() && generation === cacheGeneration.get(this.account)) await writeContent(this.account, `article:${article.id}`, { id: article.id, url: article.url, content_html: updated.content_html, full_content_html: updated.full_content_html, published_at: updated.published_at, date_source: updated.date_source });
      return updated;
    });
  }
  web(article: ArticleItem): Promise<WebResult> {
    return this.once(`web:${article.id}`, async () => {
      const generation = cacheGeneration.get(this.account), stored = await this.cachedWeb(article);
      if (stored) return stored;
      if (!this.current()) throw new Error('Session changed');
      let result: WebResult | null = null;
      let deviceError: unknown;
      // The device's request succeeds even when the publisher blocks the
      // server network. Keep the original page layout and cache it locally.
      if (publicDeviceArticle(article.url)) {
        try { result = await loadPublicWebCopy(article.url); } catch (error) { deviceError = error; }
      }
      if (!this.current()) throw new Error('Session changed');
      if (!result) {
        try { result = await this.request<WebResult>(`/api/articles/${article.id}/web-copy`); }
        catch (error) { throw deviceError || error; }
      }
      if (this.current() && generation === cacheGeneration.get(this.account)) await writeContent(this.account, `web:${article.id}`, result);
      try { this.copyOrigins.add(new URL(article.url).origin); } catch {}
      return result;
    });
  }
  /** A copy laid out at phone width, replacing a saved one that only fits a desktop. */
  phoneWeb(article: ArticleItem): Promise<WebResult> {
    return this.once(`phone:${article.id}`, async () => {
      const generation = cacheGeneration.get(this.account);
      if (!this.current()) throw new Error('Session changed');
      const result = { ...await this.request<WebResult>(`/api/articles/${article.id}/web-copy?layout=phone`), phone: true };
      if (this.current() && generation === cacheGeneration.get(this.account)) await writeContent(this.account, `web:${article.id}`, result);
      return result;
    });
  }
  async preload(articles: ArticleItem[], current: () => boolean, view: (article: ArticleItem) => ArticleViewMode = () => 'reader') {
    const generation = cacheGeneration.get(this.account);
    const active = () => this.current() && current() && generation === cacheGeneration.get(this.account);
    const rows = articles.slice(0, 5), web: ArticleItem[] = [], reader: ArticleItem[] = [];
    for (const article of rows) {
      const mode = view(article);
      if ((this.failures.get(`${mode}:${article.id}`) || 0) > Date.now()) continue;
      if (mode === 'reader' && !article.full_content_html) reader.push(article);
      if (mode === 'web') {
        let knownCopy = Boolean(publicDeviceArticle(article.url));
        try { knownCopy ||= this.copyOrigins.has(new URL(article.url).origin); } catch {}
        // Ordinary embeddable sites keep their live page and scripts.
        if (knownCopy) web.push(article);
      }
    }
    const warmWeb = async () => {
      while (web.length && active()) {
        if (this.webPreloads >= 2) { await Promise.race(this.webPreloadFlights).catch(() => {}); continue; }
        const article = web.shift()!; this.webPreloads++;
        const work = this.web(article); this.webPreloadFlights.add(work);
        try { await work; }
        catch { this.failures.set(`web:${article.id}`, Date.now() + 60_000); }
        finally { this.webPreloads--; this.webPreloadFlights.delete(work); }
      }
    };
    const warmReaders = async () => {
      for (const article of reader) {
        while (this.readerPreloadFlight && active()) await this.readerPreloadFlight.catch(() => {});
        if (!active()) return;
        const work = this.reader(article); this.readerPreloadFlight = work;
        try { await work; } catch { this.failures.set(`reader:${article.id}`, Date.now() + 3600_000); }
        finally { if (this.readerPreloadFlight === work) this.readerPreloadFlight = null; }
      }
    };
    await Promise.all([warmWeb(), warmWeb(), warmReaders()]);
  }
}
