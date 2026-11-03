// 로그인 쿠키는 원문 사이트의 창에서만 사용한다. SFeed 서버로 복사하지 않는다.
const windows = new Map<string, Window>();
export function originalArticleUrl(value: string): URL | null {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url : null; } catch { return null; }
}
/** 같은 사이트의 로그인·기사 창을 재사용하되, 원문에는 SFeed를 조작할 opener를 주지 않는다. */
export function openOriginalArticle(value: string, browser: Pick<Window, 'open'> = window): boolean {
  const url = originalArticleUrl(value); if (!url) return false;
  const existing = windows.get(url.origin);
  if (existing) try { if (!existing.closed) { existing.location.href = url.href; existing.focus(); return true; } } catch { windows.delete(url.origin); }
  const popup = browser.open('about:blank', '_blank', 'popup=yes,width=1120,height=850,resizable=yes,scrollbars=yes');
  if (!popup) return false;
  try { popup.opener = null; popup.location.replace(url.href); popup.focus(); windows.set(url.origin, popup); return true; }
  catch { try { popup.close(); } catch { /* 열리지 않은 창은 링크의 기본 동작으로 다시 연다. */ } return false; }
}
/** 돌아왔다는 사실만 알린다. 외부 사이트의 로그인 성공 여부를 추측하지 않는다. */
export function watchOriginalReturn(browser: Pick<Window, 'addEventListener' | 'removeEventListener'>, doc: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>, returned: () => void): () => void {
  let stopped = false;
  const stop = () => { stopped = true; browser.removeEventListener('focus', focus); doc.removeEventListener('visibilitychange', visible); };
  const finish = () => { if (!stopped && doc.visibilityState === 'visible') { stop(); returned(); } };
  const focus = () => finish(), visible = () => { if (doc.visibilityState === 'visible') finish(); };
  browser.addEventListener('focus', focus); doc.addEventListener('visibilitychange', visible);
  return stop;
}
