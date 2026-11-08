import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
try {
  const { app } = await vite.ssrLoadModule('/src/server/app.ts');
  const { LocalD1Database } = await vite.ssrLoadModule('/src/server/localD1.ts');
  const { matchesPage, filteredPage } = await vite.ssrLoadModule('/src/client/syncPages.ts');
  const { preloadArticleQueries } = await vite.ssrLoadModule('/src/client/readerPreload.ts');
  const db = new LocalD1Database(':memory:', 'migrations/0001_schema.sql');
  const env = { DB: db, ALLOW_QUICK_LOGIN: 'true' };
  const login = async email => (await app.request('/api/auth/google/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) }, env)).json();
  const owner = await login('exclude@example.test'), other = await login('exclude-other@example.test');
  const request = async (path, options = {}, token = owner.token) => {
    const res = await app.request(path, { ...options, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }, env);
    assert.equal(res.status, 200, await res.clone().text()); return res.json();
  };
  const now = new Date().toISOString();
  await db.prepare('INSERT INTO folders(id,user_id,name,created_at) VALUES(?,?,?,?)').bind('folder', owner.user.id, 'Folder', now).run();
  for (const feed of ['hide', 'keep']) {
    await db.prepare('INSERT INTO feeds(id,xml_url,title,created_at) VALUES(?,?,?,?)').bind(feed, `https://example.test/${feed}`, feed, now).run();
    await db.prepare('INSERT INTO subscriptions(id,user_id,feed_id,folder_id,created_at) VALUES(?,?,?,?,?)').bind(`sub-${feed}`, owner.user.id, feed, 'folder', now).run();
  }
  // Excluded posts dominate the first page; included posts must still fill every page.
  for (let i = 0; i < 12; i++) {
    const feed = i < 8 ? 'hide' : 'keep';
    await db.prepare('INSERT INTO articles(id,feed_id,guid,title,url,published_at,created_at) VALUES(?,?,?,?,?,?,?)').bind(`a${i}`, feed, `a${i}`, `Article ${i}`, `https://example.test/a${i}`, new Date(Date.now() - (i + 1) * 60_000).toISOString(), now).run();
  }
  await db.prepare('INSERT INTO article_states(user_id,article_id,is_saved) VALUES(?,?,1)').bind(owner.user.id, 'a0').run();
  assert.deepEqual(await request('/api/user/feed-exclusions'), { feedIds: [] });
  const save = ids => request('/api/user/feed-exclusions', { method: 'PUT', body: JSON.stringify({ feedIds: ids }) });
  assert.deepEqual(await save(['hide', 'hide']), { feedIds: ['hide'] });
  await request('/api/user/preferences', { method: 'PUT', body: JSON.stringify({ theme: 'dark' }) });
  assert.deepEqual(await request('/api/user/feed-exclusions'), { feedIds: ['hide'] }, 'device preference saves preserve account exclusions');
  assert.deepEqual(await request('/api/user/feed-exclusions', {}, other.token), { feedIds: [] }, 'account isolation');
  const param = new URLSearchParams({ scope: 'all', unreadOnly: 'false', excludedFeedIds: '["hide"]', limit: '2' });
  const first = await request(`/api/articles?${param}`);
  assert.deepEqual(first.articles.map(a => a.id), ['a8', 'a9']);
  const last = first.articles.at(-1); param.set('before', last.published_at); param.set('beforeId', last.id);
  const next = await request(`/api/articles?${param}`);
  assert.deepEqual(next.articles.map(a => a.id), ['a10', 'a11']);
  const rows = (await request('/api/articles?scope=all')).articles;
  const all = new URLSearchParams({ scope: 'all', excludedFeedIds: '["hide"]' });
  assert.equal(matchesPage(all, rows.find(a => a.id === 'a0')), false);
  assert.equal(filteredPage(all, rows).length, 4, 'local sync/cache applies the same filter');
  for (const scope of ['feed', 'folder', 'saved']) {
    const query = new URLSearchParams({ scope, feedId: 'hide', folderId: 'folder', excludedFeedIds: '["hide"]' });
    const result = await request(`/api/articles?${query}`);
    assert.ok(result.articles.some(a => a.feed_id === 'hide'), `${scope} stays accessible`);
    assert.ok(matchesPage(query, rows.find(a => a.id === 'a0')), `${scope} cache stays accessible`);
  }
  assert.equal((await request('/api/articles?scope=all&savedOnly=true&excludedFeedIds=%5B%22hide%22%5D')).articles[0].id, 'a0');
  assert.equal((await request('/api/articles?scope=all&articleId=a0&excludedFeedIds=%5B%22hide%22%5D')).articles[0].id, 'a0', 'exact article links bypass exclusion');
  const warmed = preloadArticleQueries(new URLSearchParams({ scope: 'feed', feedId: 'hide' }), ['folder'], ['hide']);
  assert.ok(warmed.filter(q => q.get('scope') === 'all').every(q => q.get('excludedFeedIds') === '["hide"]'));
  assert.ok(warmed.filter(q => q.get('scope') !== 'all').every(q => !q.has('excludedFeedIds')));
  await request('/api/articles/mark-all-read', { method: 'POST', body: JSON.stringify({ scope: 'all', excludedFeedIds: ['hide'] }) });
  const states = (await request('/api/articles?scope=all')).articles;
  assert.ok(states.filter(a => a.feed_id === 'hide').every(a => !a.is_read), 'bulk mark-read leaves excluded posts unread');
  assert.ok(states.filter(a => a.feed_id === 'keep').every(a => a.is_read));
  assert.deepEqual(await save([]), { feedIds: [] }, 'clear exclusions');
  const prefs = await db.prepare('SELECT preferences_json FROM users WHERE id = ?').bind(owner.user.id).first();
  assert.equal(JSON.parse(prefs.preferences_json).theme, 'dark', 'filter saves preserve other preferences');
  console.log('Feed exclusions: account persistence, query/cache parity, pagination, scoped access and mark-read passed.');
} finally { await vite.close(); }
