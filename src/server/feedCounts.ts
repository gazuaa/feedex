import type { D1DatabaseLike } from './types';

// 피드별 글 수. 목록 개수를 낼 때마다 피드의 글을 처음부터 세면 계정 하나에 수십만 행을 읽는다.
// 글이 들어오고 나가고 다른 피드로 옮겨질 때 DB 트리거가 이 수를 함께 고치므로, 어느 경로로 글을 넣어도
// (피드 수집, Feedly 가져오기, 직접 실행한 SQL) 수가 어긋나지 않는다.
// 운영 DB에 따로 마이그레이션하지 않아도 처음 쓸 때 표와 트리거를 만들고 한 번에 채운다(0011과 같은 정의).
export const FEED_COUNT_TRIGGERS = ['feed_article_counts_insert', 'feed_article_counts_delete', 'feed_article_counts_move'] as const;

export const FEED_COUNT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS feed_article_counts (
    feed_id TEXT PRIMARY KEY,
    total INTEGER NOT NULL DEFAULT 0,
    checked_at INTEGER NOT NULL DEFAULT 0
  )`,
  // D1은 트리거 본문의 BEGIN/END를 대문자로 써야 한다. UPSERT 대신 두 문장으로 써서 SQLite 버전에 기대지 않는다.
  `CREATE TRIGGER IF NOT EXISTS feed_article_counts_insert AFTER INSERT ON articles BEGIN
    INSERT OR IGNORE INTO feed_article_counts(feed_id,total) VALUES(NEW.feed_id,0);
    UPDATE feed_article_counts SET total=total+1 WHERE feed_id=NEW.feed_id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS feed_article_counts_delete AFTER DELETE ON articles BEGIN
    UPDATE feed_article_counts SET total=MAX(0,total-1) WHERE feed_id=OLD.feed_id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS feed_article_counts_move AFTER UPDATE OF feed_id ON articles WHEN NEW.feed_id IS NOT OLD.feed_id BEGIN
    UPDATE feed_article_counts SET total=MAX(0,total-1) WHERE feed_id=OLD.feed_id;
    INSERT OR IGNORE INTO feed_article_counts(feed_id,total) VALUES(NEW.feed_id,0);
    UPDATE feed_article_counts SET total=total+1 WHERE feed_id=NEW.feed_id;
  END`,
];

/** 트리거를 만든 같은 트랜잭션 안에서 지금 글 수로 채운다. 그 사이에 들어온 글도 빠지거나 두 번 세지 않는다. */
export const FEED_COUNT_FILL = `INSERT INTO feed_article_counts(feed_id,total,checked_at)
  SELECT feed_id,COUNT(*),? FROM articles GROUP BY feed_id
  ON CONFLICT(feed_id) DO UPDATE SET total=excluded.total, checked_at=excluded.checked_at`;

const RETRY_MS = 10 * 60_000;
const installs = new WeakMap<object, Promise<boolean>>();
const failedAt = new WeakMap<object, number>();

async function install(db: D1DatabaseLike): Promise<boolean> {
  const found = await db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name IN (${FEED_COUNT_TRIGGERS.map(() => '?').join(',')})`)
    .bind(...FEED_COUNT_TRIGGERS).first<{ n: number }>();
  if (Number(found?.n) === FEED_COUNT_TRIGGERS.length) return true;
  await db.batch([...FEED_COUNT_SCHEMA.map((sql) => db.prepare(sql)), db.prepare(FEED_COUNT_FILL).bind(Date.now())]);
  return true;
}

/**
 * 저장한 피드별 글 수를 쓸 수 있는지. 처음이면 표와 트리거를 만든다. 만들지 못하면 false를 돌려주고
 * 부르는 쪽은 예전처럼 글을 직접 센다. 실패한 뒤에는 잠시 기다렸다가 다시 시도한다.
 */
export function feedCountsReady(db: D1DatabaseLike): Promise<boolean> {
  const key = db as object;
  const known = installs.get(key);
  if (known) return known;
  if (Date.now() - (failedAt.get(key) ?? -Infinity) < RETRY_MS) return Promise.resolve(false);
  const flight = install(db).catch((error) => {
    console.warn('피드별 글 수를 준비하지 못했습니다.', error instanceof Error ? error.message : error);
    failedAt.set(key, Date.now());
    installs.delete(key);
    return false;
  });
  installs.set(key, flight);
  return flight;
}

/**
 * 구독 한 줄(s)의 전체 글 수. 저장한 피드 글 수에서, 이 사람에게 보이지 않는 글(멈춘 뒤 들어온 글, 차단한 글)만 뺀다.
 * 뺄 글이 있을 수 있는 구독(멈춘 구독, 차단 규칙이 걸린 피드)만 그 피드의 글을 센다.
 */
export function storedTotalCount({ shown, visible, affected, pausedAt }: { shown: string; visible: string; affected: string; pausedAt: string }) {
  return `(COALESCE((SELECT c.total FROM feed_article_counts c WHERE c.feed_id=s.feed_id),0)
    - CASE WHEN ${pausedAt} IS NOT NULL OR ${affected}
      THEN (SELECT COUNT(*) FROM articles a WHERE a.feed_id=s.feed_id AND NOT ((${shown}) AND (${visible})))
      ELSE 0 END)`;
}

/** 예전 방식: 피드의 글을 처음부터 센다. 저장한 글 수를 쓸 수 없을 때만 쓴다. */
export const countedTotal = ({ shown, visible }: { shown: string; visible: string }) =>
  `(SELECT COUNT(*) FROM articles a WHERE a.feed_id=s.feed_id AND ${shown} AND ${visible})`;

/**
 * 트리거가 있으면 어긋나지 않지만, 만일을 위해 가장 오래 확인하지 않은 피드부터 조금씩 다시 센다.
 * 피드가 사라진 줄도 지운다.
 */
export async function reconcileFeedCounts(db: D1DatabaseLike, limit = 1, now = Date.now()) {
  if (!(await feedCountsReady(db))) return 0;
  const { results } = await db.prepare('SELECT feed_id FROM feed_article_counts ORDER BY checked_at ASC, feed_id LIMIT ?').bind(limit).all<{ feed_id: string }>();
  const statements = results.map(({ feed_id }) => db.prepare('UPDATE feed_article_counts SET total=(SELECT COUNT(*) FROM articles WHERE feed_id=?), checked_at=? WHERE feed_id=?').bind(feed_id, now, feed_id));
  statements.push(db.prepare('DELETE FROM feed_article_counts WHERE NOT EXISTS (SELECT 1 FROM feeds f WHERE f.id=feed_article_counts.feed_id)'));
  await db.batch(statements);
  return results.length;
}
