-- 과거 글 수집은 사용자가 요청한 피드만 한 쪽씩 진행하고 계정별 위치를 보관한다.
CREATE TABLE IF NOT EXISTS feed_history_jobs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  state_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, feed_id)
);
-- RSS의 guid와 웹 목록의 URL이 달라도 같은 글인지 빠르게 확인한다.
CREATE INDEX IF NOT EXISTS idx_articles_feed_url ON articles(feed_id, url);
