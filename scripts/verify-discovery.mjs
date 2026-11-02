import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const originalFetch = globalThis.fetch;
try {
  const { normalizeFeedUrl, matchesFeedSearch } = await vite.ssrLoadModule('/src/shared/feedDiscovery.ts');
  assert.equal(normalizeFeedUrl(' example.test/blog '), 'https://example.test/blog');
  assert.equal(normalizeFeedUrl('http://example.test/feed'), 'http://example.test/feed');
  for (const value of ['토스 테크', 'javascript:alert(1)', 'ftp://example.test/feed', 'https://', 'https://user:pass@example.test']) assert.equal(normalizeFeedUrl(value), null);
  const feed = { title: '토스 테크', description: '개발과 디자인', category: '국내', tags: ['TypeScript'], htmlUrl: 'https://toss.tech', xmlUrl: 'https://toss.tech/rss' };
  assert.equal(matchesFeedSearch(feed, '토스 TypeScript'), true);
  assert.equal(matchesFeedSearch(feed, '없는 피드'), false);

  const { app } = await vite.ssrLoadModule('/src/server/app.ts');
  const { LocalD1Database } = await vite.ssrLoadModule('/src/server/localD1.ts');
  const db = new LocalD1Database(':memory:', 'migrations/0001_schema.sql');
  const env = { DB: db, ALLOW_QUICK_LOGIN: 'true' };
  const { token } = await (await app.request('/api/auth/google/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'discovery@example.test' }) }, env)).json();
  const request = (path, body) => app.request(path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, env);
  assert.equal((await app.request('/api/discover/preview', { method: 'POST', body: '{}' }, env)).status, 401);
  let fetches = 0;
  globalThis.fetch = async (input) => {
    fetches++;
    const url = String(input);
    if (url.includes('/broken')) return new Response('unavailable', { status: 503 });
    // 웹페이지를 서버 요청에서 막는 사이트: CoinDesk는 공식 피드만, 다른 사이트는 흔한 피드 경로 하나를 열어 둔다.
    if (url.startsWith('https://www.coindesk.com/') && url !== 'https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml') return new Response('<html><head><title>Vercel Security Checkpoint</title></head></html>', { status: 429 });
    if (url.startsWith('https://blocked.example.test/') && url !== 'https://blocked.example.test/rss.xml') return new Response('Forbidden', { status: url.endsWith('/feed') ? 404 : 403 });
    if (url.endsWith('/blog')) return new Response('<!doctype html><html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>');
    const items = Array.from({ length: 12 }, (_, i) => `<item><guid>story-${i}</guid><title>Story ${i}</title><link>https://example.test/story/${i}</link><description>Summary ${i}</description><pubDate>${new Date(Date.UTC(2026, 9, 1 + i)).toUTCString()}</pubDate></item>`).join('');
    return new Response(`<rss version="2.0"><channel><title>Preview fixture</title><link>https://example.test/blog</link><description>Read-only preview</description>${items}<item><title>Unsafe link</title><link>javascript:alert(1)</link></item></channel></rss>`);
  };
  for (const url of ['not a URL', 'file:///etc/passwd', 'ftp://example.test/feed']) assert.equal((await request('/api/discover/preview', { url })).status, 400);
  assert.equal(fetches, 0, 'invalid inputs must not make upstream requests');
  for (const url of ['https://example.test/feed.xml', 'example.test/blog']) {
    const response = await request('/api/discover/preview', { url });
    assert.equal(response.status, 200);
    const preview = await response.json();
    assert.equal(preview.feed.title, 'Preview fixture');
    assert.equal(preview.feed.xmlUrl, 'https://example.test/feed.xml');
    assert.equal(preview.articles.length, 10);
    assert.equal(preview.articles[0].title, 'Story 11');
    assert.ok(preview.articles.every((article) => article.url.startsWith('https://')));
  }
  const { curatedFeeds } = await (await request('/api/bootstrap')).json();
  assert.equal((await request(`/api/discover/feeds/${curatedFeeds[0].id}/preview`)).status, 200);
  assert.equal((await request('/api/discover/feeds/not-found/preview')).status, 404);
  assert.equal((await request('/api/discover/preview', { url: 'https://example.test/broken' })).status, 502);
  for (const url of ['https://www.coindesk.com/feed', 'coindesk.com', 'https://www.coindesk.com/markets/2026/11/02/some-story']) {
    const response = await request('/api/discover/preview', { url });
    assert.equal(response.status, 200, url);
    assert.equal((await response.json()).feed.xmlUrl, 'https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml', 'a CoinDesk address previews its official feed');
  }
  const blocked = await request('/api/discover/preview', { url: 'https://blocked.example.test/' });
  assert.equal(blocked.status, 200); assert.equal((await blocked.json()).feed.xmlUrl, 'https://blocked.example.test/rss.xml', 'a home page turned away still finds the open feed path');
  for (const table of ['folders', 'feeds', 'articles', 'subscriptions']) assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n, 0, `preview must not write ${table}`);
  const subscribed = await request('/api/subscriptions', { url: 'https://example.test/feed.xml', folderName: 'My folder', customTitle: 'My feed' });
  assert.equal(subscribed.status, 200);
  const bootstrap = await (await request('/api/bootstrap')).json();
  assert.equal(bootstrap.subscriptions.length, 1);
  assert.equal(bootstrap.subscriptions[0].title, 'My feed');
  assert.equal(bootstrap.folders[0].name, 'My folder');
  console.log('PASS: unified name search, URL normalization, authenticated read-only RSS/website previews, article sorting/limit, error recovery, publisher feeds behind blocked web pages, catalog previews and explicit subscription with folder/name options.');
} finally { globalThis.fetch = originalFetch; await vite.close(); }
