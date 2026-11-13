// 웹 보기 안에서는 브라우저가 원문 사이트에 로그인 정보(쿠키)를 보내지 않는다. 그래서 원문은 FeedEx 창에서
// 바로 열어, 사이트를 직접 연 것처럼 로그인하고 읽게 한다. 로그인 정보는 브라우저와 원문 사이트 사이에만 있고
// FeedEx 서버로 오지 않는다.
export function originalArticleUrl(value: string): URL | null {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url : null; } catch { return null; }
}

/** 공개 연구 글은 모바일에서 사이트의 보안 확인을 원문 창에서 진행한다. */
export function mobileOriginalArticle(value: string): URL | null {
  const url = originalArticleUrl(value);
  return url?.origin === 'https://research.4pillars.io' && /^\/(?:ko|en)\/research\/[^/]+\/?$/.test(url.pathname) ? url : null;
}
/** 이 창에서 원문으로 넘어가는 클릭인지. 새 탭이나 새 창으로 여는 클릭이면 FeedEx는 그대로 남는다. */
export function leavesForOriginal(event: Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'defaultPrevented'>): boolean {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
