import { Hono } from 'hono';
import type { Env, UserRecord } from './types';
import type { ParsedArticle } from './rssParser';
import { saveFeedArticles } from './seedService';
import { publicPageUrl } from './rssBuilder';
import { isXProfileFeed } from '../shared/xFeed';
import { DEFAULT_HISTORY_OPTIONS, validHistoryOptions, type FeedHistoryOptions, type FeedHistoryProgress } from '../shared/feedHistory';
import { canonicalHistoryUrl, historyUrlVariants, HistorySourceError, readHistorySource, type HistorySource } from './feedHistorySources';

interface Feed { id: string; xml_url: string; html_url: string | null; source_url: string | null; selector: string | null }
interface State extends FeedHistoryProgress { source: HistorySource | null; websiteStarted: boolean; visited: string[]; fingerprints: string[]; readyAt: number }
interface Row { state_json: string; revision: number; lease_until: number }
const routes = new Hono<{ Bindings: Env; Variables: { user: UserRecord } }>();
routes.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
const nowIso = () => new Date().toISOString();
const publicJob = (state: State): FeedHistoryProgress => {
  const { source, websiteStarted, visited, fingerprints, readyAt, ...job } = state; return job;
};
async function subscribed(env: Env, userId: string, feedId: string): Promise<Feed | null> {
  return env.DB.prepare(`SELECT f.id,f.xml_url,f.html_url,b.source_url,b.selector FROM subscriptions s JOIN feeds f ON f.id=s.feed_id LEFT JOIN rss_builders b ON b.feed_id=f.id WHERE s.user_id=? AND f.id=?`).bind(userId, feedId).first<Feed>();
}
async function stored(env: Env, userId: string, feedId: string): Promise<State | null> {
  const row = await env.DB.prepare('SELECT state_json,revision,lease_until FROM feed_history_jobs WHERE user_id=? AND feed_id=?').bind(userId, feedId).first<Row>();
  return row ? { ...JSON.parse(row.state_json), revision: row.revision } as State : null;
}
function fresh(feed: Feed, options: FeedHistoryOptions): State {
  const time = nowIso();
  return { revision: 0, status: 'paused', reason: 'ready', options, added: 0, checked: 0, duplicates: 0, unknownDates: 0, pages: 0, oldest: null, startedAt: time, updatedAt: time, retryAt: null, readyAt: 0, message: '준비됐습니다. 한 페이지씩 과거 글을 확인합니다.', websiteStarted: !!feed.source_url || isXProfileFeed(feed.xml_url), source: { kind: feed.source_url ? 'html' : isXProfileFeed(feed.xml_url) ? 'x-start' : 'rss', url: feed.source_url || feed.xml_url, ...(feed.selector ? { selector: feed.selector } : {}) }, visited: [], fingerprints: [] };
}
const finish = (state: State, reason: State['reason'], message: string, done = true) => { state.reason = reason; state.message = message; state.status = done ? 'done' : 'paused'; };
function advance(state: State, feed: Feed, next: HistorySource | null, sourceLimit?: boolean) {
  if (next) { state.source = next; return; }
  if (!state.websiteStarted && feed.html_url) { state.websiteStarted = true; state.source = { kind: 'site', url: feed.html_url }; return; }
  state.source = null;
  finish(state, sourceLimit ? 'source_limit' : state.added || state.pages > 1 ? 'end' : 'unsupported', sourceLimit ? '사이트가 공개한 과거 목록의 마지막 페이지까지 확인했습니다.' : '공개된 목록에서 더 가져올 수 있는 과거 글이 없습니다.');
}
async function hash(value: string) { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return Array.from(new Uint8Array(bytes).slice(0, 12), n => n.toString(16).padStart(2, '0')).join(''); }

/** RSS guid와 공개 목록 주소를 함께 비교한다. 기존 글의 읽음·저장 상태는 건드리지 않는다. */
async function reconcile(env: Env, feedId: string, articles: ParsedArticle[]) {
  const known = new Map<string, string>();
  const values = [...new Set(articles.flatMap(article => [...historyUrlVariants(article.url), article.guid]))];
  for (let offset = 0; offset < values.length; offset += 40) {
    const chunk = values.slice(offset, offset + 40), placeholders = chunk.map(() => '?').join(',');
    const rows = await env.DB.prepare(`SELECT url,guid FROM articles WHERE feed_id=? AND (url IN (${placeholders}) OR guid IN (${placeholders}))`).bind(feedId, ...chunk, ...chunk).all<{ url: string; guid: string }>();
    for (const row of rows.results) { known.set(row.guid, row.guid); try { known.set(canonicalHistoryUrl(row.url), row.guid); } catch { /* 잘못된 옛 주소는 guid로만 비교한다. */ } }
  }
  const result: ParsedArticle[] = [], seen = new Set<string>(); let duplicates = 0;
  for (const article of articles) {
    const key = canonicalHistoryUrl(article.url), guid = known.get(article.guid) || known.get(key);
    if (seen.has(key) || (guid && seen.has(guid))) { duplicates++; continue; }
    seen.add(key); seen.add(guid || article.guid);
    if (guid) duplicates++;
    result.push({ ...article, guid: guid || article.guid });
  }
  return { articles: result, duplicates };
}

