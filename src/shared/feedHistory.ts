import { t } from './i18n';
export interface FeedHistoryOptions { days: number; limit: number; markRead: boolean }
export const HISTORY_DAYS = [0, 7, 14, 30, 60, 90, 180, 365, 730, 1095, 1825, 3650] as const;
export const HISTORY_LIMITS = [0, 50, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000, 20000, 50000] as const;
export const DEFAULT_HISTORY_OPTIONS: FeedHistoryOptions = { days: 365, limit: 1000, markRead: true };
const DAY_LABELS: Record<number, [string, string]> = {
  0: ['전체 기간', 'All time'],
  7: ['최근 7일 (1주)', 'Last 7 days (1 week)'],
  14: ['최근 14일 (2주)', 'Last 14 days (2 weeks)'],
  30: ['최근 30일 (1개월)', 'Last 30 days (1 month)'],
  60: ['최근 60일 (2개월)', 'Last 60 days (2 months)'],
  90: ['최근 90일 (3개월)', 'Last 90 days (3 months)'],
  180: ['최근 180일 (6개월)', 'Last 180 days (6 months)'],
  365: ['최근 1년 (365일)', 'Last year (365 days)'],
  730: ['최근 2년 (730일)', 'Last 2 years (730 days)'],
  1095: ['최근 3년 (1,095일)', 'Last 3 years (1,095 days)'],
  1825: ['최근 5년 (1,825일)', 'Last 5 years (1,825 days)'],
  3650: ['최근 10년 (3,650일)', 'Last 10 years (3,650 days)'],
};
export const historyDaysLabel = (days: number): string => DAY_LABELS[days] ? t(...DAY_LABELS[days]) : days ? t(`최근 ${days.toLocaleString()}일`, `Last ${days.toLocaleString()} days`) : t('전체 기간', 'All time');
export const historyLimitLabel = (limit: number): string => limit ? t(`${limit.toLocaleString()}개`, limit.toLocaleString()) : t('전체 개수', 'No limit');
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
