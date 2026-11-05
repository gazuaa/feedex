import { useLayoutEffect, useRef, type RefObject } from 'react';
export function useListAnchor(ref: RefObject<HTMLElement | null>, rows: unknown[], scope: string) {
  // 맨 위에 보이던 행이 목록에서 빠져도 바로 다음 행으로 자리를 잡도록 뒤의 행도 기억한다.
  const anchor = useRef<{ ids: string[]; offset: number; scope: string } | null>(null);
  useLayoutEffect(() => {
    const root = ref.current; if (!root) return;
    const remember = () => {
      if (root.scrollTop < 8) { anchor.current = null; return; }
      const top = root.getBoundingClientRect().top;
      const items = [...root.querySelectorAll<HTMLElement>('[data-article-id]')];
      const at = items.findIndex((item) => item.getBoundingClientRect().bottom > top);
      anchor.current = at < 0 ? null : { ids: items.slice(at, at + 12).map((item) => item.dataset.articleId!), offset: items[at].getBoundingClientRect().top - top, scope };
    };
    const previous = anchor.current;
    if (previous?.scope === scope) {
      const items = new Map([...root.querySelectorAll<HTMLElement>('[data-article-id]')].map((item) => [item.dataset.articleId, item]));
      const row = previous.ids.map((id) => items.get(id)).find(Boolean);
      if (row) root.scrollTop += row.getBoundingClientRect().top - root.getBoundingClientRect().top - previous.offset;
    }
    remember(); root.addEventListener('scroll', remember, { passive: true });
    return () => root.removeEventListener('scroll', remember);
  }, [ref, rows, scope]);
}
