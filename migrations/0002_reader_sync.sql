-- 합쳐 둔 간결한 변경 기록. 글 본문은 여기에 중복 저장하지 않는다.
CREATE TABLE IF NOT EXISTS reader_sync_changes (
  version INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  owner_id TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL,
  feed_id TEXT,
  operation TEXT NOT NULL DEFAULT 'upsert',
  UNIQUE(kind, owner_id, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_reader_sync_owner_version ON reader_sync_changes(owner_id, version);
CREATE INDEX IF NOT EXISTS idx_reader_sync_feed_version ON reader_sync_changes(feed_id, version);
CREATE TABLE IF NOT EXISTS reader_sync_meta (id INTEGER PRIMARY KEY CHECK(id=1), floor INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO reader_sync_meta(id, floor) VALUES(1, 0);

CREATE TRIGGER IF NOT EXISTS reader_sync_articles_insert AFTER INSERT ON articles

BEGIN
  DELETE FROM reader_sync_changes WHERE kind='article' AND owner_id='' AND entity_id=NEW.id;
  INSERT INTO reader_sync_changes(kind, owner_id, entity_id, feed_id, operation)
  VALUES('article', '', NEW.id, NEW.feed_id, 'upsert');
END;

CREATE TRIGGER IF NOT EXISTS reader_sync_article_states_insert AFTER INSERT ON article_states

BEGIN
  DELETE FROM reader_sync_changes WHERE kind='state' AND owner_id=NEW.user_id AND entity_id=NEW.article_id;
  INSERT INTO reader_sync_changes(kind, owner_id, entity_id, feed_id, operation)
  VALUES('state', NEW.user_id, NEW.article_id, (SELECT feed_id FROM articles WHERE id=NEW.article_id), 'upsert');
END;

CREATE TRIGGER IF NOT EXISTS reader_sync_subscriptions_insert AFTER INSERT ON subscriptions

BEGIN
  DELETE FROM reader_sync_changes WHERE kind='subscription' AND owner_id=NEW.user_id AND entity_id=NEW.id;
  INSERT INTO reader_sync_changes(kind, owner_id, entity_id, feed_id, operation)
  VALUES('subscription', NEW.user_id, NEW.id, NEW.feed_id, 'upsert');
END;

CREATE TRIGGER IF NOT EXISTS reader_sync_folders_insert AFTER INSERT ON folders

BEGIN
  DELETE FROM reader_sync_changes WHERE kind='folder' AND owner_id=NEW.user_id AND entity_id=NEW.id;
  INSERT INTO reader_sync_changes(kind, owner_id, entity_id, feed_id, operation)
  VALUES('folder', NEW.user_id, NEW.id, NULL, 'upsert');
END;

CREATE TRIGGER IF NOT EXISTS reader_sync_feed_view_modes_insert AFTER INSERT ON feed_view_modes

BEGIN
  DELETE FROM reader_sync_changes WHERE kind='view' AND owner_id=NEW.user_id AND entity_id=NEW.feed_id;
  INSERT INTO reader_sync_changes(kind, owner_id, entity_id, feed_id, operation)
  VALUES('view', NEW.user_id, NEW.feed_id, NEW.feed_id, 'upsert');
END;

CREATE TRIGGER IF NOT EXISTS reader_sync_articles_update AFTER UPDATE ON articles
WHEN OLD.feed_id IS NOT NEW.feed_id OR OLD.title IS NOT NEW.title OR OLD.url IS NOT NEW.url OR OLD.author IS NOT NEW.author OR OLD.summary IS NOT NEW.summary OR OLD.content_html IS NOT NEW.content_html OR OLD.full_content_html IS NOT NEW.full_content_html OR OLD.ai_summary IS NOT NEW.ai_summary OR OLD.thumbnail_url IS NOT NEW.thumbnail_url OR OLD.published_at IS NOT NEW.published_at
BEGIN
  DELETE FROM reader_sync_changes WHERE kind='article' AND owner_id='' AND entity_id=NEW.id;
  INSERT INTO reader_sync_changes(kind, owner_id, entity_id, feed_id, operation)
  VALUES('article', '', NEW.id, NEW.feed_id, 'upsert');
END;

CREATE TRIGGER IF NOT EXISTS reader_sync_article_states_update AFTER UPDATE ON article_states
WHEN OLD.is_read IS NOT NEW.is_read OR OLD.is_saved IS NOT NEW.is_saved
BEGIN
  DELETE FROM reader_sync_changes WHERE kind='state' AND owner_id=NEW.user_id AND entity_id=NEW.article_id;
  INSERT INTO reader_sync_changes(kind, owner_id, entity_id, feed_id, operation)
  VALUES('state', NEW.user_id, NEW.article_id, (SELECT feed_id FROM articles WHERE id=NEW.article_id), 'upsert');
END;

CREATE TRIGGER IF NOT EXISTS reader_sync_subscriptions_update AFTER UPDATE ON subscriptions
WHEN OLD.folder_id IS NOT NEW.folder_id OR OLD.custom_title IS NOT NEW.custom_title
BEGIN
  DELETE FROM reader_sync_changes WHERE kind='subscription' AND owner_id=NEW.user_id AND entity_id=NEW.id;
  INSERT INTO reader_sync_changes(kind, owner_id, entity_id, feed_id, operation)
  VALUES('subscription', NEW.user_id, NEW.id, NEW.feed_id, 'upsert');
END;

CREATE TRIGGER IF NOT EXISTS reader_sync_folders_update AFTER UPDATE ON folders
WHEN OLD.name IS NOT NEW.name OR OLD.color IS NOT NEW.color OR OLD.sort_order IS NOT NEW.sort_order
BEGIN
  DELETE FROM reader_sync_changes WHERE kind='folder' AND owner_id=NEW.user_id AND entity_id=NEW.id;
  INSERT INTO reader_sync_changes(kind, owner_id, entity_id, feed_id, operation)
  VALUES('folder', NEW.user_id, NEW.id, NULL, 'upsert');
END;

CREATE TRIGGER IF NOT EXISTS reader_sync_feed_view_modes_update AFTER UPDATE ON feed_view_modes
WHEN OLD.view_mode IS NOT NEW.view_mode
BEGIN
  DELETE FROM reader_sync_changes WHERE kind='view' AND owner_id=NEW.user_id AND entity_id=NEW.feed_id;
  INSERT INTO reader_sync_changes(kind, owner_id, entity_id, feed_id, operation)
  VALUES('view', NEW.user_id, NEW.feed_id, NEW.feed_id, 'upsert');
END;

CREATE TRIGGER IF NOT EXISTS reader_sync_articles_delete AFTER DELETE ON articles

BEGIN
  DELETE FROM reader_sync_changes WHERE kind='article' AND owner_id='' AND entity_id=OLD.id;
  INSERT INTO reader_sync_changes(kind, owner_id, entity_id, feed_id, operation)
  VALUES('article', '', OLD.id, OLD.feed_id, 'delete');
END;

CREATE TRIGGER IF NOT EXISTS reader_sync_article_states_delete AFTER DELETE ON article_states

BEGIN
  DELETE FROM reader_sync_changes WHERE kind='state' AND owner_id=OLD.user_id AND entity_id=OLD.article_id;
  INSERT INTO reader_sync_changes(kind, owner_id, entity_id, feed_id, operation)
  VALUES('state', OLD.user_id, OLD.article_id, (SELECT feed_id FROM articles WHERE id=OLD.article_id), 'delete');
END;

CREATE TRIGGER IF NOT EXISTS reader_sync_subscriptions_delete AFTER DELETE ON subscriptions

BEGIN
  DELETE FROM reader_sync_changes WHERE kind='subscription' AND owner_id=OLD.user_id AND entity_id=OLD.id;
  INSERT INTO reader_sync_changes(kind, owner_id, entity_id, feed_id, operation)
  VALUES('subscription', OLD.user_id, OLD.id, OLD.feed_id, 'delete');
END;

CREATE TRIGGER IF NOT EXISTS reader_sync_folders_delete AFTER DELETE ON folders

BEGIN
  DELETE FROM reader_sync_changes WHERE kind='folder' AND owner_id=OLD.user_id AND entity_id=OLD.id;
  INSERT INTO reader_sync_changes(kind, owner_id, entity_id, feed_id, operation)
  VALUES('folder', OLD.user_id, OLD.id, NULL, 'delete');
END;

CREATE TRIGGER IF NOT EXISTS reader_sync_feed_view_modes_delete AFTER DELETE ON feed_view_modes

BEGIN
  DELETE FROM reader_sync_changes WHERE kind='view' AND owner_id=OLD.user_id AND entity_id=OLD.feed_id;
  INSERT INTO reader_sync_changes(kind, owner_id, entity_id, feed_id, operation)
  VALUES('view', OLD.user_id, OLD.feed_id, OLD.feed_id, 'delete');
END;

CREATE TRIGGER IF NOT EXISTS reader_sync_feeds_update AFTER UPDATE ON feeds
WHEN OLD.title IS NOT NEW.title OR OLD.description IS NOT NEW.description OR OLD.xml_url IS NOT NEW.xml_url OR OLD.html_url IS NOT NEW.html_url OR OLD.favicon_url IS NOT NEW.favicon_url OR OLD.last_error IS NOT NEW.last_error
BEGIN
  DELETE FROM reader_sync_changes WHERE kind='feed' AND owner_id='' AND entity_id=NEW.id;
  INSERT INTO reader_sync_changes(kind, owner_id, entity_id, feed_id, operation)
  VALUES('feed', '', NEW.id, NEW.id, 'upsert');
END;

CREATE TRIGGER IF NOT EXISTS reader_sync_feeds_delete AFTER DELETE ON feeds

BEGIN
  DELETE FROM reader_sync_changes WHERE kind='feed' AND owner_id='' AND entity_id=OLD.id;
  INSERT INTO reader_sync_changes(kind, owner_id, entity_id, feed_id, operation)
  VALUES('feed', '', OLD.id, OLD.id, 'delete');
END;

CREATE TRIGGER IF NOT EXISTS reader_sync_article_dates_insert AFTER INSERT ON article_date_checks

BEGIN
  DELETE FROM reader_sync_changes WHERE kind='article' AND owner_id='' AND entity_id=NEW.article_id;
  INSERT INTO reader_sync_changes(kind,owner_id,entity_id,feed_id,operation)
  VALUES('article','',NEW.article_id,(SELECT feed_id FROM articles WHERE id=NEW.article_id),'upsert');
END;

CREATE TRIGGER IF NOT EXISTS reader_sync_article_dates_update AFTER UPDATE ON article_date_checks
WHEN OLD.source IS NOT NEW.source
BEGIN
  DELETE FROM reader_sync_changes WHERE kind='article' AND owner_id='' AND entity_id=NEW.article_id;
  INSERT INTO reader_sync_changes(kind,owner_id,entity_id,feed_id,operation)
  VALUES('article','',NEW.article_id,(SELECT feed_id FROM articles WHERE id=NEW.article_id),'upsert');
END;

CREATE TRIGGER IF NOT EXISTS reader_sync_article_dates_delete AFTER DELETE ON article_date_checks

BEGIN
  DELETE FROM reader_sync_changes WHERE kind='article' AND owner_id='' AND entity_id=OLD.article_id;
  INSERT INTO reader_sync_changes(kind,owner_id,entity_id,feed_id,operation)
  VALUES('article','',OLD.article_id,(SELECT feed_id FROM articles WHERE id=OLD.article_id),'upsert');
END;
