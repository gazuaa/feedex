/** ChatGPT(OpenAI) 로고를 닮은 매듭 무늬. 둥근 고리 여섯 개를 60도씩 돌려 겹친다. */
export function ChatGptLogo({ size = 16 }: { size?: number | string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
    {[0, 60, 120, 180, 240, 300].map((angle) => <rect key={angle} x="8.6" y="2.6" width="6.8" height="11.6" rx="3.4" transform={`rotate(${angle} 12 12)`} />)}
  </svg>;
}
