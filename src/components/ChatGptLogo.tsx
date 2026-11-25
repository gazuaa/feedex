/**
 * ChatGPT(OpenAI) 로고를 닮은 육각 매듭. 둥근 고리 여섯 개를 육각형 둘레를 따라 눕혀 조금씩 비껴 놓아,
 * 서로 맞물리고 가운데에 육각형 구멍이 생기게 한다.
 */
export function ChatGptLogo({ size = 16 }: { size?: number | string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
    {[0, 60, 120, 180, 240, 300].map((angle) => <rect key={angle} x="7.6" y="4" width="12" height="5.2" rx="2.6" transform={`rotate(${angle} 12 12)`} />)}
  </svg>;
}
