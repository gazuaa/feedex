import type { D1DatabaseLike } from './types';

// SQLite는 표 통계를 보고 쿼리에서 읽을 순서를 고른다. 통계가 없으면 글 몇 개를 찾으면서
// 구독한 글 전체를 읽는 순서를 고를 수 있고, 그러면 D1이 과부하로 다른 요청까지 거절한다.
// 0x10002는 모든 표를 표본 제한 없이 살핀다. 기본값으로는 작은 표가 빠지거나 추정이 부정확해 전체 글 목록이 그대로 느렸다.
// 통계가 이미 있으면 표가 크게 늘어나기 전까지 아무 일도 하지 않으므로 예약 실행마다 불러도 된다.
export async function refreshQueryStats(db: D1DatabaseLike) {
  const { meta } = await db.prepare('PRAGMA optimize=0x10002').run();
  if (Number(meta?.rows_written)) console.log('쿼리 통계 갱신:', JSON.stringify({ duration: meta?.duration, rows_read: meta?.rows_read, rows_written: meta?.rows_written }));
}
