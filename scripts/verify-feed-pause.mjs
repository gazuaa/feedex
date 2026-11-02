import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
try {
  const { app } = await vite.ssrLoadModule('/src/server/app.ts');
  const { LocalD1Database } = await vite.ssrLoadModule('/src/server/localD1.ts');
  const { upsertFeedAndArticles } = await vite.ssrLoadModule('/src/server/seedService.ts');
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
  const posts = (prefix, count, hoursAgo = 1) => Array.from({ length: count }, (_, i) => ({ guid: `${prefix}-${i}`, title: `${prefix} ${i}`, url: `https://noisy.example.test/${prefix}/${i}`, author: null, summary: 'Summary', contentHtml: '<p>Body</p>', thumbnailUrl: null, publishedAt: new Date(Date.now() - (hoursAgo + i) * 3600e3).toISOString(), dateSource: 'original' }));
  const noisy = (articles) => upsertFeedAndArticles(db, { title: 'Noisy', xmlUrl: 'https://noisy.example.test/feed', htmlUrl: 'https://noisy.example.test', description: '', faviconUrl: null, articles });

  const db = new LocalD1Database(':memory:', 'migrations/0001_schema.sql'), env = { DB: db, ALLOW_QUICK_LOGIN: 'true' };
  const login = async (email) => {
    const { token, user } = await (await app.request('/api/auth/google/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) }, env)).json();
    const api = (path, init = {}) => app.request(path, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers } }, env);
    api.userId = user.id;
    return api;
  };
  const owner = await login('pause-owner@example.test'), other = await login('pause-other@example.test');
  const { feedId } = await noisy(posts('before', 3));
  for (const api of [owner, other]) await db.prepare('INSERT INTO subscriptions(id,user_id,feed_id,created_at) VALUES(?,?,?,?)').bind(`sub-${api.userId}`, api.userId, feedId, new Date().toISOString()).run();
  const subscription = async (api = owner) => (await (await api('/api/bootstrap')).json()).subscriptions.find((sub) => sub.feed_id === feedId);
  const listed = async (api = owner, query = 'scope=all&unreadOnly=false') => (await (await api(`/api/articles?${query}`)).json()).articles;
  const setUpdates = (paused, id) => owner(`/api/subscriptions/${id}/updates`, { method: 'POST', body: JSON.stringify({ paused }) });

  const { syncCursor } = await (await owner('/api/bootstrap')).json();
  const sub = await subscription();
  assert.equal(sub.paused_at, null);
  assert.equal((await owner(`/api/subscriptions/${sub.id}/updates`, { method: 'POST', body: '{}' })).status, 400);
  assert.equal((await setUpdates(true, (await subscription(other)).id)).status, 404, 'another account\'s subscription cannot be paused');
  const paused = await (await setUpdates(true, sub.id)).json();
  assert.ok(paused.pausedAt);
  assert.equal((await (await setUpdates(true, sub.id)).json()).pausedAt, paused.pausedAt, 'pausing twice keeps the original time');

  await tick();
  await noisy(posts('during', 2, 0));
  assert.equal((await listed()).length, 3, 'articles arriving while paused stay out of the list');
  assert.equal((await listed(owner, `scope=feed&feedId=${feedId}&unreadOnly=true`)).length, 3);
  assert.equal((await listed(other)).length, 5, 'other subscribers of the same feed keep receiving it');
  const pausedSub = await subscription();
  assert.equal(pausedSub.paused_at, paused.pausedAt);
  assert.deepEqual([pausedSub.total_count, pausedSub.unread_count], [3, 3], 'counts leave out what the pause hides');
  const counts = (await (await owner('/api/bootstrap')).json()).counts;
  assert.deepEqual([counts.totalArticles, counts.totalUnread, counts.todayTotal], [3, 3, 3]);

  const delta = await (await owner('/api/sync', { method: 'POST', body: JSON.stringify({ cursor: syncCursor }) })).json();
  assert.equal(delta.subscriptions.find((item) => item.feed_id === feedId).paused_at, paused.pausedAt, 'other devices learn of the pause');
  assert.ok(delta.articles.every((article) => article.title.startsWith('before')), 'sync never delivers hidden articles');
  assert.ok(!(delta.newArticleIds ?? []).length, 'no notification for a paused feed');
  assert.equal(delta.subscriptionCounts.find((item) => item.feed_id === feedId).total_count, 3);

  const resumed = await (await setUpdates(false, sub.id)).json();
  assert.equal(resumed.pausedAt, null);
  const after = await listed();
  assert.equal(after.length, 5, 'resuming shows the articles from the pause');
  assert.ok(after.filter((article) => article.title.startsWith('during')).every((article) => article.is_read), 'they arrive read, not as a sudden unread backlog');
  const resumedSub = await subscription();
  assert.deepEqual([resumedSub.paused_at, resumedSub.total_count, resumedSub.unread_count], [null, 5, 3]);
  await noisy(posts('later', 1, 0));
  assert.equal((await listed(owner, 'scope=all&unreadOnly=true')).filter((article) => article.title.startsWith('later')).length, 1, 'new articles arrive again once resumed');

  // migrations/0004가 적용되기 전의 데이터베이스에 배포가 닿을 수 있다.
  const legacy = new LocalD1Database(':memory:', 'migrations/0001_schema.sql');
  await legacy.exec('ALTER TABLE subscriptions DROP COLUMN paused_at');
  const legacyEnv = { DB: legacy, ALLOW_QUICK_LOGIN: 'true' };
  const { token } = await (await app.request('/api/auth/google/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'legacy@example.test' }) }, legacyEnv)).json();
  const legacyApi = (path, init = {}) => app.request(path, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }, legacyEnv);
  const boot = await legacyApi('/api/bootstrap');
  assert.equal(boot.status, 200);
  assert.equal((await legacyApi('/api/articles?scope=all&unreadOnly=false')).status, 200);
  assert.equal((await legacyApi('/api/sync', { method: 'POST', body: JSON.stringify({ cursor: (await boot.json()).syncCursor }) })).status, 200);
  assert.equal((await legacyApi('/api/subscriptions/missing/updates', { method: 'POST', body: JSON.stringify({ paused: true }) })).status, 503, 'pausing waits for the migration instead of failing every list');
  console.log('PASS: pause hides only later arrivals for that subscriber, counts/sync/notifications follow, resume shows them read, ownership and validation, and a database without the migration keeps working.');
} finally { await vite.close(); }
