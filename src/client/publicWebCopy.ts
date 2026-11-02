import { fetchPublicWebPage, preparePublicWebPage, type PublicContent } from '../shared/publicWebPage';
import { markdownArticleHtml } from '../shared/markdownArticle';
import { revealLazyImages } from '../shared/lazyImages';
import { dropSidebars } from '../shared/sidebars';
import { dropEmptySlots } from '../shared/emptySlots';
import { plainCopyStyles } from '../shared/copyStyles';
import { dropConsentBanners } from '../shared/consentBanners';

export class PublicWebCopyError extends Error {
  constructor(readonly reason: 'challenge' | 'login' | 'restricted', message: string) { super(message); }
}

export function sanitizePublicWebCopy(html: string, url: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html');
  if (/security checkpoint|just a moment|verify you are human|access denied/i.test(document.title)) throw new PublicWebCopyError('challenge', '사이트의 보안 확인으로 웹 사본을 불러오지 못했습니다. 원문을 새 창에서 열어 주세요.');
  if (/sign in|log in/i.test(document.title)) throw new PublicWebCopyError('login', '원문 사이트에서 로그인이 필요한 페이지입니다.');
  if (/"isAccessibleForFree"\s*:\s*false/.test(html)) throw new PublicWebCopyError('restricted', '원문 사이트의 구독 권한이 필요한 기사입니다.');
  const article = document.querySelector('article,main,[itemprop="articleBody"]');
  if (((article ? article.textContent : document.body?.textContent) || '').trim().length < 120) throw new Error('웹 사본의 본문이 비어 있습니다.');
  document.querySelectorAll('script,noscript,iframe,frame,frameset,object,embed,applet,template,base,meta[http-equiv],link[rel~="preload"],link[rel~="modulepreload"],link[rel~="prefetch"]').forEach((node) => node.remove());
  for (const element of document.querySelectorAll('*')) for (const { name, value } of Array.from(element.attributes)) {
    if (/^on/i.test(name) || /^srcdoc$/i.test(name) || (/^(?:href|src|action|formaction|xlink:href)$/i.test(name) && /^\s*(?:javascript|vbscript|data:text\/html)/i.test(value))) element.removeAttribute(name);
  }
  revealLazyImages(document, url);
  // 광고 스크립트·프레임을 지우면 높고 빈 광고판 자리가 남는다.
  for (const slot of document.querySelectorAll('.ad-container, [id^="google_ads_"]')) {
    if (slot.textContent?.trim() || slot.querySelector('img[src],picture,video,audio,svg')) continue;
    let parent = slot.parentElement; slot.remove();
    while (parent && parent !== document.body && /^(DIV|SECTION|ASIDE)$/.test(parent.tagName) && !parent.children.length && !parent.textContent?.trim()) {
      const next = parent.parentElement; parent.remove(); parent = next;
    }
  }
  dropEmptySlots(document);
  dropConsentBanners(document);
  dropSidebars(document);
  plainCopyStyles(document);
  const base = document.createElement('base'); base.setAttribute('href', url); base.setAttribute('target', '_blank');
  const charset = document.createElement('meta'); charset.setAttribute('charset', 'utf-8');
  document.head.prepend(charset, base);
  return '<!doctype html>' + document.documentElement.outerHTML;
}
/**
 * 본문 요청을 마친 뒤 HTML을 다시 묻기 전에 기다리는 시간(ms). 본문 요청이 그린 결과가 리더 서비스
 * 캐시에 들어가기까지 잠깐 걸린다. 테스트는 이 배열을 짧게 바꿔 쓴다.
 */
export const checkpointRetryDelays = [1500];
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface PublicWebCopy { html: string; url: string; textOnly?: boolean }
/**
 * 공개 기사의 웹 사본. 원래 배치 HTML이 기본이다. `patient`는 사용자가 직접 연 글이라는 뜻이다.
 * 원문 사이트가 리더 서비스의 HTML 요청을 잠시 막아 보안 확인 화면이 오면, 본문 요청으로 페이지를
 * 실제 브라우저로 그리게 한 뒤 HTML을 한 번 더 묻는다. 그래도 원래 배치가 오지 않으면 받은 본문으로
 * 만든 "본문만 보기"(textOnly)를 돌려준다. 캐시를 건너뛰는 요청은 매번 원문 사이트에 새로 가서 다시
 * 막히므로 쓰지 않는다. 미리 받기는 보안 확인에서 바로 포기한다.
 */
export async function loadPublicWebCopy(url: string, options: { patient?: boolean } = {}): Promise<PublicWebCopy | null> {
  const deadline = Date.now() + 25000;
  const remaining = () => deadline - Date.now();
  const copy = (page: { html: string; url: string }) => ({ html: sanitizePublicWebCopy(page.html, page.url), url: page.url });
  const page = await fetchPublicWebPage(url, { timeoutMs: remaining() });
  if (!page) return null;
  try { return copy(page); }
  catch (error) {
    if (!(error instanceof PublicWebCopyError) || error.reason !== 'challenge' || !options.patient) throw error;
    let content: PublicContent | null = null;
    try { content = await preparePublicWebPage(url, { timeoutMs: remaining() }); } catch {}
    if (content) {
      for (const delay of checkpointRetryDelays) {
        if (remaining() < delay + 1500) break;
        await wait(delay);
        try {
          const retried = await fetchPublicWebPage(url, { timeoutMs: remaining() });
          if (retried) return copy(retried);
        } catch (retryError) {
          // 로그인·유료 기사처럼 분명한 제한은 바로 알린다. 보안 확인이나 일시 오류면 본문만 보기로 넘어간다.
          if (retryError instanceof PublicWebCopyError && retryError.reason !== 'challenge') throw retryError;
        }
      }
      return { html: markdownArticleHtml(content.markdown, content.url, content.title), url: content.url, textOnly: true };
    }
    throw error;
  }
}
