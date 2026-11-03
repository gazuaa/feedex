export interface FeedHistoryOptions { days: number; limit: number; markRead: boolean }
export const HISTORY_DAYS = [0, 30, 90, 365] as const;
export const HISTORY_LIMITS = [100, 500, 1000, 5000] as const;
export const DEFAULT_HISTORY_OPTIONS: FeedHistoryOptions = { days: 365, limit: 1000, markRead: true };
export interface FeedHistoryProgress {
  revision: number;
  status: 'paused' | 'done';
  reason: 'ready' | 'limit' | 'period' | 'end' | 'source_limit' | 'unsupported' | 'error' | 'rate_limit';
  options: FeedHistoryOptions;
  added: number;
  checked: number;
  duplicates: number;
  unknownDates: number;
  pages: number;
  oldest: string | null;
  startedAt: string;
  updatedAt: string;
  retryAt: number | null;
  message: string;
}
export interface FeedHistoryResponse { job: FeedHistoryProgress | null }
export function validHistoryOptions(value: unknown): value is FeedHistoryOptions {
  const item = value as FeedHistoryOptions | null;
  return !!item && (HISTORY_DAYS as readonly number[]).includes(item.days) && (HISTORY_LIMITS as readonly number[]).includes(item.limit) && typeof item.markRead === 'boolean';
}
