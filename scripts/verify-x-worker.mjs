import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, Response as WorkerResponse, Log, LogLevel } from 'miniflare';

// fetch 자체는 바꾸지 않는다. 실제 운영 엔진이 요청 옵션을 검증하고, 외부 응답만 가짜로 돌려준다.
const bundled = await build({
  stdin: { contents: `
    import { Hono } from 'hono';
    import { xRoutes } from './src/server/xConnection';
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('user', { id: 'worker-user', email: 'worker@example.test' }); await next(); });
    app.route('/api/x', xRoutes);
    export default { fetch: (request, env) => app.fetch(request, env) };
  `, resolveDir: process.cwd(), sourcefile: 'x-worker-check.ts', loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent',
});
let mode = 'success';
const calls = [];
const json = (body) => new WorkerResponse(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const worker = new Miniflare({
  modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2025-06-01', compatibilityFlags: ['nodejs_compat'], log: new Log(LogLevel.ERROR),
  bindings: { X_CLIENT_ID: 'worker-client-id', X_CLIENT_SECRET: 'worker-client-secret' },
  outboundService: async (request) => {
    const url = new URL(request.url);
    calls.push({ origin: url.origin, path: url.pathname, query: url.searchParams, method: request.method, auth: request.headers.get('authorization'), body: await request.text() });
    assert.equal(url.origin, 'https://api.x.com', '다른 호스트로 인증정보를 보내지 않는다.');
    if (mode === 'redirect') return new WorkerResponse('', { status: 302, headers: { location: 'https://unexpected.example.test/token' } });
    if (mode === 'malformed') return new WorkerResponse('<html>Upstream error</html>');
    if (mode === 'limited') return new WorkerResponse('not logged', { status: 429 });
    if (url.pathname === '/2/oauth2/token') return json({ access_token: 'worker-private-token', expires_in: 7200, scope: 'tweet.read users.read follows.read' });
    if (url.pathname === '/2/users/me') return json({ data: { id: '123', username: 'reader' } });
    assert.equal(url.pathname, '/2/users/123/following');
    return json({ data: [{ id: '9', name: 'NASA', username: 'NASA' }], meta: { result_count: 1 } });
  },
});
const post = (path, body) => worker.dispatchFetch(`https://sfeed.test/api/x/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const payload = { code: 'worker-approval-code', verifier: 'v'.repeat(64) };
try {
  const connected = await post('connect', payload);
  const result = await connected.json();
  assert.equal(connected.status, 200, JSON.stringify(result));
  assert.equal(calls[0].auth, 'Basic ' + Buffer.from('worker-client-id:worker-client-secret').toString('base64'));
  const form = new URLSearchParams(calls[0].body);
  assert.equal(form.get('code_verifier'), payload.verifier); assert.equal(form.get('redirect_uri'), 'https://sfeed.test/?x_callback=1');
  assert.equal(result.username, 'reader'); assert.ok(!JSON.stringify(result).includes('worker-private-token'));
  const following = await post('following', { connection: result.connection });
  assert.equal(following.status, 200); assert.equal((await following.json()).accounts[0].username, 'NASA');
  assert.equal(calls[1].auth, 'Bearer worker-private-token'); assert.equal(calls[2].auth, 'Bearer worker-private-token');
  assert.equal(calls[2].query.get('max_results'), '1000');

  // 인증정보가 다른 호스트로 넘어가지 않도록 3xx를 따르지 않고 오류로 표시한다.
  mode = 'redirect'; const beforeRedirect = calls.length;
  const redirected = await post('connect', payload);
  assert.equal(redirected.status, 502); assert.match((await redirected.json()).error, /이동|주소/);
  assert.equal(calls.length, beforeRedirect + 1); assert.ok(calls.every((call) => call.origin === 'https://api.x.com'));

  mode = 'malformed';
  const malformed = await post('connect', payload);
  assert.equal(malformed.status, 502); assert.match((await malformed.json()).error, /응답 형식/);

  mode = 'limited'; const beforeLimit = calls.length;
  const limited = await post('connect', payload);
  assert.equal(limited.status, 429); assert.match((await limited.json()).error, /요청 한도/);
  assert.equal(calls.length, beforeLimit + 1, '요청 제한 뒤 자동으로 재시도하지 않는다.');
  console.log('PASS: the real Workers engine completes X token/profile/following requests, blocks redirects and distinguishes invalid responses and rate limits without real credentials or X API calls.');
} finally { await worker.dispose(); }
