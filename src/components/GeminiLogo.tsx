import { useId } from 'react';

/** Gemini 로고를 닮은 네 갈래 별. 파랑에서 빨강·노랑·초록으로 번지는 색을 입힌다. */
export function GeminiLogo({ size = 16 }: { size?: number | string }) {
  const id = useId().replace(/:/g, '');
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-a`} x1="4" y1="20" x2="20" y2="4" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#34a853" /><stop offset=".35" stopColor="#4285f4" /><stop offset="1" stopColor="#4285f4" /></linearGradient>
      <radialGradient id={`${id}-b`} cx="7" cy="7" r="9" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#ea4335" /><stop offset=".5" stopColor="#fbbc04" stopOpacity=".85" /><stop offset="1" stopColor="#fbbc04" stopOpacity="0" /></radialGradient>
    </defs>
    <path d="M12 2c.6 5.3 4.7 9.4 10 10-5.3.6-9.4 4.7-10 10-.6-5.3-4.7-9.4-10-10 5.3-.6 9.4-4.7 10-10z" fill={`url(#${id}-a)`} />
    <path d="M12 2c.6 5.3 4.7 9.4 10 10-5.3.6-9.4 4.7-10 10-.6-5.3-4.7-9.4-10-10 5.3-.6 9.4-4.7 10-10z" fill={`url(#${id}-b)`} />
  </svg>;
}
