import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const originalFetch = globalThis.fetch;
try {
  {
  // 스트리밍을 기본 지원하지 않는 브라우저도 재생기를 클릭한 뒤 기기에서 직접 붙인다.
  const events = {}, mediaEvents = {}, loaded = [];
  const button = { hidden: false, disabled: false, textContent: '', addEventListener: (name, handler) => { events[name] = handler; } };
  const box = { dataset: {}, querySelector: () => button };
  let playCount = 0, attached = null, destroyed = false;
  const video = { dataset: { hlsSrc: 'https://video.twimg.com/vid/movie.m3u8' }, parentElement: box, canPlayType: () => '', play: async () => { playCount++; }, addEventListener: (name, handler) => { mediaEvents[name] = handler; } };
  class Hls {
    static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifest' };
    static isSupported = () => true;
    on(name, handler) { mediaEvents[name] = handler; }
    loadSource(url) { loaded.push(url); }
    attachMedia(target) { attached = target; }
    destroy() { destroyed = true; }
  }
  const document = { currentScript: { dataset: { hls: 'https://sfeed.test/assets/hls.js' } }, querySelectorAll: () => [video], createElement: () => ({}), head: { append: (script) => queueMicrotask(() => script.onload()) } };
  runInNewContext(readFileSync('src/client/xFramePlayer.js', 'utf8'), { document, window: { Hls }, addEventListener: (_, handler) => handler(), Promise, Error });
  assert.deepEqual(loaded, [], '재생을 누르기 전에는 영상 데이터를 미리 받지 않는다.');
  await events.click(); assert.equal(attached, video); assert.deepEqual(loaded, [video.dataset.hlsSrc]);
  mediaEvents.manifest(); await Promise.resolve(); assert.equal(playCount, 1); assert.equal(button.hidden, true);
  mediaEvents.error(null, { fatal: true }); assert.equal(destroyed, true); assert.equal(button.hidden, false); assert.equal(box.dataset.failed, '1');
  }

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

  let apiCalls = [], rssCalls = [], apiMode = 'ok', rssMode = 'ok', pageMode = 'ok';
  // 공개 미러의 글 페이지: 본문, 인용, 사진, GIF, 댓글 묶음, 더 보기. 위험한 글자와 링크를 일부러 섞는다.
  const statusPage = (user) => `<!doctype html><html><head><title>Example | Mirror</title><script>alert(1)</script></head><body><nav><a href="/settings">Preferences</a></nav><div class="conversation"><div class="main-thread">
    <div id="m" class="main-tweet"><div class="timeline-item"><div class="tweet-body"><div><div class="tweet-header"><a class="tweet-avatar" href="/${user}"><img class="avatar round" src="/pic/profile_images%2F1%2Fme_bigger.jpg"></a><div class="tweet-name-row"><div class="fullname-and-username"><a class="fullname" href="/${user}">Main &lt;b&gt;Name</a><a class="username" href="/${user}">@${user}</a></div><span class="tweet-date"><a href="/${user}/status/2000000000000000001#m" title="Nov 2, 2026 · 6:42 PM UTC">1h</a></span></div></div></div>
      <div class="tweet-content media-body">Main text &lt;script&gt;x&lt;/script&gt;<br><a href="/search?q=%23tag">#tag</a> <a href="javascript:alert(1)">bad</a> <a href="https://example.test/a" onclick="x()">site</a></div>
      <div class="attachments"><div class="gallery-row"><div class="attachment image"><a class="still-image" href="/pic/orig/media%2Fphoto.jpg"><img src="/pic/media%2Fphoto.jpg%3Fname%3Dsmall" onerror="x()"></a></div></div></div>
      <div class="quote quote-big"><a class="quote-link" href="/quoted/status/1999#m"></a><div class="tweet-name-row"><div class="fullname-and-username"><a class="fullname" href="/quoted">Quoted</a><a class="username" href="/quoted">@quoted</a></div></div><div class="quote-text">Quoted text <a href="/HSBC">@HSBC</a>’s rest of quote</div><div class="quote-media-container"><video poster="/pic/amplify_video_thumb%2F99%2Fimg%2Fquote.jpg" data-url="/video/SIGNED/https%3A%2F%2Fvideo.twimg.com%2Famplify_video%2F99%2Fpl%2Fmovie.m3u8%3Ftag%3D1"></video></div></div>
      <p class="tweet-published">Nov 2, 2026 · 6:42 PM UTC</p><div class="tweet-stats"><span class="tweet-stat"><div class="icon-container"><span class="icon-comment"></span> 2</div></span><span class="tweet-stat"><div class="icon-container"><span class="icon-heart"></span> 1,099</div></span></div></div></div></div></div>
    <div id="r" class="replies"><div class="reply thread thread-line"><div class="timeline-item"><div class="tweet-body"><div><div class="tweet-header"><a class="tweet-avatar" href="/fan"><img class="avatar round" src="/pic/abs.twimg.com%2Fsticky%2Fdefault.png"></a><div class="tweet-name-row"><div class="fullname-and-username"><a class="fullname" href="/fan">Fan</a><a class="username" href="/fan">@fan</a></div><span class="tweet-date"><a href="/fan/status/2000000000000000002#m" title="t">5m</a></span></div></div></div><div class="replying-to">Replying to <a href="/${user}">@${user}</a></div><div class="tweet-content media-body">First reply</div><div class="attachments media-gif"><div class="attachment"><video class="gif" poster="/pic/tweet_video_thumb%2Fgif.jpg"><source src="/pic/video.twimg.com%2Ftweet_video%2Fgif.mp4" type="video/mp4"></video></div></div></div></div>
      <div class="timeline-item"><div class="tweet-body"><div><div class="tweet-header"><div class="tweet-name-row"><div class="fullname-and-username"><a class="fullname" href="/other">Other</a><a class="username" href="/other">@other</a></div><span class="tweet-date"><a href="/other/status/2000000000000000003#m">4m</a></span></div></div></div><div class="tweet-content media-body">Nested reply</div></div></div></div>
      <div class="show-more"><a href="?cursor=abc#r">Load more</a></div></div></div></body></html>`;
  const xml = (provider, username) => `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Example / @${username}</title><link>${provider}/${username}</link><image><url>${provider}/pic/https%3A%2F%2Fpbs.twimg.com%2Fprofile_images%2F123%2Favatar.jpg</url></image><item><guid>2000000000000000001</guid><title>A real post</title><link>${provider}/${username}/status/2000000000000000001#m</link><dc:creator>@${username}</dc:creator><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>Real post body</p><img src="${provider}/pic/media%2Fphoto.jpg"/><a href="https://example.test/?a=1&amp;b=2">link</a><cite><a href="${provider}/quoted/status/1999#m">${provider}/quoted/status/1999#m</a></cite>]]></description></item><item><title>Unsafe post</title><link>https://evil.test/a</link></item></channel></rss>`;
  // 쪽으로 나뉜 미러 RSS: 한 쪽에 20개, Min-Id 헤더가 다음(더 옛날) 쪽의 위치다. 글 번호가 클수록 최근 글이다.
  let historyNewest = 45, pagedLimited = false;
  const pagedResponse = (url) => {
    const cursor = url.searchParams.get('cursor');
    if (cursor && pagedLimited) return new Response('', { status: 429 });
    const top = cursor ? Number(/^cursor-(\d+)$/.exec(cursor)?.[1] || 0) : historyNewest;
    const ids = Array.from({ length: Math.max(0, Math.min(20, top)) }, (_, i) => top - i);
    const items = ids.map((n) => `<item><title>History ${n}</title><link>${url.origin}/history/status/3000000000000000${String(n).padStart(3, '0')}#m</link><pubDate>${new Date(Date.now() - (100 - n) * 3600_000).toUTCString()}</pubDate><description><![CDATA[<p>History ${n}</p>]]></description></item>`).join('');
    const next = ids.length ? `cursor-${ids.at(-1) - 1}` : cursor;
    return new Response(`<?xml version="1.0"?><rss version="2.0"><channel><title>History / @history</title><link>${url.origin}/history</link>${items}</channel></rss>`, { headers: { 'Min-Id': next || 'cursor-0' } });
  };
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
    if (url.pathname.includes('/status/')) {
      if (pageMode === 'challenge' && url.hostname === 'nitter.mie.foundation') return new Response("<html><head><title>Making sure you're not a bot!</title></head><body><script>work()</script></body></html>");
      if (pageMode === 'missing') return new Response('<html><body><div class="error-panel"><span>Tweet not found</span></div></body></html>');
      if (pageMode === 'down') return new Response('', { status: 503 });
      return new Response(statusPage(url.pathname.split('/')[1]));
    }
    if (rssMode === 'paged') return pagedResponse(url);
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
  assert.ok(!row.content_html.includes('nitter'), '속성뿐 아니라 글자로 적힌 미러 주소도 X 주소로 바꾼다.');
  assert.ok(row.content_html.includes('>https://x.com/quoted/status/1999<'));
  assert.equal((await db.prepare("SELECT favicon_url FROM feeds WHERE xml_url='https://x.com/nasa'").first()).favicon_url, 'https://pbs.twimg.com/profile_images/123/avatar.jpg', 'X 계정 아이콘은 프로필 사진이다.');
  assert.ok(!row.content_html.includes('&amp;amp;'));
  const { loadStoredFeed } = await vite.ssrLoadModule('/src/server/feedLoader.ts');
  const feed = await db.prepare('SELECT id,xml_url FROM feeds LIMIT 1').first();
  assert.equal((await loadStoredFeed(env, feed)).articles.length, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM subscriptions').first()).n, 1);

  // X 계정들은 본문 보기를 함께 쓴다. X가 아닌 피드와 다른 회원의 선택은 건드리지 않는다.
  const xImport = async (name) => (await (await request('/api/opml/import', { item: { title: name, xmlUrl: `https://x.com/${name}`, htmlUrl: null, folderName: 'X' } })).json()).status;
  assert.equal(await xImport('second'), 'imported');
  const { upsertFeedAndArticles } = await vite.ssrLoadModule('/src/server/seedService.ts');
  const plain = (await upsertFeedAndArticles(db, { title: 'Plain', xmlUrl: 'https://plain.example.test/feed', htmlUrl: 'https://plain.example.test', description: '', faviconUrl: null, articles: [] })).feedId;
  const ownerId = (await db.prepare("SELECT id FROM users WHERE email='x-import@example.test'").first()).id;
  const otherId = (await db.prepare("SELECT id FROM users WHERE email='x-other@example.test'").first()).id;
  const subscribe = (userId, feedId) => db.prepare('INSERT INTO subscriptions(id,user_id,feed_id,folder_id,created_at) VALUES(?,?,?,?,?)').bind(`sub-${userId}-${feedId}`, userId, feedId, null, new Date().toISOString()).run();
  await subscribe(ownerId, plain); await subscribe(otherId, feed.id);
  const views = async (auth = token) => Object.fromEntries((await (await request('/api/bootstrap', null, auth)).json()).subscriptions.map((sub) => [sub.xml_url, sub.view_mode ?? null]));
  const putView = async (feedId, body, auth = token) => (await app.request(`/api/feeds/${feedId}/view-mode`, { method: 'PUT', headers: { authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env)).json();
  const secondFeed = (await db.prepare("SELECT id FROM feeds WHERE xml_url='https://x.com/second'").first()).id;
  const xChange = await putView(feed.id, { viewMode: 'web' });
  assert.deepEqual([xChange.viewMode, [...xChange.feedIds].sort()], ['web', [feed.id, secondFeed].sort()]);
  assert.deepEqual(await views(), { 'https://x.com/nasa': 'web', 'https://x.com/second': 'web', 'https://plain.example.test/feed': null }, '한 X 계정의 보기가 모든 X 계정에 적용되고 다른 피드는 그대로다.');
  assert.deepEqual(await views(other), { 'https://x.com/nasa': null }, '다른 회원의 보기는 바뀌지 않는다.');
  assert.equal((await putView(plain, { viewMode: 'reader' })).feedIds, undefined);
  assert.equal((await views())['https://x.com/second'], 'web', 'X가 아닌 피드의 보기는 그 피드에만 적용된다.');
  assert.equal(await xImport('third'), 'imported');
  assert.equal((await views())['https://x.com/third'], 'web', '새로 구독한 X 계정은 X 계정에 고른 보기를 이어받는다.');
  await putView(secondFeed, { viewMode: 'reader' });
  assert.deepEqual(new Set(Object.entries(await views()).filter(([url]) => url.startsWith('https://x.com/')).map(([, view]) => view)), new Set(['reader']));
  await db.prepare("DELETE FROM feed_view_modes WHERE feed_id=?").bind(secondFeed).run();
  assert.equal((await putView(secondFeed, { viewMode: 'feed', onlyIfUnset: true })).feedIds, undefined);
  assert.deepEqual([(await views())['https://x.com/second'], (await views())['https://x.com/nasa']], ['feed', 'reader'], '빈 보기를 채우는 저장은 그 계정에만 적용된다.');
  await db.prepare("DELETE FROM subscriptions WHERE feed_id IN (?,?) OR user_id=?").bind(secondFeed, plain, otherId).run();
  await db.prepare("DELETE FROM subscriptions WHERE feed_id=(SELECT id FROM feeds WHERE xml_url='https://x.com/third')").run();
  // X 글의 웹 보기: 공개 미러의 글 페이지로 글과 댓글을 담은 안전한 사본을 만든다.
  const articleId = (await db.prepare("SELECT id FROM articles WHERE url='https://x.com/nasa/status/2000000000000000001'").first()).id;
  const pageCalls = () => rssCalls.filter(({ url }) => url.pathname.includes('/status/')).length;
  const threadCopy = await (await request(`/api/articles/${articleId}/web-copy`)).json();
  assert.equal(threadCopy.thread, true); assert.equal(threadCopy.url, 'https://x.com/nasa/status/2000000000000000001');
  const copyHtml = threadCopy.html;
  for (const text of ['Main &lt;b&gt;Name', 'Main text &lt;script&gt;x&lt;/script&gt;', 'Quoted text', 'First reply', 'Nested reply', '댓글 2', '좋아요 1,099', '댓글 더 보기', 'X에서 열기']) assert.ok(copyHtml.includes(text), text);
  for (const url of ['https://pbs.twimg.com/profile_images/1/me_bigger.jpg', 'https://pbs.twimg.com/media/photo.jpg', 'https://pbs.twimg.com/media/photo.jpg?name=small', 'https://abs.twimg.com/sticky/default.png', 'https://video.twimg.com/tweet_video/gif.mp4', 'https://pbs.twimg.com/tweet_video_thumb/gif.jpg', 'https://x.com/search?q=%23tag', 'https://x.com/quoted/status/1999', 'https://x.com/fan/status/2000000000000000002', 'https://example.test/a']) assert.ok(copyHtml.includes(`"${url}"`), url);
  assert.doesNotMatch(copyHtml, /<script|onclick|onerror|javascript:|\/pic\/|nitter|Preferences|#m"/i, '스크립트·이벤트·미러 주소·미러 화면 요소를 남기지 않는다.');
  assert.match(copyHtml, /<base href="https:\/\/x\.com\/nasa\/status\/2000000000000000001" target="_blank">/);
  assert.equal(copyHtml.match(/class="post reply"/g).length, 2);
  // 인용 글 상자 전체가 링크이므로, 그 안의 링크는 글자로 둔다. 링크가 겹치면 남은 글이 상자 밖으로 흘러나온다.
  assert.match(copyHtml, /<div class="quote"><a class="quote-post" href="https:\/\/x\.com\/quoted\/status\/1999">(?:(?!<a |<\/a>)[\s\S])*<span class="link">@HSBC<\/span>’s rest of quote<\/span><\/a><div class="media">/);
  assert.ok(copyHtml.includes('data-hls-src="https://video.twimg.com/amplify_video/99/pl/movie.m3u8?tag=1"'));
  assert.ok(copyHtml.includes('controls preload="none" playsinline'));
  assert.ok(copyHtml.includes('<meta name="sfeed-x-thread" content="3">'), '지금 방식의 사본이라는 표시를 단다.');
  const quotedPath = `/api/articles/${articleId}/x-post?url=${encodeURIComponent('https://x.com/quoted/status/1999')}`;
  assert.equal((await request(quotedPath)).status, 200);
  assert.equal((await request(quotedPath, null, other)).status, 404);
  assert.equal((await request(`/api/articles/${articleId}/x-post?url=${encodeURIComponent('http://127.0.0.1/private')}`)).status, 400);
  const { xVideoSource, xVideoHtml } = await vite.ssrLoadModule('/src/shared/xMedia.ts');
  for (const unsafe of ['http://video.twimg.com/a.mp4', 'https://evil.test/a.mp4', 'https://video.twimg.com@evil.test/a.mp4', 'https://video.twimg.com:444/a.mp4', 'https://video.twimg.com/a.html', 'javascript:alert(1)']) assert.equal(xVideoSource(unsafe), null);
  assert.match(xVideoHtml('https://video.twimg.com/vid/a.mp4', null, 'https://x.com/a/status/1'), /controls preload="none" playsinline/);

  // 글 페이지에 봇 확인을 거는 경로는 우회하지 않고 다른 경로를 쓴 뒤 한동안 부르지 않는다.
  pageMode = 'challenge';
  const { fetchXThread } = await vite.ssrLoadModule('/src/server/xThread.ts');
  let pagesBefore = pageCalls();
  assert.equal((await fetchXThread('https://x.com/nasa/status/2000000000000000004')).thread, true);
  assert.equal(pageCalls(), pagesBefore + 2);
  pagesBefore = pageCalls();
  await fetchXThread('https://x.com/nasa/status/2000000000000000005');
  assert.deepEqual(rssCalls.slice(-1).map(({ url }) => url.hostname), ['nitter.mizuki.st']);
  assert.equal(pageCalls(), pagesBefore + 1, '봇 확인을 건 경로의 글 페이지는 다시 부르지 않는다.');
  pageMode = 'missing';
  await assert.rejects(fetchXThread('https://x.com/nasa/status/2000000000000000006'));
  pageMode = 'ok'; pagesBefore = pageCalls();
  await fetchXThread('https://x.com/nasa/status/2000000000000000007');
  assert.equal(pageCalls(), pagesBefore + 1, '지워진 글 안내는 그 경로를 쉬게 하지 않는다.');
  await assert.rejects(fetchXThread('https://x.com/nasa'), /X 글 주소/);
  // X 타임라인: X 폴더 판단, 실제 미러 RSS 모양의 글 해석, 목록 그리기.
  const { DOMParser } = await import('linkedom');
  const { xFolderIds, parseXPost, xFeedAccount, xTime } = await vite.ssrLoadModule('/src/client/xTimeline.ts');
  const subs = [['x1', 'fx', 'https://x.com/nasa'], ['x2', 'fx', 'https://x.com/coindesk'], ['m1', 'mixed', 'https://x.com/a'], ['m2', 'mixed', 'https://news.example.test/feed'], ['n1', null, 'https://x.com/b']].map(([id, folder_id, xml_url]) => ({ id, feed_id: id, folder_id, xml_url }));
  assert.deepEqual([...xFolderIds([{ id: 'fx' }, { id: 'mixed' }, { id: 'empty' }], subs)], ['fx'], '모든 피드가 X 계정인 폴더만 X 폴더다.');
  assert.deepEqual(xFeedAccount({ feed_title: 'Nous Research (@NousResearch)', feed_html_url: null }), { name: 'Nous Research', handle: 'NousResearch' });
  assert.deepEqual(xFeedAccount({ feed_title: 'NASA / @NASA', feed_html_url: 'https://x.com/nasa' }), { name: 'NASA', handle: 'NASA' });
  const base = { id: 'a', feed_id: 'f', feed_title: 'Nous Research (@NousResearch)', feed_favicon: 'https://pbs.twimg.com/profile_images/1/me.jpg', feed_html_url: 'https://x.com/nousresearch', published_at: '2026-11-02T18:42:00Z', is_read: false, is_saved: false };
  const parse = (fields) => parseXPost({ ...base, ...fields }, DOMParser);
  const quoted = parse({ title: '> hermes migrate grok-bot', url: 'https://x.com/NousResearch/status/2117326444669857941', content_html: '<p>&gt; hermes migrate grok-bot</p>\n<hr/>\n<blockquote>\n<b>Elon Musk (@elonmusk)</b>\n<p>\n<p>The cost of serving Grok Bot was unsustainably high relative to revenue</p>\n\n</p>\n<footer>\n— <cite><a href="https://x.com/elonmusk/status/2116992258520064397">https://x.com/elonmusk/status/2116992258520064397</a>\n</footer>\n</blockquote>' });
  assert.deepEqual([quoted.name, quoted.handle, quoted.avatar, quoted.text, quoted.repostedBy, quoted.media.length, quoted.card], ['Nous Research', 'NousResearch', 'https://pbs.twimg.com/profile_images/1/me.jpg', '> hermes migrate grok-bot', null, 0, null]);
  assert.deepEqual(quoted.quote, { name: 'Elon Musk', handle: 'elonmusk', text: 'The cost of serving Grok Bot was unsustainably high relative to revenue', href: 'https://x.com/elonmusk/status/2116992258520064397', media: [] });
  // 실제 미러 RSS 모양: 인용한 글에 동영상이 붙어 있다.
  const quotedVideo = parse({ title: 'Agents can now shop for domain names.', url: 'https://x.com/brian_armstrong/status/2115224970188185624', content_html: '<p>Agents can now shop for domain names.</p>\n<hr/>\n<blockquote>\n<b>Coinbase Business (@CoinbaseBiz)</b>\n<p>\n<p>Agents can now buy domains on <a href="https://x.com/atomHQ" title="Atom.com">@atomHQ</a>. Powered by Coinbase Business.<br>\n<br>\nHere’s how ↓</p>\n<a href="https://x.com/CoinbaseBiz/status/2115114597850206608">\n<br>Video<br>\n  <img src="https://pbs.twimg.com/amplify_video_thumb/2115114341553086464/img/LLIHL6EoiajyxGwV.jpg" style="max-width:250px;" />\n</a>\n\n\n</p>\n<footer>\n— <cite><a href="https://x.com/CoinbaseBiz/status/2115114597850206608">https://x.com/CoinbaseBiz/status/2115114597850206608</a>\n</footer>\n</blockquote>' });
  assert.deepEqual([quotedVideo.media.length, quotedVideo.quote.handle, quotedVideo.quote.text, quotedVideo.quote.media], [0, 'CoinbaseBiz', 'Agents can now buy domains on @atomHQ. Powered by Coinbase Business.\n\nHere’s how ↓', [{ src: 'https://pbs.twimg.com/amplify_video_thumb/2115114341553086464/img/LLIHL6EoiajyxGwV.jpg', video: true }]], '인용한 글의 동영상은 인용 글 안에 둔다.');
  const repost = parse({ feed_title: 'NASA (@NASA)', title: 'RT by @NASA: If you are under 26', url: 'https://x.com/NASAAdmin/status/2117320385792475643', content_html: '<p>If you are under 26.<br>\n<br>\nHumanity has had a home in space. Video of it</p>\n<img src="https://pbs.twimg.com/media/HWI7q25XMAAJUFk.jpg" style="max-width:250px;" />' });
  assert.deepEqual([repost.name, repost.handle, repost.avatar, repost.repostedBy, repost.text], ['NASAAdmin', 'NASAAdmin', null, 'NASA', 'If you are under 26.\n\nHumanity has had a home in space. Video of it'], '재게시는 원래 글쓴이로 보이고, 원본 HTML의 줄바꿈 글자는 줄을 더하지 않는다.');
  assert.deepEqual(repost.media, [{ src: 'https://pbs.twimg.com/media/HWI7q25XMAAJUFk.jpg', video: false }], '글에 Video라는 낱말이 있어도 사진은 사진이다.');
  const video = parse({ title: 'Happy Halloween!', url: 'https://x.com/NousResearch/status/1', content_html: '<p>Happy Halloween!</p>\n<a href="https://x.com/NousResearch/status/1">\n<br>Video<br>\n  <img src="https://pbs.twimg.com/media/thumb.jpg" style="max-width:250px;" />\n</a>' });
  assert.deepEqual(video.media, [{ src: 'https://pbs.twimg.com/media/thumb.jpg', video: true }]);
  const reply = parse({ title: 'R to @NousResearch: github.com/NousResearch/herm…', url: 'https://x.com/NousResearch/status/2', content_html: '<p><a href="https://github.com/NousResearch/hermes-agent/pull/147724">github.com/NousResearch/herm…</a></p>\n<hr/>\n<b>Link</b><br>\n<a href="https://github.com/NousResearch/hermes-agent/pull/147724">\n<img src="https://pbs.twimg.com/card_img/2117/aC3?format=jpg&amp;name=800x419" style="max-width:250px;" />\n<br>\n<b>Grok Bot and OpenBot users can move to Hermes</b>\n</a>\n<p>People leaving Grok Bot</p>' });
  assert.deepEqual([reply.replyTo, reply.text, reply.media.length], ['NousResearch', 'github.com/NousResearch/herm…', 0]);
  assert.deepEqual(reply.card, { href: 'https://github.com/NousResearch/hermes-agent/pull/147724', image: 'https://pbs.twimg.com/card_img/2117/aC3?format=jpg&name=800x419', title: 'Grok Bot and OpenBot users can move to Hermes' });
  assert.equal(parse({ title: 'R to @someone: only the title', url: 'https://x.com/NousResearch/status/3', content_html: null }).text, 'only the title');
  // 사본을 받는 동안 그리는 미리보기: 사본과 같은 모양, 글자는 모두 이스케이프, 댓글 자리는 불러오는 중.
  const { xThreadPreview } = await vite.ssrLoadModule('/src/client/xThreadPreview.ts');
  const draft = xThreadPreview({ ...base, title: 'Agents can now shop for domain names.', url: 'https://x.com/brian_armstrong/status/2115224970188185624', content_html: '<p>&lt;img src=x onerror=alert(1)&gt; see https://example.test/a?b=1&amp;c=2</p>\n<a href="https://x.com/brian_armstrong/status/2115224970188185624">\n<br>Video<br>\n  <img src="https://pbs.twimg.com/amplify_video_thumb/1/img/a.jpg" />\n</a>' }, false, DOMParser);
  for (const text of ['class="post main"', '<base href="https://x.com/brian_armstrong/status/2115224970188185624" target="_blank">', '&lt;img src=x onerror=alert(1)&gt;', '<a href="https://example.test/a?b=1&amp;c=2">', 'class="photo video"', 'amplify_video_thumb/1/img/a.jpg', 'class="empty loading"', 'X에서 열기', 'Nov 2, 2026 · 6:42 PM UTC']) assert.ok(draft.includes(text), text);
  assert.doesNotMatch(draft, /<img src=x/);
  assert.match(xThreadPreview({ ...base, title: 'x', url: 'https://x.com/a/status/1', content_html: null }, true, DOMParser), /댓글을 불러오지 못했어요/);
  const now = Date.parse('2026-11-03T12:00:00Z');
  assert.deepEqual(['2026-11-03T11:59:30Z', '2026-11-03T11:15:00Z', '2026-11-03T02:00:00Z', '2026-10-02T12:00:00Z', '2025-12-31T12:00:00Z'].map((value) => xTime(value, now)), ['방금', '45분', '10시간', '10월 2일', '2025년 12월 31일']);
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { XTimeline } = await vite.ssrLoadModule('/src/components/XTimeline.tsx');
  const previous = globalThis.DOMParser; globalThis.DOMParser = DOMParser;
  try {
    const html = renderToStaticMarkup(React.createElement(XTimeline, { articles: [{ ...base, id: 'r1', title: 'RT by @NASA: x', feed_title: 'NASA (@NASA)', url: 'https://x.com/NASAAdmin/status/1', content_html: '<p>&lt;script&gt;alert(1)&lt;/script&gt; hello</p>' }], selectedArticleId: null, onSelectArticle() {}, onToggleRead() {}, onToggleSaved() {}, isDark: true, listRef: { current: null } }));
    for (const text of ['sfeed-list-items sfeed-x-timeline', 'data-article-id="r1"', 'NASA 님이 재게시함', '@NASAAdmin', '&lt;script&gt;alert(1)&lt;/script&gt; hello', 'aria-label="댓글 보기"', 'aria-label="X에서 열기"', 'href="https://x.com/NASAAdmin/status/1"']) assert.ok(html.includes(text), text);
    assert.doesNotMatch(html, /<script/);
  } finally { globalThis.DOMParser = previous; }
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
  // 예전 글 채우기: 미러의 다음 쪽을 계정마다 기억하고, 새로고침 뒤에 한 쪽씩 받는다.
  const backfillNow = Date.now; Date.now = () => backfillNow() + 11 * 60_000;
  try {
    rssMode = 'paged';
    const { fetchAndParseFeed: fetchFeed } = await vite.ssrLoadModule('/src/server/rssParser.ts');
    const { upsertFeedAndArticles } = await vite.ssrLoadModule('/src/server/seedService.ts');
    const { refreshStoredFeeds } = await vite.ssrLoadModule('/src/server/feedLoader.ts');
    const { noteXFeed, backfillXFeeds } = await vite.ssrLoadModule('/src/server/xBackfill.ts');
    const first = await fetchFeed('@history');
    assert.equal(first.articles.length, 20); assert.equal(first.xOlder.cursor, 'cursor-25');
    const { feedId } = await upsertFeedAndArticles(db, first);
    const reader = (await db.prepare('SELECT id FROM users LIMIT 1').first()).id;
    await db.prepare('INSERT INTO subscriptions(id,user_id,feed_id,created_at) VALUES(?,?,?,?)').bind('sub-history', reader, feedId, new Date().toISOString()).run();
    await noteXFeed(db, feedId, first, 20);
    const row = () => db.prepare('SELECT cursor,pages,failures FROM x_backfill WHERE feed_id=?').bind(feedId).first();
    assert.deepEqual({ ...await row() }, { cursor: 'cursor-25', pages: 1, failures: 0 }, '처음 받은 계정은 다음 쪽 위치를 기억한다.');
    const count = async () => (await db.prepare('SELECT COUNT(*) AS n FROM articles WHERE feed_id=?').bind(feedId).first()).n;
    const readCount = async () => (await db.prepare('SELECT COUNT(*) AS n FROM article_states st JOIN articles a ON a.id=st.article_id WHERE a.feed_id=? AND st.is_read=1').bind(feedId).first()).n;
    pagedLimited = true; const callsBefore = rssCalls.length;
    assert.equal(await backfillXFeeds(db), 0); assert.equal(rssCalls.length, callsBefore + 1);
    assert.deepEqual({ ...await row() }, { cursor: 'cursor-25', pages: 1, failures: 0 }, '미러가 한도를 알리면 위치를 그대로 두고 그만 받는다.');
    pagedLimited = false; Date.now = () => backfillNow() + 22 * 60_000;
    assert.equal(await backfillXFeeds(db), 20); assert.deepEqual({ ...await row() }, { cursor: 'cursor-5', pages: 2, failures: 0 });
    assert.equal(await backfillXFeeds(db), 5); assert.deepEqual({ ...await row() }, { cursor: 'cursor-0', pages: 3, failures: 0 });
    assert.equal(await backfillXFeeds(db), 0); assert.deepEqual({ ...await row() }, { cursor: null, pages: 4, failures: 0 }, '빈 쪽이 오면 끝까지 받은 것이다.');
    const calls = rssCalls.length; await backfillXFeeds(db); assert.equal(rssCalls.length, calls, '다 받은 계정은 다시 부르지 않는다.');
    assert.equal(await count(), 45);
    assert.equal(await readCount(), 25, '뒤늦게 채운 예전 글은 읽은 글로 두고, 처음 받은 글은 그대로 둔다.');
    // 새로고침 사이에 25개가 올라오면 첫 쪽이 모두 새 글이다. 다음 쪽으로 이미 받은 글이 나올 때까지 채운다.
    historyNewest = 70; Date.now = () => backfillNow() + 40 * 60_000;
    await refreshStoredFeeds(env, [{ id: feedId, xml_url: 'https://x.com/history', builder_source_url: null, builder_selector: null, builder_title: null }]);
    assert.equal(await count(), 70, '빠진 글 다섯 개도 채운다.');
    assert.equal(await readCount(), 25, '빠진 구간의 글은 새 글이라 안 읽은 글로 둔다.');
    assert.deepEqual({ ...await row() }, { cursor: null, pages: 4, failures: 0 }, '빠진 글 채우기는 예전 글 위치를 바꾸지 않는다.');
  } finally { Date.now = backfillNow; rssMode = 'ok'; }
  console.log('PASS: owner-only encrypted persistent X setup, no secret disclosure or overwrite on invalid input, stored-key OAuth, PKCE/state/session checks, private account-bound tokens, paginated follows, explicit imports, public feed refresh/cache, per-provider cooldown with fallback and alias hosts, import waits on rate limits, one shared body view for every subscribed X account, safe X post copies with replies from mirror pages, profile-photo X icons, an X-style timeline for X folders, and paced backfill of older X posts with gap filling.');
} finally { globalThis.fetch = originalFetch; await vite.close(); }
