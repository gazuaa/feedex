import { rebuildingScroll } from './mobileScrollRecovery';
import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
export function useListAnchor(ref: RefObject<HTMLElement | null>, rows: unknown[], scope: string) {
  // 맨 위에 보이던 행이 목록에서 빠져도 바로 다음 행으로 자리를 잡도록 뒤의 행도 기억한다.
  const anchor = useRef<{ ids: string[]; offset: number; scope: string } | null>(null), shown = useRef(scope);
  useLayoutEffect(() => {
    const root = ref.current; if (!root) return;
    const remember = () => {
      if (rebuildingScroll(root)) return;
      if (root.scrollTop < 8) { anchor.current = null; return; }
      const top = root.getBoundingClientRect().top;
      const items = [...root.querySelectorAll<HTMLElement>('[data-article-id]')];
      const at = items.findIndex((item) => item.getBoundingClientRect().bottom > top);
      anchor.current = at < 0 ? null : { ids: items.slice(at, at + 12).map((item) => item.dataset.articleId!), offset: items[at].getBoundingClientRect().top - top, scope };
    };
    // 목록이 바뀐 첫 그리기에는 아직 앞 목록의 행이 화면에 있다. 이것을 새 목록의 위치로 기억하면
    // 같은 글이 있는 새 목록이 맨 위가 아니라 그 글 자리로 열린다.
    const switched = shown.current !== scope; shown.current = scope;
    if (switched) anchor.current = null;
    const previous = anchor.current;
    if (previous?.scope === scope && !rebuildingScroll(root)) {
      const items = new Map([...root.querySelectorAll<HTMLElement>('[data-article-id]')].map((item) => [item.dataset.articleId, item]));
      const row = previous.ids.map((id) => items.get(id)).find(Boolean);
      if (row) root.scrollTop += row.getBoundingClientRect().top - root.getBoundingClientRect().top - previous.offset;
    }
    if (!switched) remember();
    root.addEventListener('scroll', remember, { passive: true });
    return () => root.removeEventListener('scroll', remember);
  }, [ref, rows, scope]);
  // 일부러 맨 위로 보낼 때 부른다. 스크롤 이벤트보다 목록 갱신이 먼저 오면 기억한 행으로 되돌아간다.
  return useCallback(() => { anchor.current = null; }, []);
}
