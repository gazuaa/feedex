import { parseHTML } from 'linkedom';
import { fetchPage, renderPage, webCopy } from './rssBuilder';
import type { Env } from './types';
import type { AssetProxy } from './pageAssets';

function usable(html: string) {
  const { document } = parseHTML(html);
  const title = document.querySelector('title')?.textContent || '';
  if (/security checkpoint|just a moment|verify you are human|access denied|sign in|log in/i.test(title)) return false;
  const article = document.querySelector('article, main, [itemprop="articleBody"]');
  return ((article ? article.textContent : document.body?.textContent) || '').trim().length > 120;
}
/**
 * `phone`은 서버가 받은 페이지를 건너뛴다. 어떤 사이트는 데스크톱 배치를 보내고 스크립트로
 * 휴대폰 배치로 바꾸는데, 스크립트 없는 사본은 그 스크립트를 돌리지 않는다.
 * 휴대폰 크기로 렌더링한 페이지는 이미 스크립트를 돌린 결과다.
 */
export async function fetchWebView(url: string, env: Pick<Env, 'BROWSER'>, phone = false, assets?: AssetProxy) {
  if (!phone) try {
    const original = await fetchPage(url);
    if (usable(original.html)) return { html: webCopy(original.html, original.url, assets), url: original.url };
  } catch { /* 공개 브라우저 렌더링으로 JavaScript가 그리는 페이지를 얻을 수 있다. */ }
  if (env.BROWSER) {
    const rendered = await renderPage(url, env, 'article', phone);
    if (usable(rendered.html)) return { html: webCopy(rendered.html, rendered.url, assets), url: rendered.url };
  }
  throw new Error('원문 사이트를 표시하지 못했습니다.');
}
