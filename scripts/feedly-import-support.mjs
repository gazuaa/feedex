import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function saveJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2));
  renameSync(temporary, path);
}

// 기록하는 쪽이 스냅숏을 찍는 동안에도 다운로더가 뒤에 덧붙이고 있을 수 있다.
// 완성된 줄만 내보내고, 끝의 덜 쓴 항목은 다음 차례에 가져간다.
export function readEntries(path, { repair = false } = {}) {
  if (!existsSync(path)) return [];
  const contents = readFileSync(path);
  const end = contents.lastIndexOf(10) + 1;
  if (repair && end < contents.length) truncateSync(path, end);
  return contents.subarray(0, end).toString('utf8').split('\n').filter(Boolean).map(JSON.parse);
}

export function acquireLock(directory, name) {
  const path = join(directory, `${name}.lock`);
  try {
    mkdirSync(path);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let pid;
    try { pid = Number(readFileSync(join(path, 'pid'), 'utf8')); } catch { /* 만드는 쪽이 아직 쓰는 중일 수 있다 */ }
    let alive = true;
    if (pid > 0) {
      try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
    } else if (Date.now() - statSync(path).mtimeMs > 30_000) {
      alive = false;
    }
    if (alive) throw new Error(`Another Feedly ${name} process is running${pid ? ` (PID ${pid})` : ''}.`);
    rmSync(path, { recursive: true });
    mkdirSync(path);
  }
  writeFileSync(join(path, 'pid'), String(process.pid));
  return () => rmSync(path, { recursive: true, force: true });
}

const MIN_GAP = 5_000;
const BASE_COOLDOWN = 15 * 60_000;
const MAX_COOLDOWN = 6 * 60 * 60_000;
// 속도를 늦춘 뒤 연속으로 성공한 페이지 수. 이만큼 성공하면 간격을 반으로 줄이고
// 경고 한 번을 잊어서, 할당량이 회복되면 다시 최대 속도로 쓴다.
const RECOVERY_STREAK = 20;
export const DAY_MS = 24 * 60 * 60_000;
export const DEFAULT_REQUEST_BUDGET = 0; // 기기 쪽 하루 한도는 없다. Feedly가 정한 대기 시간은 그대로 지킨다.

export function requestDeadline(state, now, budget) {
  const recent = (state.requests || []).filter((at) => at > now - DAY_MS);
  return Math.max(
    state.notBefore || 0,
    budget > 0 && recent.length >= budget ? recent[recent.length - budget] + DAY_MS : 0,
  );
}

// 마지막으로 들른 피드 다음부터 이어서 받는다. 그 피드 다운로드가 덜 끝났어도 마찬가지다.
export function rotateFeeds(feeds, lastUrl) {
  const index = feeds.findIndex((feed) => feed.xml_url === lastUrl);
  return index < 0 ? feeds : [...feeds.slice(index + 1), ...feeds.slice(0, index + 1)];
}

export async function runFeedQueue(feeds, { lastUrl, isDone, step, saveLast }) {
  const queue = rotateFeeds(feeds, lastUrl).filter((feed) => !isDone(feed));
  while (queue.length) {
    const feed = queue.shift();
    await step(feed);
    saveLast(feed.xml_url);
    if (!isDone(feed)) queue.push(feed);
  }
}

export function retryDelay(headers, now) {
  const retryAfter = headers.get('retry-after');
  const seconds = retryAfter == null || retryAfter.trim() === '' ? NaN : Number(retryAfter);
  const retryAt = Number.isFinite(seconds) ? now + Math.max(0, seconds) * 1000 : Date.parse(retryAfter);
  const reset = Number(headers.get('x-ratelimit-reset'));
  return Math.max(0, Number.isFinite(retryAt) ? retryAt - now : 0, Number.isFinite(reset) ? reset * 1000 : 0);
}

