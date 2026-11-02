export const RETENTION_OPTIONS = [1, 7, 14, 30, 60, 90] as const;
export const CONTENT_LIMIT = 256 * 1024 * 1024;
/** 기기에 저장하는 목록 수: 메모리에 두는 것보다 많이, 모든 폴더의 첫 화면을 담을 만큼. */
export const SNAPSHOT_LIMITS = { entries: 160, bytes: 32 * 1024 * 1024 };
export function retentionDays(account: string) {
  try { const days = Number(localStorage.getItem(`sfeed_cache_days:${account}`)); return (RETENTION_OPTIONS as readonly number[]).includes(days) ? days : 30; } catch { return 30; }
}
export const retentionAge = (account: string) => retentionDays(account) * 86400_000;
export function setRetentionDays(account: string, days: number) {
  if (!(RETENTION_OPTIONS as readonly number[]).includes(days)) return;
  try { localStorage.setItem(`sfeed_cache_days:${account}`, String(days)); } catch {}
}
export const estimateBytes = (value: unknown): number => typeof value === 'string' ? value.length * 2 : !value || typeof value !== 'object' ? 8 : Object.entries(value).reduce((sum, [key, child]) => sum + key.length * 2 + estimateBytes(child), 32);
export const cacheGeneration = new Map<string, number>();
