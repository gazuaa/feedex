import { parseHTML } from 'linkedom';
import { sanitizeContentHtml } from './rssParser';
import { extractOriginalPublishedAt } from './publicationDate';
import { extractPreviewImage } from './previewImage';
import { publicPageUrl, renderPage } from './rssBuilder';
import { revealLazyImages } from '../shared/lazyImages';
import { preserveYouTubeIframes } from '../shared/youtubeEmbed';
import { dropSiteClasses } from '../shared/siteClasses';
import { dropArticleChrome, pageTitles } from '../shared/articleChrome';
import type { Env } from './types';

export const READER_FALLBACK_MARK = 'reader-fallback-content';
export const realFullContent = (html: string | null | undefined): string | null =>
  html && !html.includes(READER_FALLBACK_MARK) ? html : null;

export interface ScrapedArticleResult {
  fullContentHtml: string | null;
  leadImageUrl: string | null;
  scrapedFromWeb: boolean;
  originalPublishedAt: string | null;
}

/** 읽을 수 있는 공개 기사 본문만 뽑는다. 확인 화면과 로그인 페이지는 절대 캐시하지 않는다. */
export function extractReaderContent(html: string, url: string, fallbackHtml: string | null): ScrapedArticleResult | null {
  const { document } = parseHTML(html);
  if (/security checkpoint|just a moment|verify you are human|access denied|sign in|log in/i.test(document.querySelector('title')?.textContent || '') || /"isAccessibleForFree"\s*:\s*false/.test(html)) return null;
  const leadImageUrl = extractPreviewImage(html, url);
  const originalPublishedAt = extractOriginalPublishedAt(html, url) || extractOriginalPublishedAt(fallbackHtml, url);
  const titles = pageTitles(document);
  document.querySelectorAll('script,style,noscript,template,nav,header,footer,aside,form,object,embed,svg,math,link,meta,base,[hidden],[aria-hidden="true"]').forEach((node) => node.remove());
  preserveYouTubeIframes(document, url);
  revealLazyImages(document, url);
  const readable = (node: { textContent: string | null; querySelector?(selector: string): unknown }) =>
    (node.textContent || '').replace(/\s+/g, ' ').trim().length > 120 ||
    (Boolean(node.querySelector?.('iframe[src*="youtube.com/embed/"]')) && (node.textContent || '').replace(/\s+/g, ' ').trim().length > 20);
  const candidates = [...document.querySelectorAll('[itemprop="articleBody"],article,.entry-content,.article-content,.prose,#contents,#article-view-content-div,.article_view,.view_content')].filter(readable).sort((a, b) => (b.textContent?.length || 0) - (a.textContent?.length || 0));
  const content = candidates[0] || document.querySelector('main');
  const blocks = [...(content || document).querySelectorAll('p,h2,h3,blockquote,pre,ul,ol,iframe')];
  const candidate = candidates[0]?.innerHTML || (content && readable(content) ? content.innerHTML : blocks.slice(0, 80).map((node) => node.outerHTML).join('\n'));
  const { document: safe } = parseHTML(`<div id="reader-body">${candidate}</div>`);
  for (const element of safe.querySelectorAll('*')) {
    for (const { name, value } of Array.from(element.attributes)) {
      if (/^on/i.test(name) || ['srcdoc', 'style'].includes(name.toLowerCase()) || (/^(?:href|src|action|formaction|xlink:href)$/i.test(name) && /^\s*(?:javascript|vbscript|data:text\/html)/i.test(value))) element.removeAttribute(name);
    }
  }
  dropArticleChrome(safe.querySelector('#reader-body')!, titles);
  dropSiteClasses(safe.querySelector('#reader-body')!);
  const sanitized = sanitizeContentHtml(safe.querySelector('#reader-body')?.innerHTML || '', url);
  if (!sanitized || (sanitized.replace(/<[^>]+>/g, '').trim().length <= 120 && !sanitized.includes('youtube.com/embed/'))) return null;
  return { fullContentHtml: sanitized, leadImageUrl, scrapedFromWeb: true, originalPublishedAt };
}

export async function scrapeFullArticle(url: string, fallbackHtml: string | null, _title: string, env?: Pick<Env, 'BROWSER'>): Promise<ScrapedArticleResult> {
  const unavailable = (): ScrapedArticleResult => ({ fullContentHtml: null, leadImageUrl: null, scrapedFromWeb: false, originalPublishedAt: extractOriginalPublishedAt(fallbackHtml, url) });
  try { publicPageUrl(url); } catch { return unavailable(); }
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FeedEx/1.0)', Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(7000), redirect: 'follow',
    });
    if (res.ok && res.headers.get('x-vercel-mitigated') !== 'challenge' && res.headers.get('cf-mitigated') !== 'challenge') {
      const result = extractReaderContent((await res.text()).slice(0, 2_000_000), publicPageUrl(res.url || url), fallbackHtml);
      if (result) return result;
    } else await res.body?.cancel();
  } catch { /* 아래의 공개 브라우저 렌더링 페이지를 시도한다. */ }
  if (env?.BROWSER) {
    try {
      const page = await renderPage(url, env, 'article');
      const result = extractReaderContent(page.html, page.url, fallbackHtml);
      if (result) return result;
    } catch { /* 실제 피드 본문이나 조치할 수 있는 오류를 남긴다. */ }
  }
  return unavailable();
}
