import { apiRequest, type ArticleItem, type ArticleViewMode } from './api';
import { cachedArticle, readContent, writeContent } from './deviceContent';
import { cacheGeneration } from './cachePolicy';
import { revealCopyImages } from './articleImages';
import { publicDeviceArticle } from '../shared/publicWebPage';
import { loadPublicWebCopy, PublicWebCopyError } from './publicWebCopy';

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
  private challengedPages = new Set<string>();
  private backgroundWeb = new Set<string>();
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
  /**
   * 웹 사본. `background`는 미리 받기다. 미리 받기는 보안 확인 화면에서 한 번만 묻고 포기한다.
   * 그사이 사용자가 그 글을 열면 미리 받기가 끝나기를 기다렸다가, 실패했으면 끈기 있게 다시 받는다.
   */
  web(article: ArticleItem, background = false): Promise<WebResult> {
    const key = `web:${article.id}`;
    const running = this.requests.get(key) as Promise<WebResult> | undefined;
    if (running && !background && this.backgroundWeb.has(key)) return running.catch(() => this.web(article));
    if (!running && background) this.backgroundWeb.add(key);
    const work = this.loadWeb(article, background);
    if (!running && background) void work.catch(() => {}).finally(() => this.backgroundWeb.delete(key));
    return work;
  }
  private loadWeb(article: ArticleItem, background: boolean): Promise<WebResult> {
    return this.once(`web:${article.id}`, async () => {
      const generation = cacheGeneration.get(this.account), stored = await this.cachedWeb(article);
      if (stored) return stored;
      if (!this.current()) throw new Error('Session changed');
      let result: WebResult | null = null;
      let deviceError: unknown;
      // 언론사가 서버 네트워크를 막아도 기기의 요청은 성공한다.
      // 원래 페이지 배치를 지키고 기기에 캐시한다.
      if (publicDeviceArticle(article.url)) {
        const source = publicDeviceArticle(article.url)!;
        try {
          result = await loadPublicWebCopy(article.url, { fresh: this.challengedPages.has(source), patient: !background });
          this.challengedPages.delete(source);
        } catch (error) {
          if (error instanceof PublicWebCopyError) {
            if (error.reason !== 'challenge') throw error;
            this.challengedPages.add(source);
            if (this.challengedPages.size > 128) this.challengedPages.delete(this.challengedPages.values().next().value!);
            // 이 사이트들은 원래 서버 요청을 막으므로, 보안 확인이면 서버 경로로 시간을 더 쓰지 않는다.
            throw error;
          }
          deviceError = error;
        }
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
  /** 휴대폰 폭에 맞춘 사본. 데스크톱에만 맞는 저장본을 대신한다. */
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
        // 보통의 프레임 허용 사이트는 실제 페이지와 스크립트를 그대로 쓴다.
        if (knownCopy) web.push(article);
      }
    }
    const warmWeb = async () => {
      while (web.length && active()) {
        if (this.webPreloads >= 2) { await Promise.race(this.webPreloadFlights).catch(() => {}); continue; }
        const article = web.shift()!; this.webPreloads++;
        const work = this.web(article, true); this.webPreloadFlights.add(work);
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
