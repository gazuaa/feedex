import { useLayoutEffect, type RefObject } from 'react';

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

// 막힌 손동작을 손가락으로 끌고, 놓은 뒤에는 iOS처럼 관성으로 미끄러지게 한다.
const DRIVE_AFTER_MS = 64, DECELERATION = 0.998, MAX_SPEED = 8, MIN_SPEED = 0.02;
type Sample = { y: number; t: number };
const stamp = (event: Event, view: Window) => Number.isFinite(event.timeStamp) && event.timeStamp > 0 ? event.timeStamp : view.performance?.now?.() ?? Date.now();
/** 마지막 100ms의 손가락 움직임으로 스크롤 속도(px/ms)를 잰다. 손가락을 멈췄다 떼면 관성이 없다. */
export function releaseVelocity(samples: Sample[], releasedAt: number) {
  const last = samples[samples.length - 1];
  if (!last || releasedAt - last.t > 60) return 0;
  const first = samples.find((sample) => last.t - sample.t <= 100) ?? last;
  const elapsed = last.t - first.t;
  if (elapsed < 8) return 0;
  return Math.max(-MAX_SPEED, Math.min(MAX_SPEED, (first.y - last.y) / elapsed));
}

/**
 * 세로 입력이 있었는데 네이티브 스크롤이 전혀 움직이지 않았을 때만 복구한다.
 * 막힌 손동작은 손을 뗄 때까지 기다리지 않고 손가락을 따라 옮기며, 놓은 뒤 관성으로 이어 간 다음
 * 멈춘 자리에서 스크롤 계층을 다시 만든다. 놓은 뒤에야 손가락 이동만큼 한 번에 옮기면 관성이 없어 스크롤이 느리게 느껴진다.
 */
