import { installPlatform } from './pwa';

// 원문 사이트를 직접 열어 브라우저에 저장된 로그인 상태를 사용한다.
export function originalArticleUrl(value: string): URL | null {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url : null; } catch { return null; }
}

/** 공개 연구 글은 모바일에서 사이트의 보안 확인을 원문 창에서 진행한다. */
export function mobileOriginalArticle(value: string): URL | null {
  const url = originalArticleUrl(value);
  return url?.origin === 'https://research.4pillars.io' && /^\/(?:ko|en)\/research\/[^/]+\/?$/.test(url.pathname) ? url : null;
}

/** iOS 홈 화면 앱은 외부 브라우저를 닫을 때 그대로 돌아오도록 앱 기록을 건드리지 않는다. */
export function opensOriginalSeparately(browser = typeof navigator === 'undefined' ? undefined : navigator as Navigator & { standalone?: boolean },
  standalone = typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches) {
  return Boolean(browser && installPlatform(browser.userAgent, browser.maxTouchPoints) === 'ios' && (browser.standalone || standalone));
}
/** 이 창에서 원문으로 넘어가는 클릭인지. 새 탭이나 새 창으로 여는 클릭이면 FeedEx는 그대로 남는다. */
export function leavesForOriginal(event: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'defaultPrevented'>): boolean {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
