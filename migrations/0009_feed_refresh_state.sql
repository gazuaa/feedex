CREATE TABLE IF NOT EXISTS feed_refresh_state (
  feed_id TEXT PRIMARY KEY REFERENCES feeds(id) ON DELETE CASCADE,
  attempted_at TEXT NOT NULL,
  retry_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS x_provider_cooldowns (
  provider TEXT PRIMARY KEY,
  retry_at INTEGER NOT NULL
);
