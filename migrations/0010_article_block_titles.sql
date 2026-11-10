ALTER TABLE articles ADD COLUMN block_title TEXT;

CREATE INDEX IF NOT EXISTS idx_articles_missing_block_title
  ON articles(feed_id) WHERE block_title IS NULL;