routes.get('/:id/history', async c => {
  const userId = c.get('user').id, feedId = c.req.param('id');
  if (!await subscribed(c.env, userId, feedId)) return c.json({ error: '구독 중인 피드가 아닙니다.' }, 404);
  const state = await stored(c.env, userId, feedId);
  return c.json({ job: state ? publicJob(state) : null });
});
routes.post('/:id/history', async c => {
  const userId = c.get('user').id, feedId = c.req.param('id'), feed = await subscribed(c.env, userId, feedId);
  if (!feed) return c.json({ error: '구독 중인 피드가 아닙니다.' }, 404);
  const body = await c.req.json().catch(() => null);
  if (!body || !validHistoryOptions(body.options) || (body.restart !== undefined && typeof body.restart !== 'boolean')) return c.json({ error: '기간과 최대 개수를 다시 선택해 주세요.' }, 400);
  const old = await stored(c.env, userId, feedId), previousRevision = old?.revision ?? -1;
  const state = !old || body.restart ? fresh(feed, body.options) : old;
  state.options = body.options;
  if (old?.retryAt && old.retryAt > Date.now()) { state.retryAt = old.retryAt; state.reason = 'rate_limit'; state.message = old.message; }
  if (state.source && state.reason !== 'rate_limit') finish(state, 'ready', '저장된 위치에서 이어받습니다.', false);
  state.revision = previousRevision + 1; state.updatedAt = nowIso();
  // 수집 중인 다른 창의 상태를 덮어쓰지 않는다. 구성 변경에도 같은 임대를 적용한다.
  const result = await c.env.DB.prepare(`INSERT INTO feed_history_jobs(user_id,feed_id,state_json,revision,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,feed_id) DO UPDATE SET state_json=excluded.state_json,revision=excluded.revision,updated_at=excluded.updated_at WHERE feed_history_jobs.lease_until<=? AND feed_history_jobs.revision=?`).bind(userId, feedId, JSON.stringify(state), state.revision, state.updatedAt, Date.now(), previousRevision).run();
  if (!Number(result.meta?.changes)) return c.json({ error: '다른 창에서 진행 중입니다. 잠시 뒤 다시 열어 주세요.' }, 409);
  return c.json({ job: publicJob(state) });
});
routes.post('/:id/history/step', async c => {
  const userId = c.get('user').id, feedId = c.req.param('id'), feed = await subscribed(c.env, userId, feedId);
  if (!feed) return c.json({ error: '구독 중인 피드가 아닙니다.' }, 404);
  const body = await c.req.json().catch(() => null), state = await stored(c.env, userId, feedId);
  if (!state) return c.json({ error: '먼저 가져올 기간과 개수를 선택해 주세요.' }, 400);
  if (!body || !Number.isSafeInteger(body.revision)) return c.json({ error: '진행 정보가 올바르지 않습니다.' }, 400);
  if (state.revision !== body.revision || !state.source || state.status === 'done' || state.readyAt > Date.now() || (state.retryAt && state.retryAt > Date.now())) return c.json({ job: publicJob(state) });
  const lease = crypto.randomUUID();
  const locked = await c.env.DB.prepare('UPDATE feed_history_jobs SET lease_token=?,lease_until=? WHERE user_id=? AND feed_id=? AND revision=? AND lease_until<=?').bind(lease, Date.now() + 60_000, userId, feedId, state.revision, Date.now()).run();
  if (!Number(locked.meta?.changes)) return c.json({ error: '다른 창에서 이 피드를 불러오는 중입니다.' }, 409);
  try {
    if (state.added >= state.options.limit) finish(state, 'limit', '선택한 최대 개수까지 추가했습니다. 개수를 늘리면 이어받을 수 있습니다.', false);
    else if (state.pages >= 500) { state.source = null; finish(state, 'source_limit', '한 번에 확인할 수 있는 500페이지에 도달했습니다.'); }
    else {
      const source = state.source!, page = await readHistorySource(source, c.env), offset = source.offset || 0;
      const pageKey = await hash(JSON.stringify({ ...source, offset: 0 }));
      const fingerprint = page.articles.length ? await hash(page.articles.map(article => article.url).join('\n')) : '';
      if (!offset && (state.visited.includes(pageKey) || (fingerprint && state.fingerprints.includes(fingerprint)))) advance(state, feed, null);
      else {
        const cutoff = state.options.days ? Date.now() - state.options.days * 86400_000 : 0;
        const dated = page.articles.filter(article => article.dateSource !== 'collected' && article.dateSource !== 'updated' && Number.isFinite(Date.parse(article.publishedAt)));
        if (cutoff && dated.length && dated.every(article => Date.parse(article.publishedAt) < cutoff)) finish(state, 'period', '선택한 기간까지 확인했습니다. 기간을 넓히면 이 위치에서 이어받습니다.', false);
        else {
          let index = offset;
          // 한 요청의 데이터베이스 작업량도 제한한다. 페이지 중간에서 멈추면 항목 위치를 보관한다.
          const candidates: ParsedArticle[] = [];
          const room = Math.min(40, state.options.limit - state.added);
          for (; index < page.articles.length && candidates.length < room; index++) {
            const article = page.articles[index]; state.checked++;
            try { publicPageUrl(article.url); } catch { continue; }
            const date = Date.parse(article.publishedAt), knownDate = article.dateSource !== 'collected' && article.dateSource !== 'updated' && Number.isFinite(date);
            if (!knownDate) { state.unknownDates++; if (cutoff) continue; }
            if (knownDate) { if (!state.oldest || date < Date.parse(state.oldest)) state.oldest = new Date(date).toISOString(); if (cutoff && date < cutoff) continue; }
            candidates.push(article);
          }
          const reconciled = await reconcile(c.env, feedId, candidates);
          const saved = await saveFeedArticles(c.env.DB, feedId, reconciled.articles);
          state.added += saved.insertedCount; state.duplicates += reconciled.duplicates;
          if (state.options.markRead && saved.insertedIds.length) {
            for (let at = 0; at < saved.insertedIds.length; at += 20) {
              const ids = saved.insertedIds.slice(at, at + 20);
              await c.env.DB.prepare(`INSERT INTO article_states(user_id,article_id,is_read,is_saved,read_at) VALUES ${ids.map(() => '(?,?,1,0,?)').join(',')} ON CONFLICT(user_id,article_id) DO NOTHING`).bind(...ids.flatMap(id => [userId, id, nowIso()])).run();
            }
          }
          finish(state, 'ready', '공개된 과거 목록을 확인하고 있습니다.', false);
          if (index < page.articles.length) state.source = { ...source, offset: index };
          else {
            state.pages++; state.visited.push(pageKey); if (fingerprint) state.fingerprints.push(fingerprint);
            advance(state, feed, page.next, page.sourceLimit);
          }
          if (state.source && state.added >= state.options.limit) finish(state, 'limit', '선택한 최대 개수까지 추가했습니다. 개수를 늘리면 이어받을 수 있습니다.', false);
        }
      }
      state.retryAt = null;
    }
  } catch (error) {
    // RSS의 공개 보관 경로가 없을 때만 웹 목록으로 넘어간다. 요청 제한은 그대로 기다린다.
    const retry = error instanceof HistorySourceError ? error.retryAt : null;
    if (state.source?.kind === 'rss' && !retry && !state.websiteStarted && feed.html_url) advance(state, feed, null);
    else { state.retryAt = retry; finish(state, retry ? 'rate_limit' : 'error', error instanceof HistorySourceError ? error.message : '과거 글을 받지 못했습니다. 잠시 뒤 저장된 위치에서 이어받아 주세요.', false); }
  } finally {
    state.revision++; state.updatedAt = nowIso(); state.readyAt = Date.now() + 1200;
    await c.env.DB.prepare('UPDATE feed_history_jobs SET state_json=?,revision=?,updated_at=?,lease_token=NULL,lease_until=0 WHERE user_id=? AND feed_id=? AND lease_token=?').bind(JSON.stringify(state), state.revision, state.updatedAt, userId, feedId, lease).run();
  }
  return c.json({ job: publicJob(state) });
});
export const feedHistoryRoutes = routes;
