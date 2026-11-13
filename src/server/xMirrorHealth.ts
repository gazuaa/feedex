import type { D1DatabaseLike } from './types';
import { pauseSupported } from './feedPause';

// X 미러 상태. 요청 한도(429)는 x_provider_cooldowns에 남지만, 주소 이동(301)·서버 오류·보안 확인 페이지 같은 실패는
// 아무 데도 남지 않았다. 그래서 2026-11에 nitter.mizuki.st가 ruf.st로 옮긴 뒤 이틀 동안 미러 하나만 쓰이며
// X 글이 하루 넘게 늦게 들어와도 알 수 없었다. 미러마다 마지막 성공과 실패를 남기고, 운영자 설정 화면과 Workers 로그로 보인다.
// 운영 DB에 따로 마이그레이션하지 않아도 처음 쓸 때 표를 만든다(migrations/0012와 같은 정의).
export const X_MIRROR_TABLE = `CREATE TABLE IF NOT EXISTS x_provider_health (
  provider TEXT PRIMARY KEY,
  last_ok_at INTEGER,
  failing_since INTEGER,
  last_failure_at INTEGER,
  last_failure TEXT,
  last_limited_at INTEGER
)`;

export type MirrorOutcome = { kind: 'ok' } | { kind: 'limited' } | { kind: 'failed'; detail: string };

/** 같은 결과는 이 간격 안에서 한 번만 쓴다. 정기 실행은 5분마다 계정 수십 개를 받으므로 매번 쓰지 않는다. */
const WRITE_GAP = 5 * 60_000;
const written = new Map<string, { kind: MirrorOutcome['kind']; at: number }>();
const tables = new WeakMap<object, Promise<boolean>>();

function ensureTable(db: D1DatabaseLike): Promise<boolean> {
  const known = tables.get(db as object);
  if (known) return known;
  const made = db.prepare(X_MIRROR_TABLE).run().then(() => true, () => { tables.delete(db as object); return false; });
  tables.set(db as object, made);
  return made;
}

/** 실패를 짧게 적는다. 주소를 옮긴 경우 옮겨 간 곳의 호스트를 함께 적는다. */
export function describeResponse(response: Pick<Response, 'status' | 'headers'>): string {
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('Location');
    try { if (location) return `HTTP ${response.status} → ${new URL(location).host} (주소 이동)`; } catch { /* 주소가 이상하면 상태만 적는다. */ }
  }
  return `HTTP ${response.status}`;
}
export const describeError = (error: unknown) => error instanceof Error && error.name === 'AbortError' ? '응답 시간 초과' : '연결 오류';
export const NOT_A_FEED = 'RSS가 아닌 응답(보안 확인 페이지 등)';

/**
 * 미러 요청 하나의 결과를 남긴다. 성공하면 실패 시작 시각을 지우고, 실패하면 처음 실패한 시각을 지킨다.
 * 실패는 Workers 로그에도 남긴다. 기록하지 못해도 글 수집은 계속한다.
 */
export async function recordMirror(db: D1DatabaseLike | undefined, provider: string, outcome: MirrorOutcome, now = Date.now()): Promise<void> {
  const last = written.get(provider);
  if (last && last.kind === outcome.kind && now - last.at < WRITE_GAP) return;
  written.set(provider, { kind: outcome.kind, at: now });
  if (outcome.kind === 'failed') console.warn('X 미러 요청 실패:', provider, outcome.detail);
  if (!db || !await ensureTable(db)) return;
  const statement = outcome.kind === 'ok'
    ? db.prepare(`INSERT INTO x_provider_health(provider,last_ok_at) VALUES(?,?)
        ON CONFLICT(provider) DO UPDATE SET last_ok_at=excluded.last_ok_at, failing_since=NULL`).bind(provider, now)
    : outcome.kind === 'limited'
      ? db.prepare(`INSERT INTO x_provider_health(provider,last_limited_at) VALUES(?,?)
          ON CONFLICT(provider) DO UPDATE SET last_limited_at=excluded.last_limited_at`).bind(provider, now)
      : db.prepare(`INSERT INTO x_provider_health(provider,failing_since,last_failure_at,last_failure) VALUES(?,?,?,?)
          ON CONFLICT(provider) DO UPDATE SET failing_since=COALESCE(x_provider_health.failing_since,excluded.failing_since),
            last_failure_at=excluded.last_failure_at, last_failure=excluded.last_failure`).bind(provider, now, now, outcome.detail.slice(0, 300));
  await statement.run().catch(() => {});
}

