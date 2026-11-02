CREATE TABLE IF NOT EXISTS integration_settings (
  name TEXT PRIMARY KEY,
  encrypted_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
