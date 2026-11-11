-- 피드별 글 수. 목록 개수를 낼 때 피드의 글을 처음부터 세지 않게 한다.
-- 앱이 처음 쓸 때도 같은 표·트리거를 만들고 채운다(src/server/feedCounts.ts). 이 파일은 새 DB를 만들 때와 기록용이다.
CREATE TABLE IF NOT EXISTS feed_article_counts (
  feed_id TEXT PRIMARY KEY,
  total INTEGER NOT NULL DEFAULT 0,
  checked_at INTEGER NOT NULL DEFAULT 0
);

CREATE TRIGGER IF NOT EXISTS feed_article_counts_insert AFTER INSERT ON articles BEGIN
  INSERT OR IGNORE INTO feed_article_counts(feed_id,total) VALUES(NEW.feed_id,0);
  UPDATE feed_article_counts SET total=total+1 WHERE feed_id=NEW.feed_id;
END;

CREATE TRIGGER IF NOT EXISTS feed_article_counts_delete AFTER DELETE ON articles BEGIN
  UPDATE feed_article_counts SET total=MAX(0,total-1) WHERE feed_id=OLD.feed_id;
END;

CREATE TRIGGER IF NOT EXISTS feed_article_counts_move AFTER UPDATE OF feed_id ON articles WHEN NEW.feed_id IS NOT OLD.feed_id BEGIN
  UPDATE feed_article_counts SET total=MAX(0,total-1) WHERE feed_id=OLD.feed_id;
  INSERT OR IGNORE INTO feed_article_counts(feed_id,total) VALUES(NEW.feed_id,0);
  UPDATE feed_article_counts SET total=total+1 WHERE feed_id=NEW.feed_id;
END;

INSERT INTO feed_article_counts(feed_id,total,checked_at)
  SELECT feed_id,COUNT(*),0 FROM articles GROUP BY feed_id
  ON CONFLICT(feed_id) DO UPDATE SET total=excluded.total;
