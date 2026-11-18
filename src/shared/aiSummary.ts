import { lang, type Lang } from './i18n';

// 예전 요약은 열 때 새 형식으로 다시 만든다. 피드 본문만 쓴 경우에는 범위를 함께 보여 준다.
export const SUMMARY_HEADINGS = {
  full: '**핵심 요약**',
  feed: '**핵심 요약 · 피드 본문 기준**',
  x: '**X 대화 요약**',
} as const;
export type SummarySource = keyof typeof SUMMARY_HEADINGS;

const EN_SUMMARY_HEADINGS = {
  full: '**Key takeaways**',
  feed: '**Key takeaways · From the feed**',
  x: '**X conversation summary**',
} satisfies Record<SummarySource, string>;

export const summaryHeadings = (language: Lang) => language === 'en' ? EN_SUMMARY_HEADINGS : SUMMARY_HEADINGS;

export function isCurrentSummary(value: string | null | undefined, source?: SummarySource, language = lang()): boolean {
  const headings = summaryHeadings(language);
  if (source) return Boolean(value?.startsWith(headings[source] + '\n'));
  return Object.values(headings).some(heading => value?.startsWith(heading + '\n'));
}
