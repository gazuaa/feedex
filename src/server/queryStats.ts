import type { D1DatabaseLike } from './types';

// 사용자가 적은 시간(한국 시각 새벽 4시)에 하루 한 번 돈다.
const STATS_HOUR_UTC = 19;

// SQLite는 표 통계를 보고 쿼리에서 읽을 순서를 고른다. 통계가 없으면 시작 데이터나 글 개수 쿼리가
// 필요 이상으로 많이 읽는다. 표를 한 번씩 훑는 작업이라 예약 실행마다 돌리지 않는다.
// PRAGMA optimize=0x10002는 로컬에서는 통계를 만들었지만 운영 D1에서는 쿼리가 줄지 않아 쓰지 않는다.
export async function refreshQueryStats(db: D1DatabaseLike, scheduledTime = Date.now()) {
  const at = new Date(scheduledTime);
  if (at.getUTCHours() !== STATS_HOUR_UTC || at.getUTCMinutes() >= 15) return;
  const { meta } = await db.prepare('ANALYZE').run();
  console.log('쿼리 통계 갱신:', JSON.stringify({ duration: meta?.duration, rows_read: meta?.rows_read, rows_written: meta?.rows_written }));
}
