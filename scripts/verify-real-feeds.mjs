import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const originalFetch = globalThis.fetch;
try {
  const { app } = await vite.ssrLoadModule('/src/server/app.ts');
  const { default: worker } = await vite.ssrLoadModule('/src/worker.ts');
  const { LocalD1Database } = await vite.ssrLoadModule('/src/server/localD1.ts');
  const db = new LocalD1Database(':memory:', 'migrations/0001_schema.sql');
  const env = { DB: db, ALLOW_QUICK_LOGIN: 'true' };
  const login = await app.request('/api/auth/google/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'real-feeds@example.test' }) }, env);
  const { token, user } = await login.json();
  const request = (path, body) => app.request(path, {
    method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }, env);
  let mode = 'error';
  globalThis.fetch = async () => {
    if (mode === 'error') return new Response('unavailable', { status: 503 });
    if (mode === 'html') return new Response('<html><body>Not an RSS feed</body></html>');
    return new Response(`<rss version="2.0"><channel><title>Real publisher</title><link>https://example.test</link>${mode === 'empty' ? '' : '<item><guid>real-story</guid><title>Publisher story</title><link>https://example.test/story</link></item>'}</channel></rss>`);
  };
  for (const url of ['https://example.test/real.xml', 'https://news.hada.io/rss/news']) {
    const response = await request('/api/subscriptions', { url, folderName: 'No phantom folder' });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /HTTP 503/);
  }
  mode = 'html';
  assert.equal((await request('/api/subscriptions', { url: 'https://example.test/website' })).status, 502);
  for (const table of ['articles', 'feeds', 'subscriptions', 'folders']) {
    assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n, 0, `failed fetch must not create ${table}`);
  }
  mode = 'real';
  const subscribed = await (await request('/api/subscriptions', { url: 'https://example.test/real.xml' })).json();
  assert.equal(subscribed.insertedCount, 1);
  const real = await db.prepare('SELECT * FROM articles WHERE guid = ?').bind('real-story').first();
  assert.equal(real.title, 'Publisher story');
  mode = 'empty';
  const empty = await (await request('/api/subscriptions', { url: 'https://example.test/empty.xml' })).json();
  assert.equal(empty.insertedCount, 0, 'valid empty feeds must not receive welcome posts');
  mode = 'error';
  assert.equal((await (await request('/api/feeds/refresh', {})).json()).newArticles, 0);
  await worker.scheduled({}, env, {});
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM articles').first()).n, 1, 'manual and scheduled failures must preserve real articles without adding demos');
  assert.equal((await db.prepare('SELECT last_error FROM feeds WHERE id = ?').bind(subscribed.feedId).first()).last_error, 'HTTP 503');

  // 정리 표시를 실제 글, 비슷한 언론사 제목, 그리고 우연히 GUID가 같은 다른 언론사 글로
  // 확인한다.
  const now = new Date().toISOString();
  const addFeed = async (id, xml) => db.prepare('INSERT INTO feeds(id,xml_url,title,created_at) VALUES(?,?,?,?)').bind(id, xml, id, now).run();
  await addFeed('demo-feed', 'https://news.hada.io/rss/news');
  await addFeed('other-feed', 'https://example.test/other.xml');
  const body = '<p>피드가 성공적으로 구독되었습니다.</p><p>클라우드플레어 배포 환경 및 인터넷 연결 상태</p>';
  for (const [id, feedId, guid, title, content] of [
    ['welcome', subscribed.feedId, 'https://example.test/real.xml-welcome-1', 'example.test - 최신 업데이트 및 주요 기술 트렌드 아티클', body],
    ['demo', 'demo-feed', 'gn-cloudflare-d1-workers-2026', 'Old Sfeed demo', 'Demo'],
    ['similar-title', subscribed.feedId, 'real-notice', 'example.test - 최신 업데이트 및 주요 기술 트렌드 아티클', body],
    ['similar-guid', 'other-feed', 'https://example.test/other.xml-welcome-1', 'Publisher welcome message', 'Actual publisher content'],
    ['other-publisher', 'other-feed', 'gn-cloudflare-d1-workers-2026', 'Real story on another feed', 'Actual publisher content'],
  ]) {
    await db.prepare('INSERT INTO articles(id,feed_id,guid,title,url,content_html,published_at,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(id, feedId, guid, title, 'https://example.test', content, now, now).run();
  }
  for (const id of ['welcome', real.id]) {
    await db.prepare('INSERT INTO article_states(user_id,article_id,is_read,is_saved) VALUES(?,?,1,1)').bind(user.id, id).run();
  }
  const cleanup = readFileSync('migrations/0002_remove_synthetic_articles.sql', 'utf8');
  await db.exec(cleanup);
  await db.exec(cleanup);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM articles').first()).n, 4);
  assert.equal(await db.prepare('SELECT id FROM articles WHERE id = ?').bind('welcome').first(), null);
  assert.equal(await db.prepare('SELECT article_id FROM article_states WHERE article_id = ?').bind('welcome').first(), null);
  assert.deepEqual({ ...await db.prepare('SELECT is_read,is_saved FROM article_states WHERE article_id = ?').bind(real.id).first() }, { is_read: 1, is_saved: 1 });
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM subscriptions').first()).n, 2);
  console.log('PASS: failed subscribe/refresh/cron never creates synthetic articles; empty feeds stay empty; precise cleanup is idempotent and preserves real articles, subscriptions and bookmarks.');
} finally {
  globalThis.fetch = originalFetch;
  await vite.close();
}
