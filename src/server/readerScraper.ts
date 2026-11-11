import { parseHTML } from 'linkedom';
import { sanitizeContentHtml } from './rssParser';
import { extractOriginalPublishedAt } from './publicationDate';
import { extractPreviewImage } from './previewImage';
import { publicPageUrl, renderPage } from './rssBuilder';
import { revealLazyImages } from '../shared/lazyImages';
import { preserveYouTubeIframes } from '../shared/youtubeEmbed';
import { dropSiteClasses } from '../shared/siteClasses';
import { dropArticleChrome, pageTitles } from '../shared/articleChrome';
import { fetchPublicWebPage } from '../shared/publicWebPage';
import type { Env } from './types';

export const READER_FALLBACK_MARK = 'reader-fallback-content';
export const realFullContent = (html: string | null | undefined): string | null =>
  html && !html.includes(READER_FALLBACK_MARK) ? html : null;
const READER_BODY_VERSION = '<!--feedex-reader-body:2-->';

/** 예전 추출기가 기사 대신 짧은 카드나 미리보기를 저장한 경우 한 번 다시 뽑는다. */
export function readerBodyNeedsRefresh(html: string): boolean {
  if (html.startsWith(READER_BODY_VERSION)) return false;
  const { document } = parseHTML(`<div id="reader-check">${html}</div>`);
  const body = document.getElementById('reader-check');
  return (body?.querySelectorAll('p').length ?? 0) <= 1 && (body?.textContent?.trim().length ?? 0) < 1_000;
}

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
  const longest = (selector: string) => [...document.querySelectorAll(selector)].filter(readable)
    .sort((a, b) => (b.textContent?.length || 0) - (a.textContent?.length || 0))[0];
  // 예를 들어 Decrypt의 article 태그는 관련 글 카드이고 실제 본문은 .post-content에 있다.
  const articleBody = longest('[itemprop="articleBody"], .post-content, .entry-content, .article-content, #article-view-content-div, .article_view, .view_content')
    || longest('article:has(p), .prose, #contents');
  const content = articleBody || document.querySelector('main');
  const blocks = [...(content || document).querySelectorAll('p,h2,h3,blockquote,pre,ul,ol,iframe')];
  const candidate = content && readable(content) ? content.innerHTML : blocks.slice(0, 80).map((node) => node.outerHTML).join('\n');
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

export async function scrapeFullArticle(url: string, fallbackHtml: string | null, _title: string, env?: Pick<Env, 'BROWSER'>, phone = false): Promise<ScrapedArticleResult> {
  const unavailable = (): ScrapedArticleResult => ({ fullContentHtml: null, leadImageUrl: null, scrapedFromWeb: false, originalPublishedAt: extractOriginalPublishedAt(fallbackHtml, url) });
  const extracted = (html: string, resolvedUrl: string) => {
    const result = extractReaderContent(html, resolvedUrl, fallbackHtml);
    return result?.fullContentHtml ? { ...result, fullContentHtml: READER_BODY_VERSION + result.fullContentHtml } : null;
  };
  try { publicPageUrl(url); } catch { return unavailable(); }
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FeedEx/1.0)', Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(7000), redirect: 'follow',
    });
    if (res.ok && res.headers.get('x-vercel-mitigated') !== 'challenge' && res.headers.get('cf-mitigated') !== 'challenge') {
      const result = extracted((await res.text()).slice(0, 2_000_000), publicPageUrl(res.url || url));
      if (result) return result;
    } else await res.body?.cancel();
  } catch { /* 아래의 공개 브라우저 렌더링 페이지를 시도한다. */ }
  if (env?.BROWSER) {
    try {
      const page = await renderPage(url, env, 'article', phone);
      const result = extracted(page.html, page.url);
      if (result) return result;
    } catch { /* 실제 피드 본문이나 조치할 수 있는 오류를 남긴다. */ }
  }
  try {
    const page = await fetchPublicWebPage(url, { timeoutMs: 8_000 });
    if (page) {
      const result = extracted(page.html, page.url);
      if (result) return result;
    }
  } catch { /* 웹 보기와 같은 공개 사본도 받지 못했다. */ }
  return unavailable();
}
