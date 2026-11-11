// 예전 요약은 열 때 새 형식으로 다시 만든다. 피드 본문만 쓴 경우에는 범위를 함께 보여 준다.
export const SUMMARY_HEADINGS = {
  full: '**핵심 요약**',
  feed: '**핵심 요약 · 피드 본문 기준**',
} as const;
export type SummarySource = keyof typeof SUMMARY_HEADINGS;

export function isCurrentSummary(value: string | null | undefined, source?: SummarySource): boolean {
  if (source) return Boolean(value?.startsWith(SUMMARY_HEADINGS[source] + '\n'));
  return isCurrentSummary(value, 'full') || isCurrentSummary(value, 'feed');
}
