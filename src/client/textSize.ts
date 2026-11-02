import { useSyncExternalStore } from 'react';

export const FONT_SCALES = [0.85, 0.92, 1, 1.1, 1.2, 1.35, 1.5];
const key = 'sfeed_font_scale';
let current: number | undefined;
const listeners = new Set<() => void>();
export function readTextSize(): number {
  if (current !== undefined) return current;
  try { const saved = Number(localStorage.getItem(key)); return current = FONT_SCALES.includes(saved) ? saved : 1; }
  catch { return current = 1; }
}
export function setTextSize(value: number) {
  if (!FONT_SCALES.includes(value)) return;
  current = value;
  try { localStorage.setItem(key, String(value)); } catch { /* 이번 세션 동안은 크기를 유지한다 */ }
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const storage = (event: StorageEvent) => { if (event.key === key || event.key === null) { current = undefined; listener(); } };
  window.addEventListener('storage', storage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', storage); };
};
export function useTextSize() { return [useSyncExternalStore(subscribe, readTextSize, () => 1), setTextSize] as const; }
