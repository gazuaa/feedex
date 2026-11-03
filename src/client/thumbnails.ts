import { useEffect, useRef, useState } from 'react';
import { apiRequest, getStoredToken, type ArticleItem } from './api';
import { readContent, writeContent } from './deviceContent';
import { cacheGeneration } from './cachePolicy';

type ThumbnailResult = { thumbnailUrl: string | null; retryable?: boolean };
type ThumbnailArticle = Pick<ArticleItem, 'id' | 'url' | 'thumbnail_url'>;
const identity = (account: string, article: ThumbnailArticle) => JSON.stringify([account, article.id, article.url]);

/**
 * https 앱에서 http 그림은 막힌다(https가 없는 사이트는 그대로 깨진다). 서버에 저장된 글 썸네일이면
 * 서버가 대신 받아 준다(serveArticleImage). 기기에서만 찾은 그림은 그대로 둔다.
 */
export function shownThumbnail(url: string | null | undefined, article: Pick<ArticleItem, 'id' | 'thumbnail_url'>): string | null | undefined {
  if (!url || !/^http:\/\//i.test(url) || typeof location === 'undefined' || location.protocol !== 'https:' || url !== article.thumbnail_url) return url;
  return `/article-image/${encodeURIComponent(article.id)}`;
}

/** 가까운 글의 빠진 이미지를 네 개씩 찾고, 답은 기기에 남긴다. */
export class ThumbnailLoader {
  private requests = new Map<string, Promise<string | undefined>>();
  private retryAfter = new Map<string, number>();
  private waiting: Array<() => void> = [];
  private running = 0;
  constructor(private request = apiRequest, private session = getStoredToken) {}
  private async slot<T>(load: () => Promise<T>) {
    await new Promise<void>((resolve) => {
      const start = () => { this.running++; resolve(); };
      if (this.running < 4) start(); else this.waiting.push(start);
    });
    try { return await load(); } finally { this.running--; this.waiting.shift()?.(); }
  }
  lookup(account: string, article: ThumbnailArticle): Promise<string | undefined> {
    if (article.thumbnail_url) return Promise.resolve(article.thumbnail_url);
    const key = identity(account, article), existing = this.requests.get(key);
    if (existing) return existing;
    const token = this.session(), generation = cacheGeneration.get(account);
    const current = () => this.session() === token && cacheGeneration.get(account) === generation;
    const work = (async () => {
      const cached = await readContent(account, `thumbnail:${article.id}`);
      const data = cached?.data as Partial<ArticleItem> | undefined;
      if (!current()) return;
      if (data?.url === article.url && typeof data.thumbnail_url === 'string' && (data.thumbnail_url || cached!.savedAt + 86400_000 > Date.now())) return data.thumbnail_url;
      if ((this.retryAfter.get(key) || 0) > Date.now()) return;
      try {
        return await this.slot(async () => {
          if (!current()) return;
          const result = await this.request<ThumbnailResult>(`/api/articles/${article.id}/thumbnail`, { method: 'POST' });
          if (!current()) return;
          if (result.retryable) throw new Error('Temporary thumbnail failure');
          const thumbnail = result.thumbnailUrl || '';
          await writeContent(account, `thumbnail:${article.id}`, { url: article.url, thumbnail_url: thumbnail });
          return current() ? thumbnail : undefined;
        });
      } catch {
        this.retryAfter.set(key, Date.now() + 60_000);
        if (this.retryAfter.size > 512) this.retryAfter.delete(this.retryAfter.keys().next().value!);
      }
    })().finally(() => this.requests.delete(key));
    this.requests.set(key, work);
    return work;
  }
}
const thumbnails = new ThumbnailLoader();

export function useArticleThumbnail<T extends Element>(article: ArticleItem, account: string, onResolved?: (id: string, fields: Partial<ArticleItem>) => void) {
  const ref = useRef<T>(null), publish = useRef(onResolved);
  publish.current = onResolved;
  const key = identity(account, article);
  const [found, setFound] = useState<{ key: string; url: string } | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!account || article.thumbnail_url || !element) return;
    let active = true;
    let observer: IntersectionObserver | undefined, retry: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      void thumbnails.lookup(account, article).then((url) => {
        if (!active) return;
        if (url === undefined) { retry = setTimeout(() => { if (active) { if (observer) observer.observe(element); else load(); } }, 60_000); return; }
        setFound({ key, url });
        if (url !== article.thumbnail_url) publish.current?.(article.id, { thumbnail_url: url });
      });
    };
    const cleanup = () => { active = false; clearTimeout(retry); observer?.disconnect(); };
    if (typeof IntersectionObserver === 'undefined') { load(); return cleanup; }
    observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer!.disconnect(); load();
    }, { rootMargin: '300px 0px' });
    observer.observe(element);
    return cleanup;
  }, [account, article.id, article.url, article.thumbnail_url]);
  return { ref, url: article.thumbnail_url || (found?.key === key ? found.url : null) };
}
