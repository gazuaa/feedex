import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const originalFetch = globalThis.fetch;
try {
  const { xProfile } = await vite.ssrLoadModule('/src/shared/xFeed.ts');
  const { normalizeFeedUrl } = await vite.ssrLoadModule('/src/shared/feedDiscovery.ts');
  for (const input of ['@NASA', 'https://x.com/NASA?lang=en', 'twitter.com/NASA/', 'https://mobile.twitter.com/NASA']) assert.equal(xProfile(input)?.url, 'https://x.com/nasa');
  for (const input of ['https://x.com/home', 'https://x.com/nasa/status/123', 'https://x.com.evil.test/NASA', 'https://secret@x.com/NASA', 'https://x.com:8443/NASA', 'https://x.com/../../settings', '@invalid-name', 'ftp://x.com/NASA']) assert.equal(xProfile(input), null, input);
  assert.equal(normalizeFeedUrl('@NASA'), 'https://x.com/nasa');

  const { xAuthorization, consumeXCallback } = await vite.ssrLoadModule('/src/client/xConnection.ts');
  const memory = new Map();
  const storage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: (key) => memory.delete(key) };
  const settings = { canUse: true, configured: true, clientId: 'client-id', redirectUri: 'https://sfeed.test/?x_callback=1' };
  await assert.rejects(xAuthorization({ ...settings, canUse: false }, 'sfeed-session', storage), /운영자/);
  assert.equal(memory.size, 0, '권한이 없으면 로그인 요청을 준비하지 않는다.');
  const authorize = new URL(await xAuthorization(settings, 'sfeed-session', storage));
  const pending = JSON.parse([...memory.values()][0]);
  assert.equal(authorize.origin, 'https://x.com');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorize.searchParams.get('code_challenge'), createHash('sha256').update(pending.verifier).digest('base64url'));
  assert.equal(authorize.searchParams.get('scope'), 'tweet.read users.read follows.read');
  assert.ok(!authorize.href.includes(pending.verifier));
  const callback = `?x_callback=1&code=code&state=${pending.state}`;
  assert.deepEqual(await consumeXCallback(callback, 'sfeed-session', storage), { code: 'code', verifier: pending.verifier });
  assert.equal(memory.size, 0);
  await assert.rejects(consumeXCallback(callback, 'sfeed-session', storage));
  for (const [state, token, created] of [['wrong-state', 'sfeed-session', Date.now()], [pending.state, 'different-account', Date.now()], [pending.state, 'sfeed-session', Date.now() - 601_000]]) {
    memory.set('sfeed_x_oauth_pending', JSON.stringify({ ...pending, created }));
    await assert.rejects(consumeXCallback(`?x_callback=1&code=code&state=${state}`, token, storage));
    assert.equal(memory.size, 0);
  }
  memory.set('sfeed_x_oauth_pending', JSON.stringify(pending));
  await assert.rejects(consumeXCallback(`?x_callback=1&error=access_denied&state=${pending.state}`, 'sfeed-session', storage), /취소/);

  const { app } = await vite.ssrLoadModule('/src/server/app.ts');
  const { LocalD1Database } = await vite.ssrLoadModule('/src/server/localD1.ts');
  const db = new LocalD1Database(':memory:', 'migrations/0001_schema.sql');
  const env = { DB: db, ALLOW_QUICK_LOGIN: 'true', OWNER_EMAIL: 'x-import@example.test', X_CLIENT_ID: 'client-id', X_CLIENT_SECRET: 'server-only-secret' };
  const login = async (email) => (await (await app.request('/api/auth/google/quick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }, env)).json()).token;
  const token = await login('x-import@example.test'), other = await login('x-other@example.test');
  const request = (path, body, auth = token, bindings = env) => app.request(path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, bindings);
  assert.equal((await app.request('/api/x/config', {}, env)).status, 401);
  const noConfig = { ...env, X_CLIENT_ID: undefined, X_CLIENT_SECRET: undefined };
  assert.equal((await (await request('/api/x/config', null, token, noConfig)).json()).configured, false);
  assert.equal((await request('/api/x/connect', { code: 'code', verifier: pending.verifier }, token, noConfig)).status, 503);
  const configResponse = await request('/api/x/config');
  assert.equal(configResponse.headers.get('Cache-Control'), 'no-store');
  const configText = await configResponse.text();
  assert.ok(!configText.includes('server-only-secret')); assert.equal(JSON.parse(configText).canUse, true);

  const setupEnv = { ...noConfig, OWNER_EMAIL: 'x-import@example.test', X_SETTINGS_SECRET: 'a-test-only-master-key-with-at-least-32-characters' };
  const putSettings = (body, auth = token, bindings = setupEnv) => app.request('/api/x/settings', { method: 'PUT', headers: { authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, bindings);
  assert.equal((await app.request('/api/x/settings', { method: 'PUT', body: '{}' }, setupEnv)).status, 401);
  const ownerConfig = await (await request('/api/x/config', null, token, setupEnv)).json();
  assert.equal(ownerConfig.canManage, true); assert.equal(ownerConfig.configured, false);
  const otherConfig = await request('/api/x/config', null, other, setupEnv);
  assert.equal(otherConfig.status, 403); assert.equal((await otherConfig.json()).code, 'x_owner_required');
  assert.equal((await putSettings({ clientId: 'client-id', clientSecret: 'server-only-secret' }, other)).status, 403);
  assert.equal((await putSettings({ clientId: 'client-id', clientSecret: 'server-only-secret' }, token, { ...setupEnv, OWNER_EMAIL: undefined })).status, 403);
  assert.equal((await putSettings({ clientId: 'client-id', clientSecret: '' })).status, 400);
  assert.equal((await putSettings({ clientId: 'client-id', clientSecret: 'server-only-secret' }, token, { ...setupEnv, X_SETTINGS_SECRET: undefined })).status, 400);
  const saved = await putSettings({ clientId: 'client-id', clientSecret: 'server-only-secret' });
  assert.equal(saved.status, 200); assert.equal(saved.headers.get('Cache-Control'), 'no-store');
  const savedText = await saved.text(); assert.ok(!savedText.includes('server-only-secret')); assert.equal(JSON.parse(savedText).configured, true);
  const storedSettings = await db.prepare("SELECT encrypted_value FROM integration_settings WHERE name='x_oauth'").first();
  assert.ok(!storedSettings.encrypted_value.includes('server-only-secret')); assert.ok(!storedSettings.encrypted_value.includes('client-id'));
  assert.equal((await (await request('/api/x/config', null, token, { ...setupEnv })).json()).configured, true, '프로세스 메모리 밖에 저장돼 다음 요청에도 연결 설정을 읽는다.');
  await putSettings({ clientId: 'invalid id', clientSecret: 'new-server-secret' });
  assert.equal((await db.prepare("SELECT encrypted_value FROM integration_settings WHERE name='x_oauth'").first()).encrypted_value, storedSettings.encrypted_value);
  assert.equal((await putSettings({ clientId: 'client-id', clientSecret: 'server-only-secret' }, token, { ...env, OWNER_EMAIL: setupEnv.OWNER_EMAIL })).status, 400, '환경 변수로 관리하는 키를 화면에서 덮어쓰지 않는다.');

  let apiCalls = [], rssCalls = [], apiMode = 'ok', rssMode = 'ok';
  const xml = (provider, username) => `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Example / @${username}</title><link>${provider}/${username}</link><image><url>${provider}/pic/https%3A%2F%2Fpbs.twimg.com%2Fprofile_images%2F123%2Favatar.jpg</url></image><item><guid>2000000000000000001</guid><title>A real post</title><link>${provider}/${username}/status/2000000000000000001#m</link><dc:creator>@${username}</dc:creator><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>Real post body</p><img src="${provider}/pic/media%2Fphoto.jpg"/><a href="https://example.test/?a=1&amp;b=2">link</a>]]></description></item><item><title>Unsafe post</title><link>https://evil.test/a</link></item></channel></rss>`;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    if (url.hostname === 'api.x.com') {
      apiCalls.push({ url, options });
      assert.equal(options.redirect, 'manual', '운영 Workers 엔진이 허용하는 옵션만 사용하고 인증정보를 다른 주소로 보내지 않는다.');
      if (apiMode === 'limited') return new Response('', { status: 429 });
      if (apiMode === 'billing') return new Response('', { status: 402 });
      if (apiMode === 'forbidden') return Response.json({ type: 'https://api.x.com/2/problems/client-forbidden', detail: 'private-account-diagnostic' }, { status: 403 });
      if (url.pathname === '/2/oauth2/token') {
        const form = new URLSearchParams(options.body);
        assert.equal(form.get('redirect_uri'), 'http://localhost/?x_callback=1');
        assert.equal(form.get('code_verifier'), pending.verifier);
        assert.equal(new Headers(options.headers).get('Authorization'), 'Basic ' + Buffer.from('client-id:server-only-secret').toString('base64'));
        return Response.json({ access_token: 'private-x-oauth-token', expires_in: 7200, scope: apiMode === 'missing-scope' ? 'users.read' : 'tweet.read users.read follows.read' });
      }
      assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer private-x-oauth-token');
      if (url.pathname === '/2/users/me') return Response.json({ data: { id: '1234567890123456789', username: 'myaccount' } });
      assert.equal(url.pathname, '/2/users/1234567890123456789/following');
      assert.equal(url.searchParams.get('max_results'), '1000');
      if (url.searchParams.has('pagination_token')) return Response.json({ data: [{ id: '3', username: 'third', name: 'Third' }], meta: { result_count: 1 } });
      return Response.json({ data: [{ id: '1', username: 'NASA', name: 'NASA', protected: false, profile_image_url: 'https://pbs.twimg.com/a.jpg' }, { id: '2', username: 'private', name: 'Private', protected: true }], meta: { next_token: '0123456789abcdef' } });
    }
    assert.ok(['nitter.mie.foundation', 'nitter.mizuki.st'].includes(url.hostname));
    rssCalls.push({ url, options });
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'manual');
    assert.ok(!new Headers(options.headers).has('Authorization'));
    if (rssMode === 'limited') return new Response('', { status: 429, headers: { 'Retry-After': '60' } });
    if (rssMode === 'fallback' && url.hostname === 'nitter.mie.foundation') return new Response('', { status: 503 });
    if (rssMode === 'one-limited' && url.hostname === 'nitter.mie.foundation') return new Response('<html>Instance has been rate limited</html>', { status: 429 });
    if (rssMode === 'alias') return new Response(xml('http://nitter.alias.test', url.pathname.split('/')[1]));
    if (rssMode === 'challenge') return new Response('<html><title>Verify your browser</title></html>');
    if (rssMode === 'redirect') return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } });
    const username = url.pathname.split('/')[1];
    return new Response(xml(url.origin, rssMode === 'wrong-profile' ? 'different' : username));
  };
  for (const bindings of [env, setupEnv, { ...env, OWNER_EMAIL: undefined }]) {
    for (const [path, body] of [
      ['/api/x/config', null],
      ['/api/x/connect', { code: 'code', verifier: pending.verifier }],
      ['/api/x/following', { connection: 'old-connection' }],
    ]) {
      const denied = await request(path, body, other, bindings);
      assert.equal(denied.status, 403); assert.equal(denied.headers.get('Cache-Control'), 'no-store');
      const deniedText = await denied.text();
      assert.equal(JSON.parse(deniedText).code, 'x_owner_required');
      assert.doesNotMatch(deniedText, /client-id|server-only-secret/);
    }
  }
  assert.equal((await request('/api/x/connect', { code: 'code', verifier: pending.verifier }, token, { ...env, OWNER_EMAIL: undefined })).status, 403, '운영자 설정이 없으면 누구에게도 X 연결을 허용하지 않는다.');
  assert.equal(apiCalls.length, 0, '다른 회원의 요청은 과금 가능한 X API를 호출하기 전에 차단한다.');
  assert.equal((await request('/api/x/connect', { code: '', verifier: pending.verifier })).status, 400);
  assert.equal(apiCalls.length, 0);
  const connected = await request('/api/x/connect', { code: 'code', verifier: pending.verifier }, token, setupEnv);
  assert.equal(connected.status, 200);
  const connector = await connected.json();
  assert.equal(connector.username, 'myaccount');
  assert.ok(!JSON.stringify(connector).includes('private-x-oauth-token'));
  const before = apiCalls.length;
  assert.equal((await request('/api/x/following', { connection: connector.connection }, other)).status, 403);
  assert.equal((await request('/api/x/following', { connection: connector.connection }, token, { ...env, OWNER_EMAIL: 'x-other@example.test' })).status, 403, '이미 연결한 사용자라도 운영자 권한이 없어지면 차단한다.');
  assert.equal((await request('/api/x/following', { connection: connector.connection + 'tampered' })).status, 401);
  assert.equal((await request('/api/x/following', { connection: connector.connection, cursor: '../bad' })).status, 400);
  assert.equal(apiCalls.length, before);
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 7201_000;
    assert.equal((await request('/api/x/following', { connection: connector.connection })).status, 401);
    assert.equal(apiCalls.length, before, '만료된 연결로 외부 API를 호출하지 않는다.');
  } finally { Date.now = originalNow; }
  const first = await (await request('/api/x/following', { connection: connector.connection })).json();
  assert.equal(first.accounts.length, 2); assert.equal(first.accounts[1].protected, true);
  const second = await (await request('/api/x/following', { connection: connector.connection, cursor: first.nextCursor })).json();
  assert.equal(second.accounts[0].username, 'third'); assert.equal(second.nextCursor, null);
  apiMode = 'limited';
  assert.equal((await request('/api/x/following', { connection: connector.connection })).status, 429);
  apiMode = 'billing';
  const billing = await request('/api/x/following', { connection: connector.connection });
  assert.equal(billing.status, 402);
  const billingError = await billing.json();
  assert.equal(billingError.code, 'x_credits_required'); assert.equal(billingError.upstreamStatus, 402);
  assert.match(billingError.error, /크레딧/);
  apiMode = 'forbidden';
  const forbidden = await request('/api/x/following', { connection: connector.connection });
  assert.equal(forbidden.status, 403);
  const forbiddenError = await forbidden.json();
  assert.equal(forbiddenError.code, 'x_access_forbidden'); assert.equal(forbiddenError.upstreamStatus, 403);
  assert.match(forbiddenError.error, /이용 권한/); assert.doesNotMatch(JSON.stringify(forbiddenError), /크레딧|잔액|private-account-diagnostic/);
  apiMode = 'missing-scope';
  assert.equal((await request('/api/x/connect', { code: 'code', verifier: pending.verifier })).status, 403);
  apiMode = 'ok';
  for (const table of ['feeds', 'articles', 'subscriptions', 'folders']) assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n, 0, '팔로우 조회만으로 구독하지 않는다.');

  const preview = await (await request('/api/discover/preview', { url: '@NASA' })).json();
  assert.equal(preview.feed.xmlUrl, 'https://x.com/nasa');
  assert.equal(preview.articles[0].url, 'https://x.com/nasa/status/2000000000000000001');
  assert.equal(preview.articles.length, 1);
  assert.equal(preview.articles[0].publishedAt, '2026-11-02T10:00:00.000Z');
  assert.equal(rssCalls.length, 1);
  const selectedItem = { title: 'NASA (@NASA)', xmlUrl: 'https://twitter.com/NASA', htmlUrl: 'https://x.com/NASA', folderName: 'X' };
  assert.equal((await (await request('/api/opml/import', { item: selectedItem })).json()).status, 'imported');
  assert.equal((await (await request('/api/opml/import', { item: selectedItem })).json()).status, 'existing');
  assert.equal(rssCalls.length, 1, '미리보기와 구독은 짧은 공개 피드 캐시를 공유한다.');
  const row = await db.prepare('SELECT guid,url,content_html,thumbnail_url,published_at FROM articles LIMIT 1').first();
  assert.equal(row.guid, 'x:2000000000000000001');
  assert.equal(row.thumbnail_url, 'https://pbs.twimg.com/media/photo.jpg');
  assert.ok(!row.content_html.includes('http://nitter'));
  assert.ok(!row.content_html.includes('&amp;amp;'));
  const { loadStoredFeed } = await vite.ssrLoadModule('/src/server/feedLoader.ts');
  const feed = await db.prepare('SELECT id,xml_url FROM feeds LIMIT 1').first();
  assert.equal((await loadStoredFeed(env, feed)).articles.length, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM subscriptions').first()).n, 1);
  const { fetchAndParseFeed } = await vite.ssrLoadModule('/src/server/rssParser.ts');
  rssMode = 'fallback';
  const fallback = await fetchAndParseFeed('@fallback');
  assert.equal(fallback.xmlUrl, 'https://x.com/fallback');
  for (const mode of ['wrong-profile', 'challenge', 'redirect']) {
    rssMode = mode;
    await assert.rejects(fetchAndParseFeed(`@${mode.replace('-', '')}`));
  }
  const invalidCount = rssCalls.length;
  await assert.rejects(fetchAndParseFeed('https://x.com/home'));
  assert.equal(rssCalls.length, invalidCount);
  // 다른 공개 주소 이름으로 피드를 만드는 경로도 같은 계정이면 받고, 링크는 모두 X 주소로 돌린다.
  rssMode = 'alias';
  const alias = await fetchAndParseFeed('@aliased');
  assert.equal(alias.htmlUrl, 'https://x.com/aliased');
  assert.equal(alias.articles[0].url, 'https://x.com/aliased/status/2000000000000000001');
  assert.equal(alias.articles[0].thumbnailUrl, 'https://pbs.twimg.com/media/photo.jpg');
  assert.ok(!alias.articles[0].contentHtml.includes('nitter.alias.test'));

  // 한 경로가 한도에 걸려도 다른 경로로 받고, 걸린 경로는 쉬는 동안 다시 부르지 않는다.
  rssMode = 'one-limited';
  for (const name of ['@onelimited', '@nextone', '@thirdone']) {
    const from = rssCalls.length;
    assert.equal((await fetchAndParseFeed(name)).xmlUrl, `https://x.com/${name.slice(1)}`);
    assert.ok(rssCalls.slice(from).every(({ url }, index, calls) => url.hostname === 'nitter.mizuki.st' || index < calls.length - 1));
  }
  assert.equal(rssCalls.filter(({ url }) => url.hostname === 'nitter.mie.foundation' && /onelimited|nextone|thirdone/.test(url.pathname)).length, 1, '한도를 알린 경로는 쉬는 동안 부르지 않는다.');

  // 한도가 풀린 뒤 두 경로가 모두 한도를 알리면 각 경로를 한 번씩만 부르고, 다시 시도할 시간을 알려 준다.
  const limitNow = Date.now;
  Date.now = () => limitNow() + 31_000;
  try {
    rssMode = 'limited';
    const limitCount = rssCalls.length;
    const limitedError = await fetchAndParseFeed('@limited').catch((error) => error);
    assert.match(limitedError.message, /요청 한도/);
    assert.ok(limitedError.retryAfter > 50 && limitedError.retryAfter <= 60, '경로가 알려 준 대기 시간을 전달한다.');
    assert.equal(rssCalls.length, limitCount + 2, '한도에 걸리면 다른 경로를 한 번만 시도한다.');
    await assert.rejects(fetchAndParseFeed('@cooldown'), /요청 한도/);
    assert.equal(rssCalls.length, limitCount + 2, '모든 경로가 쉬는 동안에는 외부에 요청하지 않는다.');
    const limitedImport = await (await request('/api/opml/import', { item: { title: 'Limited', xmlUrl: 'https://x.com/limitedimport', htmlUrl: null, folderName: 'X' } })).json();
    assert.equal(limitedImport.status, 'failed'); assert.equal(limitedImport.failureSaved, true);
    assert.ok(limitedImport.retryAfter > 0 && limitedImport.retryAfter <= 60, '가져오기 화면이 기다렸다 다시 받을 수 있게 대기 시간을 돌려준다.');
    assert.equal(rssCalls.length, limitCount + 2);
  } finally { Date.now = limitNow; }

  // 가져오기 화면은 한도 실패를 다음 계정으로 넘기지 않고, 기다렸다가 같은 계정부터 다시 받는다.
  const { importWithinLimits } = await vite.ssrLoadModule('/src/client/importLimits.ts');
  const waits = [], marks = [];
  const pause = { wait: async (ms) => { waits.push(ms); }, cancel: () => {} };
  const limitedResult = { status: 'failed', foldersCreated: 0, error: '요청 한도', retryAfter: 20 };
  let runs = 0;
  let outcome = await importWithinLimits(async () => (++runs < 3 ? limitedResult : { status: 'imported', foldersCreated: 0 }), { pause, stopped: () => false, onWait: (until) => marks.push(until) });
  assert.deepEqual([outcome.result.status, outcome.limited, runs, waits], ['imported', false, 3, [21_000, 21_000]]);
  assert.equal(marks.filter((until) => until === null).length, 2, '기다림이 끝나면 대기 표시를 지운다.');
  runs = 0; waits.length = 0;
  outcome = await importWithinLimits(async () => { runs++; return limitedResult; }, { pause, stopped: () => false, onWait: () => {} });
  assert.deepEqual([outcome.limited, runs, waits.length], [true, 4, 3], '세 번 기다려도 풀리지 않으면 멈추게 알린다.');
  runs = 0; waits.length = 0;
  outcome = await importWithinLimits(async () => { runs++; return { status: 'failed', foldersCreated: 0, error: '없는 계정' }; }, { pause, stopped: () => false, onWait: () => {} });
  assert.deepEqual([outcome.limited, runs, waits.length], [false, 1, 0], '한도가 아닌 실패는 기다리지 않는다.');
  let stopped = false; runs = 0;
  outcome = await importWithinLimits(async () => { runs++; return limitedResult; }, { pause: { wait: async () => { stopped = true; }, cancel: () => {} }, stopped: () => stopped, onWait: () => {} });
  assert.deepEqual([outcome.limited, runs], [true, 1], '기다리는 중에 중단하면 다시 요청하지 않는다.');
  console.log('PASS: owner-only encrypted persistent X setup, no secret disclosure or overwrite on invalid input, stored-key OAuth, PKCE/state/session checks, private account-bound tokens, paginated follows, explicit imports, public feed refresh/cache, per-provider cooldown with fallback and alias hosts, and import waits on rate limits.');
} finally { globalThis.fetch = originalFetch; await vite.close(); }
