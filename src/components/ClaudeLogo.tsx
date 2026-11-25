/** Claude 로고를 닮은 빛살 무늬. 가운데에서 둥근 빛살 여덟 개가 퍼진다. */
export function ClaudeLogo({ size = 16 }: { size?: number | string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true">
    {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, index) => <line key={angle} x1="12" y1="12" x2="12" y2={index % 2 ? 4.5 : 2.5} transform={`rotate(${angle} 12 12)`} />)}
  </svg>;
}
