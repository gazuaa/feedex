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
  // 새로고침은 느린 피드를 끝까지 기다리지 않고, 보고 있는 폴더의 피드부터, 정한 수만큼만 동시에 받는다.
  {
    const old = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
    await db.prepare('INSERT INTO folders(id,user_id,name,created_at) VALUES(?,?,?,?)').bind('fld-open', user.id, 'Open folder', now).run();
    const addSubscribed = async (id, fetchedAt, folderId = null) => {
      await db.prepare('INSERT INTO feeds(id,xml_url,title,last_fetched_at,created_at) VALUES(?,?,?,?,?)').bind(id, `https://example.test/refresh/${id}.xml`, id, fetchedAt, now).run();
      await db.prepare('INSERT INTO subscriptions(id,user_id,feed_id,folder_id,created_at) VALUES(?,?,?,?,?)').bind(`sub-${id}`, user.id, id, folderId, now).run();
    };
    await db.prepare('UPDATE feeds SET last_fetched_at = ?').bind(new Date().toISOString()).run();
    await addSubscribed('fresh', old(1));
    await addSubscribed('slow', old(60), 'fld-open');
    await addSubscribed('in-folder', old(10), 'fld-open');
    for (let i = 0; i < 8; i++) await addSubscribed(`oldest-${i}`, old(600 - i));
    const asked = []; let open = 0, mostOpen = 0, releaseSlow;
    const slowGate = new Promise((resolve) => { releaseSlow = resolve; });
    globalThis.fetch = async (input) => {
      const id = String(input.url || input).match(/refresh\/([^/]+)\.xml/)?.[1];
      asked.push(id); open += 1; mostOpen = Math.max(mostOpen, open);
      if (id === 'slow') await slowGate; else await new Promise((resolve) => setTimeout(resolve, 20));
      open -= 1;
      return new Response(`<rss version="2.0"><channel><title>${id}</title><link>https://example.test</link><item><guid>refresh-${id}</guid><title>Story ${id}</title><link>https://example.test/${id}</link></item></channel></rss>`);
    };
    const started = Date.now();
    // 대기 시간이 사라져도 멈춰 있지 않고 아래 검사에서 실패하게 한다.
    const safety = setTimeout(releaseSlow, 6000);
    const answer = await (await request('/api/feeds/refresh', { folderId: 'fld-open' })).json();
    clearTimeout(safety);
    const took = Date.now() - started;
    assert.ok(took >= 2900 && took < 4000, `a slow feed holds the answer only up to the wait limit (${took}ms)`);
    assert.equal(answer.pendingFeeds, 1, 'the slow feed is reported as still running');
    assert.equal(answer.refreshedFeeds, 9);
    assert.equal(answer.newArticles, 9, 'finished feeds are saved before the answer');
    assert.deepEqual(asked.slice(0, 2), ['slow', 'in-folder'], 'the open folder goes first');
    assert.equal(asked[2], 'oldest-0', 'then the feeds fetched longest ago');
    assert.ok(!asked.includes('fresh'), 'a feed fetched moments ago is skipped');
    assert.ok(mostOpen <= 4, `plain feeds stay within the connection limit (${mostOpen} open)`);
    const stored = () => db.prepare('SELECT COUNT(*) AS n FROM articles WHERE feed_id = ?').bind('slow').first();
    assert.equal((await stored()).n, 0);
    const concurrent = await (await request('/api/feeds/refresh', { feedId: 'slow' })).json();
    assert.equal(concurrent.refreshedFeeds, 0);
    assert.equal(asked.filter(id => id === 'slow').length, 1, '수집 중인 피드는 중복 요청하지 않는다');
    releaseSlow();
    for (let i = 0; i < 50; i++) {
      const claim = await db.prepare("SELECT lease_until FROM feed_refresh_state WHERE feed_id='slow'").first();
      if ((await stored()).n && claim?.lease_until === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal((await stored()).n, 1, 'the slow feed finishes after the answer');
    const again = await (await request('/api/feeds/refresh', { feedId: 'slow' })).json();
    assert.equal(again.refreshedFeeds, 1, 'refreshing one feed always fetches it');
    assert.equal(again.pendingFeeds, 0);

    const lastSuccess = (await db.prepare("SELECT last_fetched_at FROM feeds WHERE id='slow'").first()).last_fetched_at;
    let limitedRequests = 0;
    globalThis.fetch = async () => {
      limitedRequests++;
      return new Response('', { status: 429, headers: { 'Retry-After': '7200' } });
    };
    await request('/api/feeds/refresh', { feedId: 'slow' });
    const failure = await db.prepare("SELECT last_fetched_at,last_error,retry_at FROM feeds JOIN feed_refresh_state ON feed_id=id WHERE id='slow'").first();
    assert.equal(failure.last_fetched_at, lastSuccess, '실패는 마지막 성공 시각을 덮지 않는다');
    assert.equal(failure.last_error, 'HTTP 429');
    assert.ok(failure.retry_at > Date.now() + 7_190_000, '원본이 준 2시간 대기를 지킨다');
    await request('/api/feeds/refresh', { feedId: 'slow' });
    assert.equal(limitedRequests, 1, '429 직후 다른 경로를 탐색하거나 다시 요청하지 않는다');
  }
  {
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    for (let i = 0; i < 26; i++) {
      const id = `schedule${String(i).padStart(2, '0')}`;
      await db.prepare('INSERT INTO feeds(id,xml_url,title,last_fetched_at,created_at) VALUES(?,?,?,?,?)')
        .bind(id, `https://x.com/${id}`, id, old, now).run();
      await db.prepare('INSERT INTO subscriptions(id,user_id,feed_id,created_at,paused_at) VALUES(?,?,?,?,?)')
        .bind(`sub-${id}`, user.id, id, now, i === 0 ? now : null).run();
    }
    const requested = [];
    globalThis.fetch = async input => {
      const url = new URL(input.url || input);
      const id = url.pathname.split('/')[1];
      assert.match(id, /^schedule\d+$/);
      requested.push(id);
      return new Response(`<rss version="2.0"><channel><title>${id}</title><link>https://x.com/${id}</link>
        <item><guid>latest</guid><title>Latest</title><link>https://x.com/${id}/status/1234567890</link></item></channel></rss>`);
    };
    const xTick = Date.UTC(2026, 10, 11, 0, 5);
    await worker.scheduled({ scheduledTime: xTick }, env, {});
    assert.equal(requested.length, 24, 'X 전용 회차는 최신 글 요청을 나눠 보낸다');
    assert.ok(!requested.includes('schedule00'), '멈춘 구독에는 자동 수집을 하지 않는다');
    await worker.scheduled({ scheduledTime: xTick + 5 * 60_000 }, env, {});
    assert.equal(requested.at(-1), 'schedule25', '다음 회차에서 남은 계정을 먼저 받는다');
    assert.equal(requested.length, 25);

    const providers = ['https://nitter.mie.foundation', 'https://nitter.mizuki.st'];
    for (const provider of providers) {
      await db.prepare('INSERT INTO x_provider_cooldowns(provider,retry_at) VALUES(?,?)')
        .bind(provider, Date.now() + 7200_000).run();
    }
    globalThis.fetch = async () => { throw new Error('대기 시간 중 외부 요청'); };
    const { fetchAndParseFeed } = await vite.ssrLoadModule('/src/server/rssParser.ts');
    await assert.rejects(fetchAndParseFeed('@another', db), error => error.retryAfter > 7100);
  }
  console.log('PASS: failed subscribe/refresh/cron never creates synthetic articles; empty feeds stay empty; precise cleanup is idempotent and preserves real articles, subscriptions and bookmarks.');
} finally {
  globalThis.fetch = originalFetch;
  await vite.close();
}