export function bindMobileScrollRecovery(root: HTMLElement) {
  const doc = root.ownerDocument, view = doc.defaultView;
  if (!view) return () => {};
  let frame = 0, glide = 0, restore: (() => void) | undefined;
  let gesture: { x: number; y: number; lastY: number; top: number; at: number; prevented: boolean; driving: boolean; native: boolean; expected: number; samples: Sample[] } | null = null;
  const stopGlide = () => { view.cancelAnimationFrame(glide); glide = 0; };
  const cancel = () => { gesture = null; view.cancelAnimationFrame(frame); };
  const allowed = () => !rebuildingScroll(root) && !root.closest('[inert], [aria-hidden="true"]') && !doc.querySelector('dialog[open], [aria-modal="true"]') && (view.visualViewport?.scale ?? 1) <= 1.05;
  const max = () => root.scrollHeight - root.clientHeight;
  const rebuild = () => { restore?.(); restore = rebuildScrollSurface(root); };
  // 관성이 끝나거나 끝에 닿으면 계층을 다시 만든다. 다른 코드가 위치를 바꾸면(목록 전환 등) 그 자리를 따른다.
  const slide = (speed: number) => {
    stopGlide();
    if (Math.abs(speed) < MIN_SPEED) { rebuild(); return; }
    let velocity = speed, expected = root.scrollTop, last = view.performance?.now?.() ?? Date.now();
    const step = () => {
      glide = 0;
      if (!allowed() || Math.abs(root.scrollTop - expected) > 2) return;
      const now = view.performance?.now?.() ?? Date.now(), elapsed = Math.min(64, Math.max(1, now - last));
      last = now;
      const target = clamp(expected + velocity * elapsed, max());
      root.scrollTop = target; expected = root.scrollTop;
      velocity *= DECELERATION ** elapsed;
      if (Math.abs(velocity) < MIN_SPEED || target <= 0 || target >= max()) { rebuild(); return; }
      glide = view.requestAnimationFrame(step);
    };
    glide = view.requestAnimationFrame(step);
  };
  const start = (event: TouchEvent) => {
    cancel(); stopGlide();
    if (event.touches.length !== 1 || !allowed() || (event.target as Element | null)?.closest('input,textarea,select,video,audio,[contenteditable="true"],[role="slider"]')) return;
    const touch = event.touches[0], at = stamp(event, view);
    gesture = { x: touch.clientX, y: touch.clientY, lastY: touch.clientY, top: root.scrollTop, at, prevented: false, driving: false, native: false, expected: root.scrollTop, samples: [{ y: touch.clientY, t: at }] };
  };
  const move = (event: TouchEvent) => {
    if (!gesture) return;
    if (event.touches.length !== 1 || !allowed()) { cancel(); return; }
    const touch = event.touches[0], dx = Math.abs(touch.clientX - gesture.x), dy = Math.abs(touch.clientY - gesture.y), at = stamp(event, view);
    if (dx > 12 && dx > dy && !gesture.driving) { cancel(); return; }
    gesture.lastY = touch.clientY; gesture.prevented ||= event.defaultPrevented;
    gesture.samples.push({ y: touch.clientY, t: at });
    if (gesture.samples.length > 12) gesture.samples.shift();
    if (gesture.prevented || gesture.native) return;
    const wanted = clamp(gesture.top + gesture.y - touch.clientY, max());
    if (gesture.driving) {
      // 네이티브 스크롤이 살아나면 그쪽에 맡긴다.
      if (Math.abs(root.scrollTop - gesture.expected) > 2) { gesture.driving = false; gesture.native = true; return; }
      root.scrollTop = wanted; gesture.expected = root.scrollTop;
      return;
    }
    if (Math.abs(root.scrollTop - gesture.top) > 2) { gesture.native = true; return; }
    // 정상 스크롤도 위치가 조금 늦게 도착할 수 있어, 충분히 끌고 시간이 지난 뒤에도 그대로일 때만 대신 끈다.
    if (dy < 24 || Math.abs(wanted - gesture.top) < 12 || at - gesture.at < DRIVE_AFTER_MS) return;
    gesture.driving = true; root.scrollTop = wanted; gesture.expected = root.scrollTop;
  };
  const end = (event: TouchEvent) => {
    const finished = gesture; gesture = null;
    if (!finished || finished.prevented || finished.native || event.defaultPrevented || !allowed()) return;
    const speed = releaseVelocity(finished.samples, stamp(event, view));
    if (finished.driving) {
      if (Math.abs(root.scrollTop - finished.expected) <= 2) slide(speed);
      return;
    }
    const distance = finished.y - finished.lastY;
    const wanted = clamp(finished.top + distance, max());
    if (Math.abs(distance) < 24 || Math.abs(wanted - finished.top) < 12) return;
    // 짧게 튕긴 손동작: 정상 스크롤은 비동기로 도착할 수 있으므로 두 프레임 기다리고 움직임을 다시 확인한다.
    frame = view.requestAnimationFrame(() => { frame = view.requestAnimationFrame(() => {
      if (!allowed() || Math.abs(root.scrollTop - finished.top) > 2) return;
      root.scrollTop = wanted;
      slide(speed);
    }); });
  };
  root.addEventListener('touchstart', start, { passive: true });
  root.addEventListener('touchmove', move, { passive: true });
  root.addEventListener('touchend', end, { passive: true });
  root.addEventListener('touchcancel', cancel, { passive: true });
  return () => {
    cancel(); stopGlide(); restore?.();
    root.removeEventListener('touchstart', start); root.removeEventListener('touchmove', move); root.removeEventListener('touchend', end); root.removeEventListener('touchcancel', cancel);
  };
}

export function useMobileScrollRecovery(ref: RefObject<HTMLElement | null>, visible: boolean, key: string) {
  useLayoutEffect(() => {
    if (!visible) return;
    const root = ref.current;
    if (!root || !needsMobileScrollRecovery(navigator.userAgent, navigator.maxTouchPoints)) return;
    return bindMobileScrollRecovery(root);
  }, [ref, visible, key]);
}
