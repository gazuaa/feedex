import assert from 'node:assert/strict';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { createServer } from 'vite';

const originalNow = Date.now, originals = new Map(['indexedDB', 'IDBKeyRange', 'localStorage', 'window'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const values = new Map();
for (const [key, value] of Object.entries({ indexedDB, IDBKeyRange, localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }, window: { matchMedia: () => ({ matches: false }) } })) Object.defineProperty(globalThis, key, { configurable: true, value });
const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
try {
  const prefs = await vite.ssrLoadModule('/src/client/devicePreferences.ts');
  prefs.saveDevicePreferences('owner', { theme: 'light', autoRefreshMinutes: 1 }, 'desktop');
  prefs.saveDevicePreferences('owner', { theme: 'dark', autoRefreshMinutes: 30 }, 'mobile');
  assert.equal(prefs.readDevicePreferences('owner', 'desktop', { theme: 'dark' }).theme, 'light');
  assert.equal(prefs.readDevicePreferences('owner', 'mobile').autoRefreshMinutes, 30);
  prefs.saveFeedPreference('owner', 'one', { zoom: 0.75, view: 'web' }, 'desktop');
  prefs.saveFeedPreference('owner', 'one', { zoom: 1, view: 'reader' }, 'mobile');
  prefs.saveFeedPreference('owner', 'two', { zoom: 1.25 }, 'desktop');
  assert.equal(prefs.readFeedPreference('owner', 'one', 'desktop').zoom, 0.75);
  assert.equal(prefs.readFeedPreference('owner', 'two', 'desktop').zoom, 1.25);
  assert.equal(prefs.readFeedPreference('owner', 'one', 'mobile').zoom, 1, 'web zoom stays separate from the synchronized body view');
  assert.equal(prefs.readFeedPreference('other', 'one', 'desktop').zoom, undefined);
  for (const kind of ['desktop', 'mobile']) {
    assert.equal(prefs.feedViewPreference('owner', 'one', 'feed', kind), 'feed', 'shared feed mode overrides an older device choice');
    assert.equal(prefs.feedViewPreference('owner', 'one', 'web', kind), 'web');
  }
  assert.equal(prefs.feedViewPreference('owner', 'one', null, 'desktop'), 'web', 'the local choice is shown until its first safe import');
  assert.equal(prefs.feedViewPreference('other', 'one', null, 'desktop'), 'feed', 'legacy view fallback is account-scoped');

  const content = await vite.ssrLoadModule('/src/client/deviceContent.ts');
  const { setRetentionDays, retentionDays } = await vite.ssrLoadModule('/src/client/cachePolicy.ts');
  const { ArticleResources } = await vite.ssrLoadModule('/src/client/articleResources.ts');
  const { deviceSnapshots } = await vite.ssrLoadModule('/src/client/readerCache.ts');
  assert.equal(retentionDays('owner'), 30);
  let requests = [], running = 0, peak = 0;
  const request = async (path) => {
    requests.push(path); running++; peak = Math.max(peak, running); await new Promise(setImmediate); running--;
    return path.endsWith('/web-copy') ? { html: '<html><body>Original layout</body></html>', url: 'https://example.test/a' } : { fullContentHtml: '<p>Prepared full article</p>' };
  };
  const articles = Array.from({ length: 8 }, (_, n) => ({ id: `a${n}`, feed_id: 'one', url: `https://example.test/a${n}`, content_html: '<p>Feed body</p>', full_content_html: null, is_read: false, is_saved: false }));
  const resources = new ArticleResources('owner', () => true, request);
  await resources.preload(articles, () => true);
  assert.equal(requests.length, 5); assert.equal(peak, 1, 'preparing readers is bounded and serial');
  requests = [];
  assert.match((await new ArticleResources('owner', () => true, request).reader(articles[0])).full_content_html, /Prepared/);
  assert.equal(requests.length, 0, 'prepared reader opens without any HTTP request');
  assert.equal((await content.cachedArticle('owner', { ...articles[0], content_html: null, body_deferred: true })).body_deferred, false);
  content.rememberArticles('owner', articles); await new Promise(setImmediate); await new Promise(setImmediate);
  assert.match((await content.cachedArticle('owner', articles[0])).full_content_html, /Prepared/, 'later feed-only snapshots never erase the full reader');
  await resources.web(articles[0]); requests = [];
  assert.match((await new ArticleResources('owner', () => true, request).web(articles[0])).html, /Original layout/);
  assert.equal(requests.length, 0, 'a cached website copy opens locally');
  await content.writeContent('owner', 'web:http-broken', { html: '<html><head><link rel="stylesheet" href="http://image.rhythmer.net/css/common.css"></head><body>Broken copy</body></html>', url: 'http://board.rhythmer.net/src/go.php?n=21637' });
  assert.equal(await new ArticleResources('owner', () => true, request).cachedWeb({ id: 'http-broken', feed_id: 'one', url: 'http://board.rhythmer.net/src/go.php?n=21637' }), undefined, 'unproxied http stylesheet/image copies are discarded and refetched');
  const restarted = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
  try {
    const diskContent = await restarted.ssrLoadModule('/src/client/deviceContent.ts');
    assert.match((await diskContent.cachedArticle('owner', articles[0])).full_content_html, /Prepared/, 'a fresh runtime loads the reader from IndexedDB');
    assert.match((await diskContent.readContent('owner', 'web:a0')).data.html, /Original layout/, 'web copies also survive a fresh runtime');
  } finally { await restarted.close(); }
  const phoneRequests = [];
  const phone = await new ArticleResources('owner', () => true, async (path) => { phoneRequests.push(path); return { html: '<html><body>Phone layout</body></html>', url: 'https://example.test/a' }; }).phoneWeb(articles[0]);
  assert.deepEqual(phoneRequests, ['/api/articles/a0/web-copy?layout=phone']); assert.equal(phone.phone, true);
  const refitted = await new ArticleResources('owner', () => true, request).cachedWeb(articles[0]);
  assert.match(refitted.html, /Phone layout/); assert.equal(refitted.phone, true, 'the phone-width copy replaces the saved one and is never fitted again');
  assert.equal(await content.readContent('other', 'article:a0'), undefined);
  await deviceSnapshots.write({ account: 'owner', key: 'bootstrap', savedAt: Date.now(), size: 512, data: {} });
  const usage = await content.maintainDeviceCache('owner'); assert.ok(usage.bytes > 512); assert.ok(usage.entries > 5);
  await content.writeContent('other', 'article:keep', { url: 'https://example.test/keep', content_html: '<p>Other account</p>' });
  setRetentionDays('owner', 1); Date.now = () => originalNow() + 2 * 86400_000;
  assert.equal(await content.readContent('owner', 'article:a0'), undefined, 'expiry is enforced before maintenance');
  assert.equal((await content.maintainDeviceCache('owner')).bytes, 0, 'expired content and snapshots are physically removed');
  Date.now = originalNow;
  assert.ok(await content.readContent('other', 'article:keep'));
  let finish; const blocked = new ArticleResources('owner', () => true, () => new Promise((resolve) => { finish = resolve; }));
  const late = blocked.reader({ ...articles[0], id: 'late' });
  while (!finish) await new Promise(setImmediate);
  await content.maintainDeviceCache('owner', true);
  finish({ fullContentHtml: '<p>Too late</p>' }); await late;
  assert.equal(await content.readContent('owner', 'article:late'), undefined, 'deleting the cache rejects late background writes');
  assert.ok(await content.readContent('other', 'article:keep'));
  assert.equal(prefs.readDevicePreferences('owner', 'desktop').theme, 'light', 'cache deletion preserves device settings');

  const { app } = await vite.ssrLoadModule('/src/server/app.ts');
  const { LocalD1Database } = await vite.ssrLoadModule('/src/server/localD1.ts');
  const db = new LocalD1Database(':memory:', 'migrations/0001_schema.sql'), env = { DB: db, ALLOW_QUICK_LOGIN: 'true' };
  const { token } = await (await app.request('/api/auth/google/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'session@example.test' }) }, env)).json();
  const expiry = async () => Date.parse((await db.prepare('SELECT expires_at FROM sessions WHERE token=?').bind(token).first()).expires_at);
  assert.ok(await expiry() > Date.now() + 364 * 86400_000);
  await db.prepare('UPDATE sessions SET expires_at=? WHERE token=?').bind(new Date(Date.now() + 86400_000).toISOString(), token).run();
  const getMe = () => app.request('/api/user/me', { headers: { authorization: `Bearer ${token}` } }, env);
  assert.equal((await getMe()).status, 200); assert.ok(await expiry() > Date.now() + 364 * 86400_000, 'existing short sessions upgrade on use');
  const renewed = await expiry(); await getMe(); assert.equal(await expiry(), renewed, 'normal polling does not keep writing session expiry');
  await app.request('/api/user/logout', { method: 'POST', headers: { authorization: `Bearer ${token}` } }, env);
  assert.equal((await getMe()).status, 401, 'explicit logout remains revoked');
  console.log('PASS: shared body-view precedence with device-specific settings/zoom; serial bounded prefetch; zero-request cached reader/web; IndexedDB usage, expiry and account-safe deletion; late-write guards; renewable one-year sessions.');
} finally {
  Date.now = originalNow; await vite.close();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
}
