export function retryAfterMs(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isSafeInteger(delay) && delay > 0 ? delay : 0;
}
