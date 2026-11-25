/** Claude 로고를 닮은 주황 빛살. 길이가 조금씩 다른 빛살 열두 개가 가운데에서 퍼진다. */
export function ClaudeLogo({ size = 16 }: { size?: number | string }) {
  const rays = [[0, 10], [30, 8.2], [60, 9.4], [90, 7.6], [120, 9.8], [150, 8], [180, 9.2], [210, 7.8], [240, 10], [270, 8.4], [300, 9], [330, 7.4]];
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#d97757" strokeWidth={2.1} strokeLinecap="round" aria-hidden="true">
    {rays.map(([angle, length]) => <line key={angle} x1="12" y1="12" x2="12" y2={12 - length} transform={`rotate(${angle} 12 12)`} />)}
  </svg>;
}
