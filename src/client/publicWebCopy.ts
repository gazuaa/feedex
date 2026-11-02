import { fetchPublicWebPage, preparePublicWebPage } from '../shared/publicWebPage';
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
 * 보안 확인 화면을 받은 뒤 HTML을 다시 묻기 전에 기다리는 시간(ms). 원문 사이트가 리더 서비스에
 * 거는 요청 제한(429)은 보통 몇 초~몇십 초 안에 풀리므로, 간격을 늘려 가며 몇 번만 다시 묻는다.
 * 테스트는 이 배열을 짧게 바꿔 쓴다.
 */
export const checkpointRetryDelays = [2000, 3000, 5000, 8000];
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 공개 기사의 원래 웹 배치 사본. `patient`는 사용자가 직접 연 글이라는 뜻이다. 그때만 보안 확인
 * 화면에서 포기하지 않고, 본문 준비 요청을 함께 보내며 HTML을 다시 묻는다. 미리 받기는 한 번만 묻는다.
 * 마크다운 본문을 원래 웹사이트처럼 보여 주지는 않는다.
 */
export async function loadPublicWebCopy(url: string, options: { fresh?: boolean; patient?: boolean } = {}) {
  const deadline = Date.now() + (options.patient ? 25000 : 20000);
  const remaining = () => deadline - Date.now();
  const copy = (page: { html: string; url: string }) => ({ html: sanitizePublicWebCopy(page.html, page.url), url: page.url });
  const page = await fetchPublicWebPage(url, { fresh: options.fresh, timeoutMs: remaining() });
  if (!page) return null;
  try { return copy(page); }
  catch (error) {
    if (!(error instanceof PublicWebCopyError) || error.reason !== 'challenge' || !options.patient) throw error;
    // 본문 요청은 페이지를 한 번 그리게 할 뿐 결과를 기다리지 않는다. 다시 묻는 HTML은 캐시를
    // 건너뛰어(fresh), 리더 서비스가 방금 받은 보안 확인 화면을 되돌려 주지 않게 한다.
    void preparePublicWebPage(url, { timeoutMs: remaining() }).catch(() => false);
    for (const delay of checkpointRetryDelays) {
      if (remaining() < delay + 1500) break;
      await wait(delay);
      try {
        const retried = await fetchPublicWebPage(url, { fresh: true, timeoutMs: remaining() });
        if (retried) return copy(retried);
      } catch (retryError) {
        // 로그인·유료 기사처럼 분명한 제한은 바로 알리고, 보안 확인이나 일시 오류면 다음 차례에 다시 묻는다.
        if (retryError instanceof PublicWebCopyError && retryError.reason !== 'challenge') throw retryError;
      }
    }
    throw error;
  }
}
