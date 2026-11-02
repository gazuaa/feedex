import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const originalFetch = globalThis.fetch, originals = new Map(['DOMParser', 'indexedDB', 'IDBKeyRange'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const originalTimeout = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout');
// Older WebKit has AbortController but no AbortSignal.timeout.
Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: undefined });
for (const [key, value] of Object.entries({ DOMParser, indexedDB, IDBKeyRange })) Object.defineProperty(globalThis, key, { configurable: true, value });
try {
  const { publicCoinDeskArticle, publicDeviceArticle, fetchPublicWebPage } = await vite.ssrLoadModule('/src/shared/publicWebPage.ts');
  const { ArticleResources } = await vite.ssrLoadModule('/src/client/articleResources.ts');
  const { sanitizePublicWebCopy, PublicWebCopyError, checkpointRetryDelays } = await vite.ssrLoadModule('/src/client/publicWebCopy.ts');
  // 보안 확인 뒤 다시 묻는 간격은 실제로는 몇 초지만, 테스트에서는 순서만 본다.
  checkpointRetryDelays.splice(0, Infinity, 5, 5, 5, 5);
  const { readContent, maintainDeviceCache } = await vite.ssrLoadModule('/src/client/deviceContent.ts');
  const url = 'https://www.coindesk.com/tech/2026/10/28/public-article';
  assert.equal(publicCoinDeskArticle(url + '?utm_source=feed&token=private#fragment'), url);
  // 분류 이름이 목록에 없던 기사(news-analysis)도 날짜가 붙은 기사 주소면 기기 경로를 쓴다.
  assert.equal(publicCoinDeskArticle('https://www.coindesk.com/news-analysis/2026/11/01/sherrod-browns-ohio-race'), 'https://www.coindesk.com/news-analysis/2026/11/01/sherrod-browns-ohio-race');
  for (const value of ['https://www.coindesk.com/markets/', 'https://www.coindesk.com/price/bitcoin', 'https://www.coindesk.com/es/markets/2026/10/28/public-article', 'https://coindesk.com.evil.test/tech/2026/10/28/public-article', 'https://www.coindesk.com/auth/login?token=secret', 'https://secret@www.coindesk.com/tech/2026/10/28/public-article', 'https://www.coindesk.com:8443/tech/2026/10/28/public-article', 'https://private.example.test/article', 'file:///etc/passwd']) assert.equal(publicCoinDeskArticle(value), null, value);
  let calls = [], external = 'redirected', serverCalls = 0, snapshotReady = false;
  const html = '<!doctype html><html><head><title>Public CoinDesk article</title><link rel="stylesheet" href="/site.css"><script>steal()</script><meta http-equiv="refresh" content="0;url=https://evil.test"></head><body><div style="height:280px"><div class="ad-container"><iframe src="https://ad.example.test"></iframe></div></div><header>CoinDesk</header><article><h1>Public CoinDesk article</h1><p>' + 'A real public article with its original layout. '.repeat(10) + '</p><a href="javascript:steal()">Bad link</a><img data-src="/photo.jpg" src="/blank.gif" onerror="steal()"><iframe src="https://evil.test"></iframe></article></body></html>';
  globalThis.fetch = async (target, options = {}) => {
    calls.push({ url: String(target), options });
    const headers = new Headers(options.headers), requested = String(target).replace('https://r.jina.ai/', '');
    const jsonHtml = (value, data = {}) => Response.json({ code: 200, data: { url: requested, html: value, ...data } });
    // A real renderer response: an intermediate publisher redirect is reported
    // as 422 only when the caller asserts status 200, despite usable final HTML.
    if (external === 'redirected' && new Headers(options.headers).has('X-Assert-Status-Code')) return Response.json({ message: 'Expected status code 200 but got 302' }, { status: 422 });
    if (external === 'limited') return new Response('Rate limited', { status: 429 });
    if (external === 'network') throw new TypeError('Load failed');
    if (external === 'json-missing-html') return Response.json({ code: 200, data: { url: requested, content: 'Text only' } });
    if (external === 'foreign-source') return jsonHtml(html, { url: 'https://private.example.test/account' });
    if (external === 'foreign-redirect') return jsonHtml(html, { finalUrl: 'https://www.coindesk.com/auth/login?token=secret' });
    if (external === 'recoverable' || external === 'recovery-still-challenged') {
      if (!headers.has('X-Return-Format')) {
        snapshotReady = true;
        return Response.json({ code: 200, data: { url: requested, title: 'Public CoinDesk article', content: 'The complete public article. '.repeat(30) } });
      }
      return jsonHtml(snapshotReady && external === 'recoverable' ? html : '<html><head><title>Vercel Security Checkpoint</title></head><body><main>We are verifying your browser.</main></body></html>');
    }
    if (external === 'challenge') return new Response(html.replace('Public CoinDesk article', 'Vercel Security Checkpoint'));
    if (external === 'challenge-until-fresh' && new Headers(options.headers).get('X-No-Cache') !== 'true') return new Response('<html><head><title>Vercel Security Checkpoint</title></head><body><main>We are verifying your browser.</main></body></html>');
    if (external === 'login') return new Response(html.replace('Public CoinDesk article', 'Sign in'));
    if (external === 'paywall') return new Response(html.replace('</head>', '<script type="application/ld+json">{"isAccessibleForFree":false}</script></head>'));
    if (external === 'text') return new Response('Title: Article\nMarkdown Content: not the original web page');
    if (external === 'large') return new Response('<html>' + 'x'.repeat(2_000_001) + '</html>');
    if (external === 'raw-html') return new Response(html);
    return jsonHtml(html, { httpStatus: external === 'redirected' ? 302 : 200 });
  };
  const server = async () => { serverCalls++; throw new Error('Server network blocked'); };
  const article = { id: 'coindesk', url: url + '?token=private', feed_id: 'coindesk' };
  const copy = await new ArticleResources('owner', () => true, server).web(article);
  assert.equal(calls.length, 1); assert.equal(serverCalls, 0, 'the public web copy is fetched and prepared on the device'); assert.equal(copy.url, url);
  assert.match(copy.html, /<header>CoinDesk<\/header>/); assert.match(copy.html, /stylesheet/); assert.match(copy.html, /real public article/); assert.match(copy.html, /https:\/\/www.coindesk.com\/photo.jpg/);
  assert.doesNotMatch(copy.html, /<script|<iframe|onerror=|javascript:|http-equiv|blank.gif|ad-container|height:280px/i);
  assert.ok(calls[0].url === 'https://r.jina.ai/' + url && !calls[0].url.includes('private'));
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(new Headers(calls[0].options.headers).get('Accept'), 'application/json', 'rendered HTML is read from the JSON envelope');
  assert.equal(new Headers(calls[0].options.headers).has('X-Assert-Status-Code'), false, 'an intermediate publisher redirect must not reject the final article');
  assert.ok(!('Cookie' in calls[0].options.headers) && !('Authorization' in calls[0].options.headers));
  calls = []; const reused = await new ArticleResources('owner', () => true, server).web(article);
  assert.match(reused.html, /real public article/); assert.ok(reused.html.includes(`href="${url}"`)); assert.equal(calls.length, 0); assert.equal(serverCalls, 0, 'reopening reuses the device cache without any server request');
  assert.equal(await readContent('other', 'web:coindesk'), undefined);
  for (const [failure, message] of [['challenge', /사이트의 보안 확인/], ['paywall', /구독 권한/], ['login', /로그인이 필요한/], ['text', /HTML 형식/], ['large', /너무 큽니다/], ['limited', /HTTP 429/], ['network', /연결하지 못했습니다/], ['json-missing-html', /HTML이 비어/], ['foreign-source', /요청한 기사/], ['foreign-redirect', /허용되지 않은/]]) {
    external = failure; const before = serverCalls;
    await assert.rejects(() => new ArticleResources('owner', () => true, server).web({ ...article, id: failure }), message, 'the device failure remains available when the server fallback also fails');
    assert.equal(await readContent('owner', 'web:' + failure), undefined, 'failed or restricted pages are never cached');
    // 이 사이트들은 서버 요청을 막으므로, 보안 확인으로 실패하면 서버 경로로 시간을 더 쓰지 않는다.
    if (failure === 'challenge') assert.equal(serverCalls, before, 'a checkpoint is not retried through the server, which these sites turn away');
  }
  const challenge = '<html><head><title>Vercel Security Checkpoint</title></head><body><main>We are verifying your browser.</main></body></html>';
  assert.throws(() => sanitizePublicWebCopy(challenge, url), error => error instanceof PublicWebCopyError && error.reason === 'challenge' && /보안 확인/.test(error.message));
  // 사용자가 연 글은 보안 확인 화면에서 바로 포기하지 않고, 캐시를 건너뛴 HTML을 다시 묻는다.
  external = 'challenge-until-fresh'; calls = [];
  const retried = new ArticleResources('owner', () => true, server), retryArticle = { ...article, id: 'fresh-retry' };
  assert.match((await retried.web(retryArticle)).html, /real public article/, 'an opened article asks again after a checkpoint instead of failing');
  assert.equal(new Headers(calls[0].options.headers).get('X-No-Cache'), null);
  assert.equal(new Headers(calls.at(-1).options.headers).get('X-No-Cache'), 'true', 'a retry after a checkpoint requests a fresh external copy');
  // 끝내 실패한 글을 다시 열면 첫 요청부터 새 사본을 묻는다.
  external = 'challenge'; const reopened = new ArticleResources('owner', () => true, server), reopenArticle = { ...article, id: 'fresh-reopen' };
  await assert.rejects(() => reopened.web(reopenArticle), /사이트의 보안 확인/);
  external = 'challenge-until-fresh'; calls = [];
  assert.match((await reopened.web(reopenArticle)).html, /real public article/);
  assert.equal(calls.length, 1); assert.equal(new Headers(calls[0].options.headers).get('X-No-Cache'), 'true', 'reopening after a checkpoint asks for a fresh copy first');
  // 미리 받기는 보안 확인에서 한 번만 묻는다. 그사이 사용자가 열면 기다렸다가 끈기 있게 다시 받는다.
  external = 'challenge-until-fresh'; calls = [];
  const warming = new ArticleResources('owner', () => true, server), warmArticle = { ...article, id: 'warm-then-open' };
  const warm = warming.web(warmArticle, true), opened = warming.web(warmArticle);
  await assert.rejects(() => warm, /사이트의 보안 확인/);
  assert.match((await opened).html, /real public article/, 'opening an article that failed to preload still loads it');
  assert.equal(calls.length, 2, 'a preload asks once, and the open retries with a fresh copy');
  assert.equal(new Headers(calls[1].options.headers).get('X-No-Cache'), 'true');
  external = 'recoverable'; snapshotReady = false; calls = [];
  const beforeRecovery = serverCalls;
  const recovered = await new ArticleResources('owner', () => true, server).web({ ...article, id: 'automatic-recovery' });
  assert.match(recovered.html, /real public article/); assert.match(recovered.html, /stylesheet/);
  assert.equal(calls.length, 3, 'a checkpoint is followed by content preparation and another HTML request');
  assert.equal(new Headers(calls[1].options.headers).has('X-Return-Format'), false);
  assert.equal(new Headers(calls[1].options.headers).has('X-Timeout'), false);
  assert.equal(new Headers(calls[2].options.headers).get('X-Return-Format'), 'html');
  assert.equal(serverCalls, beforeRecovery, 'successful device recovery needs no server rendering');
  calls = [];
  assert.match((await new ArticleResources('owner', () => true, server).web({ ...article, id: 'automatic-recovery' })).html, /real public article/);
  assert.equal(calls.length, 0, 'recovered HTML is cached on the device');
  external = 'recovery-still-challenged'; snapshotReady = false; calls = [];
  await assert.rejects(() => new ArticleResources('owner', () => true, server).web({ ...article, id: 'recovery-failure' }), /사이트의 보안 확인/);
  assert.equal(calls.length, 2 + checkpointRetryDelays.length, 'recovery asks again only a bounded number of times'); assert.equal(await readContent('owner', 'web:recovery-failure'), undefined);
  external = 'raw-html';
  assert.match((await fetchPublicWebPage(url)).html, /Public CoinDesk article/, 'raw HTML remains compatible');
  external = 'paywall'; let restrictedFallbacks = 0;
  await assert.rejects(() => new ArticleResources('owner', () => true, async () => { restrictedFallbacks++; return { html, url }; }).web({ ...article, id: 'restricted-no-fallback' }), /구독 권한/);
  assert.equal(restrictedFallbacks, 0, 'an explicit access restriction is not retried through another extraction path');
  calls = [];
  const normalServer = async () => ({ html: '<html>Normal server copy</html>', url: 'https://other.example.test/article' });
  external = 'limited';
  const fallback = await new ArticleResources('owner', () => true, normalServer).web({ ...article, id: 'server-fallback' });
  assert.match(fallback.html, /Normal server copy/, 'a successful server fallback still displays');
  calls = [];
  await new ArticleResources('owner', () => true, normalServer).web({ id: 'other-publisher', url: 'https://other.example.test/article' });
  assert.equal(calls.length, 0, 'other publishers and account URLs are never sent to the external renderer');
  assert.equal(await fetchPublicWebPage('https://www.coindesk.com/auth/login'), null);
  // The Block turns servers away with a Cloudflare check; its public articles take the same device path.
  const block = 'https://www.theblock.co/news/business/2026-10-29-utah-criminal-charges-kalshi-432104';
  assert.equal(publicDeviceArticle(block + '?utm_source=rss&token=private#top'), block);
  assert.equal(publicDeviceArticle('https://theblock.co/post/123456/older-article'), 'https://www.theblock.co/post/123456/older-article');
  assert.equal(publicCoinDeskArticle(block), null, 'the CoinDesk check stays CoinDesk only');
  for (const value of ['https://www.theblock.co/', 'https://www.theblock.co/login?next=/news', 'https://www.theblock.co/data/crypto-markets', 'https://www.theblock.co.evil.test/news/business/2026-10-29-a-1', 'https://user@www.theblock.co/news/business/2026-10-29-a-1', 'https://www.theblock.co:8443/news/business/2026-10-29-a-1']) assert.equal(publicDeviceArticle(value), null, value);
  calls = []; external = 'ok';
  const blockCopy = await new ArticleResources('owner', () => true, server).web({ id: 'theblock', url: block + '?utm_source=rss', feed_id: 'theblock' });
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://r.jina.ai/' + block); assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(blockCopy.url, block); assert.match(blockCopy.html, /real public article/);
  assert.throws(() => sanitizePublicWebCopy('<html><head><title>Sign in</title></head><body><main>Login</main></body></html>', url));
  await maintainDeviceCache('owner', true);
  console.log('PASS: JSON and raw public HTML; any dated CoinDesk section; an opened article asks again after a checkpoint with content preparation and fresh HTML, a bounded number of times, without the server path; preloads ask once and an open after a failed preload retries; local reuse, source/redirect restrictions and no caching of challenges/paywalls/errors.');
} finally {
  globalThis.fetch = originalFetch;
  if (originalTimeout) Object.defineProperty(AbortSignal, 'timeout', originalTimeout); else delete AbortSignal.timeout;
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  await vite.close();
}