/** 이만큼 성공하지 못하면 확인이 필요하다고 본다. */
export const MIRROR_STALE_MS = 2 * 3_600_000;
export type MirrorState = 'ok' | 'limited' | 'failing' | 'stale' | 'unknown';
export interface MirrorStatus {
  provider: string; host: string; state: MirrorState;
  lastOkAt: number | null; failingSince: number | null; lastFailure: string | null; limitedUntil: number | null;
}

/** 미러별 상태. 실패가 이어지는 중이면 failing, 한도로 쉬는 중이면 limited, 오래 성공하지 못했으면 stale이다. */
export function mirrorState(row: { last_ok_at: number | null; failing_since: number | null } | undefined, limitedUntil: number | null, now: number): MirrorState {
  if (row?.failing_since) return 'failing';
  if (limitedUntil && limitedUntil > now) return 'limited';
  if (row?.last_ok_at) return now - row.last_ok_at <= MIRROR_STALE_MS ? 'ok' : 'stale';
  return 'unknown';
}

export async function mirrorStatuses(db: D1DatabaseLike, providers: readonly string[], now = Date.now()): Promise<MirrorStatus[]> {
  await ensureTable(db);
  type Row = { provider: string; last_ok_at: number | null; failing_since: number | null; last_failure: string | null };
  const health = await db.prepare('SELECT provider,last_ok_at,failing_since,last_failure FROM x_provider_health').all<Row>()
    .then(({ results }) => new Map(results.map((row) => [row.provider, row])), () => new Map<string, Row>());
  const cooldowns = await db.prepare('SELECT provider,retry_at FROM x_provider_cooldowns').all<{ provider: string; retry_at: number }>()
    .then(({ results }) => new Map(results.map((row) => [row.provider, Number(row.retry_at)])), () => new Map<string, number>());
  return providers.map((provider) => {
    const row = health.get(provider), limitedUntil = cooldowns.get(provider) ?? null;
    return {
      provider, host: new URL(provider).host, state: mirrorState(row, limitedUntil, now),
      lastOkAt: row?.last_ok_at ?? null, failingSince: row?.failing_since ?? null, lastFailure: row?.last_failure ?? null,
      limitedUntil: limitedUntil && limitedUntil > now ? limitedUntil : null,
    };
  });
}

/** 이만큼 한 번도 받지 못한 X 계정은 운영자 설정에 따로 보인다. 정기 실행은 계정마다 15분 안팎으로 다시 받는다. */
export const ACCOUNT_STALE_MS = 3 * 3_600_000;
export interface StaleXAccount { handle: string; title: string; lastOkAt: string | null; error: string | null; failures: number; retryAt: number | null }

/**
 * 구독 중인(멈추지 않은) X 계정 가운데 마지막으로 받은 지 오래된 계정. 피드의 last_fetched_at은 받기에 성공했을 때만
 * 바뀌므로, 미러는 멀쩡해도 특정 계정만 계속 실패하거나(이름 변경, 비공개 전환 등) 차례가 밀리는 경우를 찾는다.
 */
export async function staleXAccounts(db: D1DatabaseLike, now = Date.now(), limit = 20): Promise<{ total: number; accounts: StaleXAccount[] }> {
  const paused = await pauseSupported(db);
  const where = `f.xml_url LIKE 'https://x.com/%'
    AND EXISTS(SELECT 1 FROM subscriptions s WHERE s.feed_id=f.id ${paused ? 'AND s.paused_at IS NULL' : ''})
    AND (f.last_fetched_at IS NULL OR f.last_fetched_at < ?)`;
  const cutoff = new Date(now - ACCOUNT_STALE_MS).toISOString();
  type Row = { xml_url: string; title: string; last_fetched_at: string | null; last_error: string | null; failures: number | null; retry_at: number | null };
  const [count, rows] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS n FROM feeds f WHERE ${where}`).bind(cutoff).first<{ n: number }>(),
    db.prepare(`SELECT f.xml_url,f.title,f.last_fetched_at,f.last_error,r.failures,r.retry_at FROM feeds f
      LEFT JOIN feed_refresh_state r ON r.feed_id=f.id WHERE ${where} ORDER BY f.last_fetched_at ASC LIMIT ?`).bind(cutoff, limit).all<Row>(),
  ]);
  return {
    total: Number(count?.n || 0),
    accounts: rows.results.map((row) => ({
      handle: row.xml_url.split('/').pop() || row.xml_url,
      title: row.title,
      lastOkAt: row.last_fetched_at,
      error: row.last_error ? row.last_error.slice(0, 200) : null,
      failures: Number(row.failures || 0),
      retryAt: row.retry_at && Number(row.retry_at) > now ? Number(row.retry_at) : null,
    })),
  };
}
