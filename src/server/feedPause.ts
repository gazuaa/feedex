import type { D1DatabaseLike } from './types';

// subscriptions.paused_at은 출시 뒤에 생겼다 (migrations/0004). 데이터베이스에 이 열이
// 생기기 전에는 모든 쿼리가 멈춘 피드가 없는 것처럼 동작해서, 마이그레이션을 적용하기
// 전에도 배포가 깨지지 않는다.
const support = new WeakMap<D1DatabaseLike, { supported: boolean; at: number }>();
export async function pauseSupported(db: D1DatabaseLike): Promise<boolean> {
  const known = support.get(db);
  if (known && (known.supported || Date.now() - known.at < 60_000)) return known.supported;
  const supported = await db.prepare('SELECT paused_at FROM subscriptions LIMIT 0').all().then(() => true, () => false);
  support.set(db, { supported, at: Date.now() });
  return supported;
}

/** 멈춘 구독이 여전히 보여 주는 글: 멈추기 전에 저장된 글. */
export const shownToSubscriber = (supported: boolean, s = 's', a = 'a') =>
  supported ? `(${s}.paused_at IS NULL OR ${a}.created_at <= ${s}.paused_at)` : '1=1';
export const pausedAtColumn = (supported: boolean, s = 's') => supported ? `${s}.paused_at` : 'NULL';
