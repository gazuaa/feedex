-- X 계정은 공개 미러 RSS가 최신 글 약 20개만 준다. 예전 글은 미러가 알려 주는 다음 쪽으로
-- 조금씩 채우고, 계정마다 다음에 받을 쪽의 위치를 여기에 기억한다. cursor가 NULL이면 다 받았다.
CREATE TABLE IF NOT EXISTS x_backfill (
  feed_id TEXT PRIMARY KEY REFERENCES feeds(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  cursor TEXT,
  pages INTEGER NOT NULL DEFAULT 1,
  failures INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_x_backfill_due ON x_backfill(updated_at) WHERE cursor IS NOT NULL;
