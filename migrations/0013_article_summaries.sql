CREATE TABLE IF NOT EXISTS article_summaries (
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  summary TEXT NOT NULL,
  PRIMARY KEY (article_id, language)
);
