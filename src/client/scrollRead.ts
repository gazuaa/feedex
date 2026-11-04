import { useEffect, useRef, type RefObject } from 'react';

type ScrollReadOptions = { onRead: (ids: string[]) => void; canRead: () => boolean };

export function bindScrollRead(root: HTMLElement, options: ScrollReadOptions) {
  if (typeof IntersectionObserver === 'undefined') return () => {};
  const doc = root.ownerDocument, view = doc.defaultView!;
  const observed = new Set<HTMLElement>(), seen = new Set<HTMLElement>(), pending = new Set<string>();
  let top = Math.max(0, root.scrollTop), intentUntil = 0, downward = false, frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const allowed = () => options.canRead() && doc.visibilityState !== 'hidden' && !root.closest('[inert], [aria-hidden="true"]') && !doc.querySelector('dialog[open], .feedex-mobile-settings[open], .feedex-desktop-settings[open]');
  const flush = () => {
    timer = undefined;
    if (!allowed()) { pending.clear(); return; }
    const ids = [...pending].slice(0, 50);
    ids.forEach((id) => pending.delete(id));
    if (ids.length) options.onRead(ids);
    if (pending.size) timer = setTimeout(flush, 250);
  };
  const inspect = () => {
    frame = 0;
    const shouldRead = downward && allowed();
    downward = false;
    const bounds = root.getBoundingClientRect();
    for (const row of seen) {
      if (!row.isConnected) { seen.delete(row); continue; }
      const box = row.getBoundingClientRect();
      if (box.bottom <= bounds.top + 1) {
        if (shouldRead && row.dataset.articleRead !== 'true' && row.dataset.articleId) pending.add(row.dataset.articleId);
        seen.delete(row);
      } else if (box.top >= bounds.bottom) seen.delete(row);
    }
    if (pending.size && !timer) timer = setTimeout(flush, 250);
  };
  const schedule = () => { if (!frame) frame = view.requestAnimationFrame(inspect); };
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const row = entry.target as HTMLElement;
      if (entry.isIntersecting) seen.add(row);
      else if (seen.has(row)) schedule();
    }
  }, { root, threshold: 0 });
  const sync = () => {
    const rows = new Set(root.querySelectorAll<HTMLElement>('[data-article-id]'));
    for (const row of observed) if (!rows.has(row)) { observer.unobserve(row); observed.delete(row); seen.delete(row); }
    for (const row of rows) if (!observed.has(row)) { observed.add(row); observer.observe(row); }
  };
  const mutation = typeof MutationObserver !== 'undefined' ? new MutationObserver(sync) : null;
  mutation?.observe(root, { childList: true, subtree: true });
  sync();
  const intent = () => { if (allowed()) intentUntil = Date.now() + 1500; };
  const key = (event: KeyboardEvent) => { if (['ArrowDown', 'PageDown', 'End', ' '].includes(event.key) && !/INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement)?.tagName)) intent(); };
  const pointer = (event: PointerEvent) => { if (event.clientX >= root.getBoundingClientRect().right - 20) intent(); };
  const scroll = () => {
    const next = Math.max(0, root.scrollTop);
    downward = next > top && Date.now() < intentUntil;
    if (downward) intentUntil = Date.now() + 1500;
    top = next;
    schedule();
  };
  root.addEventListener('wheel', intent, { passive: true });
  root.addEventListener('touchmove', intent, { passive: true });
  root.addEventListener('keydown', key);
  root.addEventListener('pointerdown', pointer);
  root.addEventListener('scroll', scroll, { passive: true });
  return () => {
    observer.disconnect(); mutation?.disconnect(); view.cancelAnimationFrame(frame); clearTimeout(timer);
    root.removeEventListener('wheel', intent); root.removeEventListener('touchmove', intent); root.removeEventListener('keydown', key); root.removeEventListener('pointerdown', pointer); root.removeEventListener('scroll', scroll);
    pending.clear(); seen.clear();
  };
}

export function useScrollRead(ref: RefObject<HTMLElement | null>, enabled: boolean, resetKey: string, onRead: (ids: string[]) => void) {
  const latest = useRef({ enabled, onRead });
  latest.current = { enabled, onRead };
  useEffect(() => {
    if (!enabled || !ref.current) return;
    return bindScrollRead(ref.current, { canRead: () => latest.current.enabled, onRead: (ids) => latest.current.onRead(ids) });
  }, [ref, enabled, resetKey]);
}
