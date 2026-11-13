-- X 미러 상태. 미러마다 마지막 성공과 실패를 남긴다(요청 한도는 x_provider_cooldowns).
-- 앱이 처음 쓸 때도 같은 표를 만든다(src/server/xMirrorHealth.ts). 이 파일은 새 DB를 만들 때와 기록용이다.
CREATE TABLE IF NOT EXISTS x_provider_health (
  provider TEXT PRIMARY KEY,
  last_ok_at INTEGER,
  failing_since INTEGER,
  last_failure_at INTEGER,
  last_failure TEXT,
  last_limited_at INTEGER
);
