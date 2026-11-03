import assert from 'node:assert/strict';
import { createServer } from 'vite';
const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const originalFetch = globalThis.fetch;
try {
  const { app } = await vite.ssrLoadModule('/src/server/app.ts');
  const { LocalD1Database } = await vite.ssrLoadModule('/src/server/localD1.ts');
  const { upsertFeedAndArticles } = await vite.ssrLoadModule('/src/server/seedService.ts');
  const { readHistorySource } = await vite.ssrLoadModule('/src/server/feedHistorySources.ts');
  const { HISTORY_DAYS, HISTORY_LIMITS, historyDaysLabel, historyLimitLabel, validHistoryOptions } = await vite.ssrLoadModule('/src/shared/feedHistory.ts');
  assert.deepEqual(HISTORY_DAYS, [0, 7, 14, 30, 60, 90, 180, 365, 730, 1095, 1825, 3650]);
  assert.deepEqual(HISTORY_LIMITS, [0, 50, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000, 20000, 50000]);
  assert.equal(historyDaysLabel(0), '전체 기간'); assert.equal(historyDaysLabel(7), '최근 7일 (1주)'); assert.equal(historyDaysLabel(3650), '최근 10년 (3,650일)');
  assert.equal(historyLimitLabel(0), '전체 개수'); assert.equal(historyLimitLabel(50000), '50,000개');
  for (const days of HISTORY_DAYS) for (const limit of HISTORY_LIMITS) assert.equal(validHistoryOptions({ days, limit, markRead: true }), true);
  const db = new LocalD1Database(':memory:', 'migrations/0001_schema.sql'), env = { DB: db, ALLOW_QUICK_LOGIN: 'true' };
  const login = async email => {
    const { user, token } = await (await app.request('/api/auth/google/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) }, env)).json();
    const api = async (path, body) => { const response = await app.request(path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, env); return { status: response.status, ...await response.json() }; }; api.userId = user.id; return api;
  };
  const owner = await login('history-owner@example.test'), other = await login('history-other@example.test');
  const date = days => new Date(Date.now() - days * 86400_000).toISOString();
  const article = n => ({ guid: `rss-${n}`, title: `History article number ${n}`, url: n === 0 ? 'http://www.history.example.test/post/0/' : `https://history.example.test/post/${n}`, author: null, summary: null, contentHtml: null, thumbnailUrl: null, publishedAt: date(1 + n % 2), dateSource: 'feed' });
  const { feedId } = await upsertFeedAndArticles(db, { xmlUrl: 'https://history.example.test/feed', htmlUrl: 'https://history.example.test', title: 'History', faviconUrl: null, description: null, articles: [article(0)] });
  await db.prepare('INSERT INTO subscriptions(id,user_id,feed_id,created_at) VALUES(?,?,?,?)').bind('sub-history', owner.userId, feedId, date(0)).run();
  const existing = await db.prepare('SELECT id FROM articles WHERE feed_id=?').bind(feedId).first();
  await db.prepare('INSERT INTO article_states(user_id,article_id,is_read,is_saved,read_at) VALUES(?,?,0,1,?)').bind(owner.userId, existing.id, date(0)).run();
  const path = `/api/feeds/${feedId}/history`, options = { days: 365, limit: 100, markRead: true };
  assert.equal((await app.request(path, {}, env)).status, 401);
  assert.equal((await other(path)).status, 404);
  assert.equal((await other(path, { options })).status, 404);
  assert.equal((await owner(path, { options: { ...options, limit: 9999 } })).status, 400);
  let requests = [], limited = false, blockFetch, entered;
  const rss = ids => `<rss version="2.0"><channel><title>History</title>${ids.map(n => `<item><guid>rss-${n}</guid><title>History article number ${n}</title><link>https://history.example.test/post/${n}</link><pubDate>${date(1)}</pubDate></item>`).join('')}</channel></rss>`;
  const list = (start, count, next) => `<html><head><title>History</title></head><body><main>${Array.from({ length: count }, (_, i) => `<article><h2><a href="/post/${start + i}">History article number ${start + i}</a></h2><time datetime="${date(2)}"></time></article>`).join('')}</main>${next ? `<a rel="next" href="?page=${next}">Next page</a>` : ''}</body></html>`;
  globalThis.fetch = async (input, init) => {
    const url = String(input); requests.push(url);
    if (blockFetch) { entered?.(); await blockFetch; }
    if (limited) return new Response('', { status: 429, headers: { 'Retry-After': '45' } });
    if (url.endsWith('/feed')) return new Response(rss([0, 1]));
    if (new URL(url).searchParams.get('page') === '2') return new Response(list(41, 40, 3));
    if (new URL(url).searchParams.get('page') === '3') return new Response(list(81, 40, null));
    return new Response(list(0, 41, 2));
  };
  let job = (await owner(path, { options })).job;
  const step = async () => { await db.prepare('UPDATE feed_history_jobs SET state_json=json_set(state_json,\'$.readyAt\',0) WHERE user_id=? AND feed_id=?').bind(owner.userId, feedId).run(); const response = await owner(`${path}/step`, { revision: job.revision }); if (response.job) job = response.job; return response; };
  await step(); assert.equal(job.added, 1); assert.equal(job.pages, 1);
  const before = requests.length; await owner(`${path}/step`, { revision: job.revision - 1 }); assert.equal(requests.length, before, 'stale requests never refetch');
  assert.deepEqual((await owner(path)).job, job, 'reopening restores progress without upstream requests');
  for (let i = 0; i < 10 && job.reason === 'ready'; i++) await step();
  assert.equal(job.added, 100); assert.equal(job.reason, 'limit');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM articles WHERE feed_id=?').bind(feedId).first()).n, 101);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM articles WHERE feed_id=? AND url LIKE ?').bind(feedId, '%post/0%').first()).n, 1, 'web URL and RSS guid do not create copies');
  const originalState = await db.prepare('SELECT is_read,is_saved FROM article_states WHERE user_id=? AND article_id=?').bind(owner.userId, existing.id).first();
  assert.deepEqual([originalState.is_read, originalState.is_saved], [0, 1], 'existing unread and saved state stays intact');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM article_states WHERE user_id=? AND is_read=1').bind(owner.userId).first()).n, 100);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM article_states WHERE user_id=?').bind(other.userId).first()).n, 0, 'history read setting affects only the requesting account');
  const expanded = await owner(path, { options: { ...options, limit: 0 } }); assert.equal(expanded.status, 200); job = expanded.job; for (let i = 0; i < 10 && job.reason === 'ready'; i++) await step();
  assert.equal(job.added, 120); assert.equal(job.status, 'done');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM articles WHERE feed_id=?').bind(feedId).first()).n, 121, 'resume continues from the middle of a page and unlimited count collects to completion');
  job = (await owner(path, { options, restart: true })).job; limited = true; await step();
  assert.equal(job.reason, 'rate_limit'); const calls = requests.length; await step(); assert.equal(requests.length, calls, 'retry-after is respected on the server');
  limited = false;
  await db.prepare("UPDATE feed_history_jobs SET state_json=json_set(state_json,'$.retryAt',NULL) WHERE user_id=? AND feed_id=?").bind(owner.userId, feedId).run();
  job = (await owner(path, { options, restart: true })).job;
  let release; blockFetch = new Promise(resolve => { release = resolve; }); const arrived = new Promise(resolve => { entered = resolve; });
  const pending = step(); await arrived;
  assert.equal((await owner(`${path}/step`, { revision: job.revision })).status, 409);
  assert.equal((await owner(path, { options, restart: true })).status, 409, 'configuration cannot overwrite an active page');
  release(); await pending; blockFetch = null;

  // 기간 경계는 위치를 유지하고, 날짜 없는 글은 전체 기간에서만 포함한다.
  job = (await owner(path, { options: { ...options, days: 30 }, restart: true })).job;
  globalThis.fetch = async () => new Response(`<rss><channel><title>Old</title><item><title>Old publication article</title><guid>very-old</guid><link>https://history.example.test/post/old</link><pubDate>${date(90)}</pubDate></item></channel></rss>`);
  await step(); assert.equal(job.reason, 'period');
  assert.equal(job.added, 0); job = (await owner(path, { options: { ...options, days: 365 } })).job;
  await step(); assert.equal(job.added, 1, 'widening the period resumes the boundary page');
  job = (await owner(path, { options, restart: true })).job;
  globalThis.fetch = async () => new Response(list(500, 2, null).replace(/<time[^>]*><\/time>/g, ''));
  // RSS 경로 실패 뒤 웹 목록을 확인한다.
  await step(); await step(); assert.equal(job.added, 0); assert.equal(job.unknownDates, 2);
  job = (await owner(path, { options: { ...options, days: 0 }, restart: true })).job;
  await step(); await step(); assert.equal(job.added, 2, 'undated articles can be explicitly included');

  // 사이트의 공개 더보기 형식과 원문 날짜, 사이트가 지정한 페이지 상한을 검사한다.
  const html = `<main>${list(0, 2, null)}</main><button class="list-btn-more"></button><script>var params={};params['total']="60";params['list_per_page']="20";params['page']="1";params['list_page_limit']="2";articlePaging.vars.params=params;</script>`;
  globalThis.fetch = async input => String(input).includes('ajaxArticlePaging') ? new Response(JSON.stringify({ result: 'success', data: [{ idxno: '77', title: 'An older news article', summary: 'Summary', user_name: 'Author', pub_date: '2026-11-01', viewDate: '2026.11.01', viewTime: '14:20', default_img_url: '/photo/77.jpg' }] })) : new Response(html);
  const first = await readHistorySource({ kind: 'html', url: 'https://news.example.test/news/articleList.html' }, env);
  assert.equal(first.next.kind, 'news-json'); assert.equal(first.next.params.sc_section_code, '');
  const second = await readHistorySource(first.next, env);
  assert.equal(second.articles[0].publishedAt, '2026-11-01T05:20:00.000Z'); assert.equal(second.articles[0].thumbnailUrl, 'https://news.example.test/photo/77.jpg'); assert.equal(second.next, null); assert.equal(second.sourceLimit, true);
  globalThis.fetch = async () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } });
  await assert.rejects(() => readHistorySource({ kind: 'rss', url: 'https://news.example.test/feed' }, env), /공개|주소/);
  globalThis.fetch = async () => new Response('<feed xmlns="http://www.w3.org/2005/Atom"><title>Archive</title><link rel="next" href="?page=2"/><entry><id>atom-1</id><title>Archived atom article</title><link href="https://news.example.test/atom-1"/><published>2026-11-01T12:00:00Z</published></entry></feed>');
  assert.equal((await readHistorySource({ kind: 'rss', url: 'https://news.example.test/feed' }, env)).next.url, 'https://news.example.test/feed?page=2');
  globalThis.fetch = async () => new Response('<rss><channel><title>WP</title><generator>https://wordpress.org</generator></channel></rss>');
  assert.equal((await readHistorySource({ kind: 'rss', url: 'https://news.example.test/feed' }, env)).next, null, 'empty WordPress pages never generate more requests');
  globalThis.fetch = async () => new Response(list(700, 2, null) + '<a href="/news/articleList.html">전체 기사</a>');
  const scoped = await readHistorySource({ kind: 'site', url: 'https://history.example.test/category/crypto' }, env);
  assert.equal(scoped.articles.length, 2); assert.equal(scoped.next, null, 'a category feed never expands into the entire site');
  console.log('PASS: authentication, ownership, exact limit, page-offset resume, URL/guid deduplication, preserved states, account-only read marking, Retry-After, leases, news pagination/date/limit, Atom archives, and private redirects.');
} finally { globalThis.fetch = originalFetch; await vite.close(); }