export function createFeedlyClient({
  load = () => ({}), save = () => {}, fetchImpl = fetch,
  now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random, log = console.log,
  requestBudget = DEFAULT_REQUEST_BUDGET,
} = {}) {
  if (!Number.isInteger(requestBudget) || requestBudget < 0 || requestBudget > 10_000) {
    throw new Error('requests-per-day must be an integer from 0 to 10000 (0 disables the local cap)');
  }
  const state = { notBefore: 0, gapMs: MIN_GAP, strikes: 0, okStreak: 0, ...load() };
  state.gapMs = Math.max(MIN_GAP, state.gapMs);
  return async function fetchPage(xmlUrl, newerThan) {
    const params = new URLSearchParams({ streamId: `feed/${xmlUrl}`, count: '50', ranked: 'oldest' });
    if (newerThan != null) params.set('newerThan', String(newerThan));
    let transientErrors = 0;
    for (;;) {
      state.requests = (state.requests || []).filter((at) => at > now() - DAY_MS);
      state.requestBudget = requestBudget;
      const deadline = requestDeadline(state, now(), requestBudget);
      const wait = Math.max(0, deadline - now());
      if (wait) {
        state.nextRequestAt = deadline;
        save(state);
        if (wait > 60_000) log(`  ⏸ Feedly next request at ${new Date(deadline).toISOString()} (${state.requests.length} requests in 24h; local cap: ${requestBudget || 'off'})`);
        // Node 타이머는 약 24일을 넘으면 넘친다. 나눠 기다리면 긴 할당량 초기화도 처리된다.
        while (deadline > now()) await sleep(Math.min(60_000, deadline - now()));
      }
      let response;
      // 요청하기 전에 저장해서, 다시 시작해도 간격 정보가 사라지지 않게 한다.
      state.notBefore = now() + state.gapMs;
      state.requests = (state.requests || []).filter((at) => at > now() - DAY_MS);
      state.requests.push(now());
      state.totalRequests = (state.totalRequests || 0) + 1;
      state.nextRequestAt = requestDeadline(state, now(), requestBudget);
      save(state);
      try {
        response = await fetchImpl(`https://cloud.feedly.com/v3/streams/contents?${params}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (FeedEx history import)' },
          signal: AbortSignal.timeout(30_000),
        });
      } catch (error) {
        if (++transientErrors > 5) throw error;
        state.notBefore = now() + 30_000 * transientErrors;
        state.lastError = { at: now(), message: error.message };
        save(state);
        continue;
      }
      state.lastResponse = {
        at: now(), status: response.status,
        retryAfter: response.headers.get('retry-after'),
        count: response.headers.get('x-ratelimit-count'),
        limit: response.headers.get('x-ratelimit-limit'),
        reset: response.headers.get('x-ratelimit-reset'),
      };
      const limit = Number(state.lastResponse.limit);
      const count = Number(state.lastResponse.count);
      const quotaNotBefore = limit > 0 && count >= limit ? now() + retryDelay(response.headers, now()) : 0;
      save(state);
      if (response.status === 429) {
        state.strikes++;
        state.okStreak = 0;
        state.gapMs = Math.min(60_000, Math.max(MIN_GAP, state.gapMs * 2));
        const backoff = Math.min(MAX_COOLDOWN, BASE_COOLDOWN * 2 ** Math.min(state.strikes - 1, 5));
        // 서버가 정한 대기 시간은 최소값이다. 우리 상한보다 길어도 따른다.
        const delay = Math.max(backoff, retryDelay(response.headers, now())) + Math.floor(random() * 30_000);
        state.notBefore = now() + delay;
        state.nextRequestAt = requestDeadline(state, now(), requestBudget);
        save(state);
        log(`  ⏸ Feedly HTTP 429 (#${state.strikes}); retry at ${new Date(state.notBefore).toISOString()}`);
        await response.body?.cancel();
        continue;
      }
      if (response.status === 404) return [];
      if (!response.ok) {
        await response.body?.cancel();
        if (++transientErrors > 3) throw new Error(`Feedly HTTP ${response.status}`);
        state.notBefore = now() + Math.max(30_000 * transientErrors, retryDelay(response.headers, now()));
        save(state);
        continue;
      }
      const items = (await response.json()).items || [];
      transientErrors = 0;
      // 성공한 페이지가 있어도 경고는 유지한다. 한 번 성공했다고 익명 할당량이
      // 회복된 것은 아니기 때문이다. 이 값은 프로세스를 다시 시작해도 남는다.
      // 성공이 꾸준히 이어질 때만 간격을 다시 줄인다.
      state.okStreak = (state.okStreak || 0) + 1;
      if (state.okStreak >= RECOVERY_STREAK && (state.strikes > 0 || state.gapMs > MIN_GAP)) {
        state.gapMs = Math.max(MIN_GAP, Math.floor(state.gapMs / 2));
        state.strikes = Math.max(0, state.strikes - 1);
        state.okStreak = 0;
      }
      state.notBefore = Math.max(quotaNotBefore, now() + state.gapMs);
      state.nextRequestAt = requestDeadline(state, now(), requestBudget);
      save(state);
      return items;
    }
  };
}
