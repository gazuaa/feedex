import { useEffect, useRef, useState } from 'react';

export const PULL_REFRESH_THRESHOLD = 64;
type PullOptions = { canRefresh: () => boolean; onRefresh: () => void | Promise<void>; onProgress: (distance: number) => void };

export function bindPullRefresh(doc: Document, options: PullOptions) {
  let gesture: { x: number; y: number; root: HTMLElement; distance: number } | null = null;
  let refreshing = false, active = true;
  const reset = () => { gesture = null; if (active) options.onProgress(0); };
  const allowed = () => options.canRefresh() && !refreshing && doc.visibilityState !== 'hidden' && !doc.querySelector('dialog[open], .sfeed-mobile-settings[open]') && (doc.defaultView?.visualViewport?.scale ?? 1) <= 1;
  const start = (event: TouchEvent) => {
    reset();
    if (event.touches.length !== 1 || !allowed()) return;
    const target = event.target as Element | null;
    if (target?.closest?.('input, textarea, select, a, [contenteditable="true"]')) return;
    const root = target?.closest?.('.sfeed-mobile-library-scroll, #feed-article-list') as HTMLElement | null;
    if (!root || root.scrollTop > 0 || root.closest('[inert], [aria-hidden="true"]')) return;
    gesture = { x: event.touches[0].clientX, y: event.touches[0].clientY, root, distance: 0 };
  };
  const move = (event: TouchEvent) => {
    if (!gesture) return;
    if (event.touches.length !== 1 || !allowed() || !event.cancelable || gesture.root.scrollTop > 0) { reset(); return; }
    const dx = Math.abs(event.touches[0].clientX - gesture.x), dy = event.touches[0].clientY - gesture.y;
    // 가로 동작은 뒤로 가기에 쓰도록 남겨 둔다.
    if (dy < 0 || (dx > 10 && dx * 1.3 >= dy)) { reset(); return; }
    if (dy <= 8) return;
    event.preventDefault();
    gesture.distance = Math.min(88, (dy - 8) * .55);
    options.onProgress(gesture.distance);
  };
  const end = () => {
    const ready = Boolean(gesture && gesture.distance >= PULL_REFRESH_THRESHOLD && allowed());
    reset();
    if (!ready) return;
    refreshing = true;
    void Promise.resolve().then(() => { if (active) return options.onRefresh(); }).catch(() => {}).finally(() => { refreshing = false; reset(); });
  };
  doc.addEventListener('touchstart', start, { passive: true });
  doc.addEventListener('touchmove', move, { passive: false });
  doc.addEventListener('touchend', end);
  doc.addEventListener('touchcancel', reset);
  doc.defaultView?.addEventListener('popstate', reset);
  return () => {
    reset(); active = false;
    doc.removeEventListener('touchstart', start); doc.removeEventListener('touchmove', move);
    doc.removeEventListener('touchend', end); doc.removeEventListener('touchcancel', reset);
    doc.defaultView?.removeEventListener('popstate', reset);
  };
}

export function usePullRefresh(enabled: boolean, refreshing: boolean, onRefresh: () => Promise<void>) {
  const [distance, setDistance] = useState(0);
  const latest = useRef({ refreshing, onRefresh });
  latest.current = { refreshing, onRefresh };
  useEffect(() => {
    if (!enabled) return;
    return bindPullRefresh(document, { canRefresh: () => !latest.current.refreshing, onRefresh: () => latest.current.onRefresh(), onProgress: setDistance });
  }, [enabled]);
  return enabled ? distance : 0;
}
