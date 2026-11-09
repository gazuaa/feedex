import { useLayoutEffect, useRef, type RefObject } from 'react';

const rebuilding = 'data-scroll-rebuilding';
const rebuildingRoots = new WeakMap<HTMLElement, () => void>();
const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
export const rebuildingScroll = (root: HTMLElement) => Boolean(root.hasAttribute?.(rebuilding));
export const needsMobileScrollRecovery = (agent: string, touches: number) => /iPhone|iPad|iPod/.test(agent) || /Macintosh/.test(agent) && touches > 1;

/** DOM과 기사 캐시는 유지하고, iOS의 스크롤 계층만 두 프레임 동안 없앴다가 다시 만든다. */
export function rebuildScrollSurface(root: HTMLElement, requestedTop?: number) {
  rebuildingRoots.get(root)?.();
  const top = requestedTop ?? root.scrollTop;
  const view = root.ownerDocument.defaultView, content = root.firstElementChild as HTMLElement | null;
  if (!view || !content) return () => {};
  if (view.CSS?.supports && !view.CSS.supports('overflow', 'clip')) { root.scrollTop = top; return () => {}; }
  const saved = ['overflow', 'pointer-events', 'overflow-anchor'].map(name => [name, root.style.getPropertyValue(name), root.style.getPropertyPriority(name)]);
  const transform = [content.style.getPropertyValue('transform'), content.style.getPropertyPriority('transform')];
  let frame = 0, done = false;
  const restore = () => {
    if (done) return;
    done = true; view.cancelAnimationFrame(frame);
    for (const [name, value, priority] of saved) { if (value) root.style.setProperty(name, value, priority); else root.style.removeProperty(name); }
    if (transform[0]) content.style.setProperty('transform', transform[0], transform[1]); else content.style.removeProperty('transform');
    root.scrollTop = clamp(top, root.scrollHeight - root.clientHeight);
    root.removeAttribute(rebuilding); rebuildingRoots.delete(root);
  };
  root.setAttribute(rebuilding, ''); rebuildingRoots.set(root, restore);
  root.style.setProperty('overflow', 'clip', 'important');
  root.style.setProperty('pointer-events', 'none', 'important');
  root.style.setProperty('overflow-anchor', 'none');
  // 스크롤 위치가 잠시 사라져도 본문은 눈에 보이던 자리에 둔다.
  content.style.setProperty('transform', `translateY(${-top}px)`, 'important');
  void root.offsetHeight;
  frame = view.requestAnimationFrame(() => { frame = view.requestAnimationFrame(restore); });
  return restore;
}

/** 세로 입력이 있었는데 네이티브 스크롤이 전혀 움직이지 않았을 때만 복구한다. */
export function bindMobileScrollRecovery(root: HTMLElement) {
  const doc = root.ownerDocument, view = doc.defaultView;
  if (!view) return () => {};
  let frame = 0, restore: (() => void) | undefined;
  let gesture: { x: number; y: number; lastY: number; top: number; prevented: boolean } | null = null;
  const cancel = () => { gesture = null; view.cancelAnimationFrame(frame); };
  const allowed = () => !rebuildingScroll(root) && !root.closest('[inert], [aria-hidden="true"]') && !doc.querySelector('dialog[open], [aria-modal="true"]') && (view.visualViewport?.scale ?? 1) <= 1.05;
  const start = (event: TouchEvent) => {
    cancel();
    if (event.touches.length !== 1 || !allowed() || (event.target as Element | null)?.closest('input,textarea,select,video,audio,[contenteditable="true"],[role="slider"]')) return;
    const touch = event.touches[0];
    gesture = { x: touch.clientX, y: touch.clientY, lastY: touch.clientY, top: root.scrollTop, prevented: false };
  };
  const move = (event: TouchEvent) => {
    if (!gesture) return;
    if (event.touches.length !== 1 || !allowed()) { cancel(); return; }
    const touch = event.touches[0], dx = Math.abs(touch.clientX - gesture.x), dy = Math.abs(touch.clientY - gesture.y);
    if (dx > 12 && dx > dy) { cancel(); return; }
    gesture.lastY = touch.clientY; gesture.prevented ||= event.defaultPrevented;
  };
  const end = (event: TouchEvent) => {
    const finished = gesture; gesture = null;
    if (!finished || finished.prevented || event.defaultPrevented || !allowed()) return;
    const distance = finished.y - finished.lastY;
    const wanted = clamp(finished.top + distance, root.scrollHeight - root.clientHeight);
    if (Math.abs(distance) < 24 || Math.abs(wanted - finished.top) < 12) return;
    // 정상 스크롤은 비동기로 도착할 수 있으므로 두 프레임 기다리고 움직임을 다시 확인한다.
    frame = view.requestAnimationFrame(() => { frame = view.requestAnimationFrame(() => {
      if (!allowed() || Math.abs(root.scrollTop - finished.top) > 2) return;
      restore?.(); restore = rebuildScrollSurface(root, wanted);
    }); });
  };
  root.addEventListener('touchstart', start, { passive: true });
  root.addEventListener('touchmove', move, { passive: true });
  root.addEventListener('touchend', end, { passive: true });
  root.addEventListener('touchcancel', cancel, { passive: true });
  return () => {
    cancel(); restore?.();
    root.removeEventListener('touchstart', start); root.removeEventListener('touchmove', move); root.removeEventListener('touchend', end); root.removeEventListener('touchcancel', cancel);
  };
}

export function useMobileScrollRecovery(ref: RefObject<HTMLElement | null>, visible: boolean, key: string) {
  const wasCovered = useRef(true);
  useLayoutEffect(() => {
    if (!visible) { wasCovered.current = true; return; }
    const root = ref.current;
    if (!root || !needsMobileScrollRecovery(navigator.userAgent, navigator.maxTouchPoints)) return;
    const restore = wasCovered.current ? rebuildScrollSurface(root) : () => {};
    wasCovered.current = false;
    const unbind = bindMobileScrollRecovery(root);
    return () => { unbind(); restore(); };
  }, [ref, visible, key]);
}
