import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/** 선택한 글이 바뀌면 목록 안의 이전 포커스도 옮긴다. 본문·검색창의 포커스는 유지한다. */
export function followArticleSelection(list: HTMLElement | null, selectedId: string | null, focused: Element | null, scroll: boolean): boolean {
  if (!list || !selectedId) return false;
  const selected = Array.from(list.querySelectorAll<HTMLElement>('[data-article-id]')).find((row) => row.dataset.articleId === selectedId);
  if (!selected) return false;
  const previous = focused?.closest('[data-article-id]');
  if (previous && list.contains(previous) && previous !== selected) selected.focus({ preventScroll: true });
  if (scroll && selected.getClientRects().length) selected.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  return true;
}

/** 목록을 스크롤해 화면 밖으로 벗어난 글 행에 포커스가 남아 있으면, 다른 창에 갔다 돌아올 때 WebView가 그 행으로 스크롤을 되돌리지 않게 포커스를 푼다. */
export function blurOffscreenArticleFocus(list: HTMLElement | null, focused: Element | null) {
  if (!list || !(focused instanceof HTMLElement)) return;
  const row = focused.closest<HTMLElement>('[data-article-id]');
  if (!row || !list.contains(row)) return;
  const bounds = list.getBoundingClientRect(), rect = row.getBoundingClientRect();
  if (rect.bottom <= bounds.top || rect.top >= bounds.bottom) focused.blur();
}

export function useArticleSelection(list: RefObject<HTMLElement | null>, selectedId: string | null, rowsKey: string) {
  const followedId = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!selectedId) { followedId.current = null; return; }
    const shouldScroll = followedId.current !== selectedId && window.matchMedia('(min-width: 1024px)').matches;
    if (followArticleSelection(list.current, selectedId, document.activeElement, shouldScroll)) {
      followedId.current = selectedId;
    }
  }, [list, selectedId, rowsKey]);
  useEffect(() => {
    const root = list.current;
    if (!root) return;
    const clear = () => blurOffscreenArticleFocus(root, document.activeElement);
    root.addEventListener('scroll', clear, { passive: true });
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', clear);
    return () => {
      root.removeEventListener('scroll', clear);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', clear);
    };
  }, [list]);
}
