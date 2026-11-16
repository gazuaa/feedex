import type { ArticleViewMode, UserPreferences } from './api';
import { DEFAULT_AUTO_REFRESH_MINUTES, validAutoRefresh } from '../shared/preferences';

export const deviceKind = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches ? 'mobile' : 'desktop';
const key = (account: string, kind = deviceKind()) => `sfeed_device_preferences:${account}:${kind}`;
const defaults: UserPreferences = { layout: 'magazine', theme: 'dark', unreadOnly: false, markReadOnScroll: false, autoRefreshMinutes: DEFAULT_AUTO_REFRESH_MINUTES };
export function readDevicePreferences(account: string, kind = deviceKind(), legacy: Partial<UserPreferences> = {}): UserPreferences {
  let saved: Partial<UserPreferences> = {};
  try { saved = JSON.parse(localStorage.getItem(key(account, kind)) || 'null') || legacy; } catch { saved = legacy; }
  return { layout: ['magazine', 'cards', 'list'].includes(saved.layout!) ? saved.layout! : defaults.layout,
    theme: saved.theme === 'light' || saved.theme === 'system' ? saved.theme : 'dark', unreadOnly: saved.unreadOnly === true,
    markReadOnScroll: saved.markReadOnScroll === true, autoRefreshMinutes: validAutoRefresh(saved.autoRefreshMinutes) ? saved.autoRefreshMinutes : defaults.autoRefreshMinutes };
}
export function saveDevicePreferences(account: string, next: Partial<UserPreferences>, kind = deviceKind()) {
  const value = { ...readDevicePreferences(account, kind), ...next };
  try { localStorage.setItem(key(account, kind), JSON.stringify(value)); } catch {}
  return value;
}
const feedKey = (account: string, feed: string, kind = deviceKind()) => `${key(account, kind)}:feed:${feed}`;
export function readFeedPreference(account: string, feed: string, kind = deviceKind()): { view?: ArticleViewMode; zoom?: number } {
  try { return JSON.parse(localStorage.getItem(feedKey(account, feed, kind)) || '{}'); } catch { return {}; }
}
export function feedViewPreference(account: string, feed: string, shared: ArticleViewMode | null | undefined, kind = deviceKind()): ArticleViewMode {
  if (shared === 'feed' || shared === 'reader' || shared === 'web') return shared;
  const legacy = readFeedPreference(account, feed, kind).view;
  return legacy === 'reader' || legacy === 'web' ? legacy : 'feed';
}
export function saveFeedPreference(account: string, feed: string, next: { view?: ArticleViewMode; zoom?: number }, kind = deviceKind()) {
  try { localStorage.setItem(feedKey(account, feed, kind), JSON.stringify({ ...readFeedPreference(account, feed, kind), ...next })); } catch {}
}
