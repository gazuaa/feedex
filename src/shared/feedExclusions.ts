/** Feed exclusions only narrow the library's All / Unread lists. */
export function parseExcludedFeeds(value: unknown): string[] {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200))].slice(0, 1000).sort();
}

export function scopedExcludedFeeds(scope: string | null, savedOnly: boolean, value: unknown): string[] {
  return scope === 'all' && !savedOnly ? parseExcludedFeeds(value) : [];
}
