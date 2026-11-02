-- SFeed 다중 사용자 RSS 서비스 스키마 (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  picture TEXT,
  google_id TEXT UNIQUE,
  preferences_json TEXT DEFAULT '{"layout":"magazine","theme":"dark","unreadOnly":false}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#10b981',
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id);

CREATE TABLE IF NOT EXISTS feeds (
  id TEXT PRIMARY KEY,
  xml_url TEXT UNIQUE NOT NULL,
  html_url TEXT,
  title TEXT NOT NULL,
  description TEXT,
  favicon_url TEXT,
  category_hint TEXT,
  last_fetched_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feeds_xml_url ON feeds(xml_url);

CREATE TABLE IF NOT EXISTS rss_builders (
  id TEXT PRIMARY KEY,
  feed_id TEXT UNIQUE NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  selector TEXT NOT NULL,
  title TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  feed_id TEXT NOT NULL,
  folder_id TEXT,
  custom_title TEXT,
  created_at TEXT NOT NULL,
  -- 이 시각 뒤에 저장된 새 글은 숨긴다 (0004_subscription_pause.sql).
  paused_at TEXT,
  UNIQUE(user_id, feed_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE,
  FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_folder ON subscriptions(folder_id);

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL,
  guid TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  author TEXT,
  summary TEXT,
  content_html TEXT,
  full_content_html TEXT,
  ai_summary TEXT,
  thumbnail_url TEXT,
  published_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(feed_id, guid),
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

-- published_at이 같을 때 id로 순서를 정해, 키셋 페이지 나눔이 모든 글을
-- 정렬하지 않고 이 인덱스를 따라가게 한다 (피드에는 몇 년 치 글이 있을 수 있다).
CREATE INDEX IF NOT EXISTS idx_articles_feed_pub_id ON articles(feed_id, published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_articles_pub_id ON articles(published_at DESC, id DESC);
DROP INDEX IF EXISTS idx_articles_feed_pub;
DROP INDEX IF EXISTS idx_articles_pub;

CREATE TABLE IF NOT EXISTS article_states (
  user_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  is_read INTEGER DEFAULT 0,
  is_saved INTEGER DEFAULT 0,
  read_at TEXT,
  saved_at TEXT,
  PRIMARY KEY (user_id, article_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_article_states_user_saved ON article_states(user_id, is_saved);
CREATE INDEX IF NOT EXISTS idx_article_states_user_read ON article_states(user_id, is_read);

-- 사용자가 피드마다 고른 본문 보기 (피드 본문 / 리더 / 웹 페이지).
CREATE TABLE IF NOT EXISTS feed_view_modes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  view_mode TEXT NOT NULL CHECK(view_mode IN ('feed', 'reader', 'web')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, feed_id)
);

-- 날짜 출처를 따로 두어, 예전에 가져온 글도 그 자리에서 확인할 수 있게 한다.
CREATE TABLE IF NOT EXISTS article_date_checks (
  article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK(source IN ('original', 'feed', 'updated', 'collected')),
  checked_at TEXT
);

-- 해결되지 않은 가져오기 실패는 로그인한 사용자 본인만 본다.
CREATE TABLE IF NOT EXISTS opml_import_failures (
  user_id TEXT NOT NULL,
  xml_url TEXT NOT NULL,
  title TEXT NOT NULL,
  html_url TEXT,
  folder_name TEXT,
  error_message TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  first_failed_at TEXT NOT NULL,
  last_failed_at TEXT NOT NULL,
  PRIMARY KEY (user_id, xml_url),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
