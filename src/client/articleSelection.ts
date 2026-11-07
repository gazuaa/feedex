import { useLayoutEffect, type RefObject } from 'react';

/** 선택한 글이 바뀌면 목록 안의 이전 포커스도 옮긴다. 본문·검색창의 포커스는 유지한다. */
export function followArticleSelection(list: HTMLElement | null, selectedId: string | null, focused: Element | null, scroll: boolean) {
  if (!list || !selectedId) return;
  const selected = Array.from(list.querySelectorAll<HTMLElement>('[data-article-id]')).find((row) => row.dataset.articleId === selectedId);
  if (!selected) return;
  const previous = focused?.closest('[data-article-id]');
  if (previous && list.contains(previous) && previous !== selected) selected.focus({ preventScroll: true });
  if (scroll && selected.getClientRects().length) selected.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
}

export function useArticleSelection(list: RefObject<HTMLElement | null>, selectedId: string | null, rowsKey: string) {
  useLayoutEffect(() => {
    followArticleSelection(list.current, selectedId, document.activeElement, window.matchMedia('(min-width: 1024px)').matches);
  }, [list, selectedId, rowsKey]);
}
