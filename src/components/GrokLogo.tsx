/**
 * Grok 로고. 오른쪽 위가 끊긴 원을 굵은 비스듬한 선이 왼쪽 아래에서 오른쪽 위로 관통하고, 오른쪽 아래에 작은 조각이 붙는 모양.
 * 다른 아이콘과 나란히 보이도록 같은 크기 틀(24)에 채운 도형으로 그린다.
 */
export function GrokLogo({ size = 16 }: { size?: number | string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M14.9 4.3A8.4 8.4 0 0 0 5.2 17.8l1.7-1.7A6 6 0 0 1 13.6 6.6z" />
    <path d="M19.6 8.6l-1.9 1.9a6 6 0 0 1-7.6 7.2L8.3 19.5a8.4 8.4 0 0 0 11.3-10.9z" />
    <path d="M2.6 21.4 21.4 2.6 22.6 3.8 3.8 22.6z" />
  </svg>;
}
