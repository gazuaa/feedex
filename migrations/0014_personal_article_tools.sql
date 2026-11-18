CREATE TABLE IF NOT EXISTS user_article_tool_keys (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service TEXT NOT NULL CHECK(service IN ('deepl','workers-ai')),
  encrypted_value TEXT NOT NULL,
  PRIMARY KEY (user_id, service)
);

CREATE TABLE IF NOT EXISTS user_article_tool_results (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  variant TEXT NOT NULL,
  result_json TEXT NOT NULL,
  PRIMARY KEY (user_id, article_id, variant)
);
