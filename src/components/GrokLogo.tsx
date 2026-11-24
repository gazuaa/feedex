/** Grok 로고(비스듬한 선이 지나는 원). 다른 아이콘과 같은 선 굵기로 그린다. */
export function GrokLogo({ size = 16 }: { size?: number | string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
    <path d="M16.6 5.4A8 8 0 0 0 5.4 16.6" /><path d="M18.6 7.4A8 8 0 0 1 7.4 18.6" /><path d="M4 20 20 4" />
  </svg>;
}
