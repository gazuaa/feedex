import { useSyncExternalStore } from 'react';
import type { ThemeMode, ThemePreference } from './api';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export const parseThemePreference = (value: unknown): ThemePreference => value === 'light' || value === 'system' ? value : 'dark';

export function readStoredTheme(): ThemePreference {
  try { return parseThemePreference(localStorage.getItem('sfeed:theme')); }
  catch { return 'dark'; }
}

/** 기기의 밝은·어두운 모드. */
export const systemTheme = (): ThemeMode => typeof window !== 'undefined' && window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light';
export const resolveTheme = (preference: ThemePreference): ThemeMode => preference === 'system' ? systemTheme() : preference;

const subscribeSystem = (listener: () => void) => {
  const media = typeof window !== 'undefined' ? window.matchMedia?.(DARK_QUERY) : undefined;
  media?.addEventListener('change', listener);
  return () => media?.removeEventListener('change', listener);
};
/** 고른 모드를 실제로 그릴 색으로 바꾼다. 시스템을 고르면 기기 모드가 바뀌는 즉시 따라간다. */
export function useResolvedTheme(preference: ThemePreference): ThemeMode {
  const system = useSyncExternalStore(subscribeSystem, systemTheme, () => 'dark' as ThemeMode);
  return preference === 'system' ? system : preference;
}

export function applyTheme(theme: ThemeMode, preference: ThemePreference = theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#020617' : '#f8fafc');
  try { localStorage.setItem('sfeed:theme', preference); } catch {}
}
