import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { createServer } from 'vite';

const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
assert.equal(manifest.short_name, 'FeedEx');
assert.ok(manifest.name.startsWith('FeedEx'));
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, '/');
assert.equal(manifest.id, '/');
for (const icon of [...manifest.icons, { src: '/icons/apple-touch-icon.png', sizes: '180x180' }]) {
  const bytes = readFileSync('public' + icon.src);
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  assert.equal(bytes.readUInt32BE(16) + 'x' + bytes.readUInt32BE(20), icon.sizes);
}
const html = readFileSync('dist/index.html', 'utf8');
assert.match(html, /rel="manifest" href="\/manifest.webmanifest"/);
assert.match(html, /viewport-fit=cover/);
assert.match(html, /apple-mobile-web-app-capable/);
assert.match(html, /name="apple-mobile-web-app-status-bar-style" content="default"/);
assert.ok(!html.includes('content="black-translucent"'), 'avoid the iOS standalone viewport offset that leaves an unreachable bottom strip');
assert.ok(html.indexOf('class="feedex-glass-sample"') < html.indexOf('id="root"'), 'the opaque edge must exist outside React before the app mounts');
const handlers = {}, storage = new Map(), deleted = [], fetched = [];
const messages = [], focused = [], opened = [];
let clientWindows = [];
const cache = { addAll: async (paths) => { for (const path of paths) { assert.ok(existsSync('public' + path)); storage.set(path, new Response(readFileSync('public' + path))); } }, match: async (path) => storage.get(path)?.clone() };
let offline = false, skipped = 0, claimed = 0;
vm.runInNewContext(readFileSync('public/sw.js', 'utf8'), {
  self: { location: { origin: 'https://sfeed.test' }, addEventListener: (key, handler) => { handlers[key] = handler; }, skipWaiting: async () => { skipped++; }, clients: { claim: async () => { claimed++; }, matchAll: async () => clientWindows, openWindow: async (url) => opened.push(url) } },
  caches: { open: async () => cache, keys: async () => ['sfeed-public-v1', 'sfeed-public-v2', 'sfeed-public-v3', 'sfeed-public-v4', 'another-app-cache'], delete: async (key) => { deleted.push(key); } },
  fetch: async (request) => { fetched.push(request.url); if (offline) throw new Error('offline'); return new Response('fresh network page'); },
  URL, Response,
});
for (const name of ['install', 'activate']) { let work; handlers[name]({ waitUntil: (promise) => { work = promise; } }); await work; }
assert.equal(skipped, 1); assert.equal(claimed, 1); assert.deepEqual(deleted, ['sfeed-public-v1', 'sfeed-public-v2', 'sfeed-public-v3']);
assert.ok(!storage.has('/'), 'the authenticated app shell must not be cached');
const runFetch = (path, mode = 'navigate', method = 'GET') => {
  let result;
  handlers.fetch({ request: { url: new URL(path, 'https://sfeed.test').href, method, mode }, respondWith: (promise) => { result = promise; } });
  return result;
};
assert.equal(await (await runFetch('/?session_token=private')).text(), 'fresh network page');
assert.equal(storage.size, 7, 'navigation must not write to the public cache');
for (const path of ['/api/articles', '/api/auth/google/credential', '/auth/callback', 'https://accounts.google.com/gsi/client']) assert.equal(runFetch(path), undefined, 'auth/API/cross-origin requests must not be intercepted');
assert.equal(runFetch('/anything', 'navigate', 'POST'), undefined);
assert.equal(runFetch('/assets/app.js', 'cors'), undefined, 'do not hold an old app bundle in a service worker');
offline = true;
assert.match(await (await runFetch('/')).text(), /인터넷 연결을 기다리고 있어요/);
assert.ok(![...storage.keys()].some((path) => path.includes('session_token')));
assert.equal(runFetch('/api/articles'), undefined, 'offline must not masquerade as a successful article response');
assert.equal((await runFetch('/icons/icon-192.png', 'cors')).status, 200);
assert.equal(handlers.push, undefined, 'local detection must not introduce server push');
const clickNotification = async (data) => {
  let work, closed = false;
  handlers.notificationclick({ notification: { data, close: () => { closed = true; } }, waitUntil: (promise) => { work = promise; } });
  await work; assert.equal(closed, true);
};
clientWindows = [
  { url: 'https://sfeed.test/privacy', postMessage: () => assert.fail('privacy page is not the reader'), focus: () => assert.fail('privacy page is not the reader') },
  { url: 'https://sfeed.test/', postMessage: (data) => messages.push(data), focus: async () => focused.push(true) },
];
await clickNotification({ articleId: 'new-article', account: 'owner' });
assert.equal(messages[0].type, 'sfeed-open-article'); assert.equal(messages[0].account, 'owner'); assert.equal(focused.length, 1);
clientWindows = []; await clickNotification({ articleId: 'new-article', account: 'owner' });
assert.equal(opened[0], 'https://sfeed.test/?article_id=new-article&account=owner');
await clickNotification({ articleId: 'incomplete' }); assert.equal(opened.length, 1, 'notification navigation requires the matching account');

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
try {
  const { default: worker } = await vite.ssrLoadModule('/src/worker.ts');
  const redirected = await worker.fetch(new Request('https://sfeed.jyk.workers.dev/privacy?from=old'), { ASSETS: { fetch: async () => new Response('asset') } }, {});
  assert.equal(redirected.status, 308);
  assert.equal(redirected.headers.get('location'), 'https://feedex.jyk.workers.dev/privacy?from=old');
  const legacyAsset = await worker.fetch(new Request('https://sfeed.jyk.workers.dev/page-asset/invalid?u=http%3A%2F%2Fimage.rhythmer.net%2Fcss%2Fcommon.css'), {}, {});
  assert.equal(legacyAsset.status, 403, 'legacy signed page-asset URLs are served directly on the legacy worker instead of redirecting to another worker secret');
  for (const path of ['/', '/sw.js', '/manifest.webmanifest', '/offline.js', '/downloads/appcast.xml']) {
    const response = await worker.fetch(new Request('https://sfeed.test' + path), { ASSETS: { fetch: async () => new Response('asset') } }, {});
    assert.equal(response.headers.get('cache-control'), 'no-store');
    if (path === '/sw.js') assert.equal(response.headers.get('service-worker-allowed'), '/');
  }
  for (const path of ['/assets/index-Abc12345.js', '/assets/index-Abc12345.css']) {
    const response = await worker.fetch(new Request('https://sfeed.test' + path), { ASSETS: { fetch: async () => new Response('asset', { headers: { 'Content-Type': path.endsWith('.css') ? 'text/css' : 'text/javascript' } }) } }, {});
    assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  }
  const missing = await worker.fetch(new Request('https://sfeed.test/assets/index-Abc12345.js'), { ASSETS: { fetch: async () => new Response('missing', { status: 404 }) } }, {});
  assert.equal(missing.headers.get('cache-control'), null, 'missing assets must not be cached for a year');
  const fallback = await worker.fetch(new Request('https://sfeed.test/assets/missing-Abc12345.js'), { ASSETS: { fetch: async () => new Response('app shell', { headers: { 'Content-Type': 'text/html' } }) } }, {});
  assert.equal(fallback.headers.get('cache-control'), null, 'a SPA fallback is not an immutable JavaScript asset');
  const fakeWindow = new EventTarget();
  fakeWindow.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.window = fakeWindow;
  const { installState, promptInstall, installPlatform, installAddress, isIOSSafari, openInSafari, openInstallHelp } = await vite.ssrLoadModule('/src/client/pwa.ts');
  assert.equal(installPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Brave/1.86 Mobile/15E148 Safari/604.1'), 'ios');
  assert.equal(installPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/26.0 Safari/605.1.15', 5), 'ios', 'iPad desktop user agent must use iOS instructions');
  assert.equal(installPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/26.0 Safari/605.1.15', 0), 'mac-safari');
  assert.equal(installPlatform('Mozilla/5.0 (Linux; Android 16) Chrome/145 Brave/1.86'), 'android');
  assert.equal(installAddress('https://sfeed.test/auth/callback?session_token=private#secret'), 'https://sfeed.test/', 'browser handoff must not include a token or a private route');
  const safariUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1';
  for (const [browser, expected] of [
    [{ userAgent: safariUA, standalone: false }, true],
    [{ userAgent: safariUA, standalone: false, brave: {} }, false],
    [{ userAgent: safariUA }, false],
    [{ userAgent: safariUA.replace('Version/26.0', 'CriOS/144'), standalone: false }, false],
    [{ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/26.0 Safari/605.1.15', maxTouchPoints: 5, standalone: false }, true],
    [{ userAgent: 'Mozilla/5.0 (Linux; Android 16) Chrome/145', standalone: false }, false],
  ]) assert.equal(isIOSSafari(browser), expected);
  const descriptors = ['window', 'document', 'navigator', 'setTimeout', 'clearTimeout'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  try {
    for (const mode of ['copied', 'blocked-copy', 'no-clipboard', 'pagehide', 'visibilitychange', 'navigation-throws', 'cancel']) {
      const order = [], fallback = [], timers = new Map();
      const win = new EventTarget(), doc = new EventTarget();
      Object.defineProperty(win, 'location', { value: {
        get href() { return 'https://sfeed.test/auth/callback?session_token=private#secret'; },
        set href(value) { order.push(['navigate', value]); if (mode === 'navigation-throws') throw new Error('unsupported'); },
      } });
      const nav = { userAgent: safariUA, brave: {}, clipboard: mode === 'no-clipboard' ? undefined : { writeText(address) { order.push(['copy', address]); return mode === 'blocked-copy' ? Promise.reject(new Error('blocked')) : Promise.resolve(); } } };
      Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
      Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: nav });
      globalThis.setTimeout = (fn, delay) => { assert.equal(delay, 1400); timers.set(1, fn); return 1; };
      globalThis.clearTimeout = (id) => timers.delete(id);
      const cancel = openInSafari((copied) => fallback.push(copied));
      await Promise.resolve(); await Promise.resolve();
      assert.deepEqual(order.at(-1), ['navigate', 'x-safari-https://sfeed.test/']);
      if (mode !== 'no-clipboard') assert.deepEqual(order[0], ['copy', 'https://sfeed.test/'], 'copy must start before synchronously handing off the tap');
      if (mode === 'pagehide') win.dispatchEvent(new Event('pagehide'));
      if (mode === 'visibilitychange') doc.dispatchEvent(new Event('visibilitychange'));
      if (mode === 'cancel') cancel();
      for (const run of [...timers.values()]) run();
      assert.deepEqual(fallback, ['pagehide', 'visibilitychange', 'cancel'].includes(mode) ? [] : [!['blocked-copy', 'no-clipboard'].includes(mode)]);
    }
    // 실제 설치 버튼은 iOS Brave에서는 Safari로, Safari에서는 도움말로 보낸다.
    const win = new EventTarget(); let target = '';
    win.location = { get href() { return 'https://sfeed.test/'; }, set href(value) { target = value; } };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: new EventTarget() });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: safariUA, brave: {} } });
    openInstallHelp(); assert.equal(target, 'x-safari-https://sfeed.test/');
    let help = 0; win.addEventListener('sfeed:install', () => help++);
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: safariUA, standalone: false } });
    openInstallHelp(); assert.equal(help, 1);
  } finally {
    for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  }
  assert.equal(installState(), 'manual');
  assert.equal(await promptInstall(), false);
  let prompts = 0;
  const event = new Event('beforeinstallprompt', { cancelable: true });
  event.prompt = async () => { prompts++; };
  event.userChoice = Promise.resolve({ outcome: 'dismissed' });
  fakeWindow.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(prompts, 0, 'native prompts require a user click');
  assert.equal(installState(), 'prompt');
  assert.equal(await promptInstall(), true);
  assert.equal(prompts, 1);
  assert.equal(installState(), 'manual');
  assert.equal(await promptInstall(), false, 'a browser prompt can only be used once');
  fakeWindow.dispatchEvent(new Event('appinstalled'));
  assert.equal(installState(), 'installed');
  delete globalThis.window;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createElement } = await import('react');
  const { PwaInstall, InstallAppButton } = await vite.ssrLoadModule('/src/components/PwaInstall.tsx');
  const previousAgent = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
  try {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/144 Mobile/15E148 Safari/604.1' });
    const iosHelp = renderToStaticMarkup(createElement(PwaInstall));
    assert.match(iosHelp, /홈 화면에 추가/);
    assert.match(iosHelp, /웹 앱으로 열기/);
    assert.match(iosHelp, /주소 복사/);
    assert.match(iosHelp, /Safari에서 열 주소/);
    assert.ok(!iosHelp.includes('지금 설치'), 'iOS must show manual steps instead of a nonexistent native install prompt');
    assert.ok(!iosHelp.includes('이 브라우저에는'), 'modern iOS browsers must not be incorrectly told they cannot install');
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Brave/1.86 Mobile/15E148 Safari/604.1' });
    const braveHelp = renderToStaticMarkup(createElement(PwaInstall));
    assert.match(braveHelp, /Safari로 열기/);
    assert.match(braveHelp, /Safari에서 열어 주세요/);
    assert.match(renderToStaticMarkup(createElement(InstallAppButton)), /Safari로 열기/);
    assert.ok(!braveHelp.includes('Chrome·Edge의 주소창'), 'iOS Brave must not get desktop install instructions');
  } finally { if (previousAgent) Object.defineProperty(navigator, 'userAgent', previousAgent); else delete navigator.userAgent; }
  // 열어 둔 탭·홈 화면 앱은 다시 나타날 때 새 배포를 확인하고, 읽던 자리를 남긴 뒤 새로 고친다.
  const { shellBundle, runningBundle, shellVersion, runningVersion, watchAppVersion, AppVersionWatch, keepResumePoint, takeResumePoint } = await vite.ssrLoadModule('/src/client/appVersion.ts');
  const built = readFileSync('dist/index.html', 'utf8'), builtBundle = shellBundle(built);
  assert.match(builtBundle, /^\/assets\/index-[\w-]+\.js$/, 'the built shell names its entry bundle');
  assert.equal(shellBundle('<script type="module" src="/src/main.tsx"></script>'), null, 'the dev server has no bundle to compare');
  assert.equal(shellBundle('<script src="https://accounts.google.com/gsi/client" async></script><script type="module" crossorigin src="/assets/index-NEW.js"></script>'), '/assets/index-NEW.js');
  assert.equal(runningBundle({ querySelectorAll: () => [{ getAttribute: () => '/assets/index-OLD.js' }] }), '/assets/index-OLD.js');
  const memory = () => { const values = new Map(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) }; };
  const versionCase = (shell, overrides = {}) => {
    const log = { shells: 0, swaps: 0, kept: 0 }; let clock = 1_000_000, swappable = true;
    const storage = overrides.storage ?? memory();
    const watch = new AppVersionWatch({ current: '/assets/index-OLD.js', storage, now: () => clock, canSwap: () => swappable,
      loadShell: async () => { log.shells++; if (shell instanceof Error) throw shell; return shell; },
      beforeSwap: () => log.kept++, reload: () => log.swaps++ });
    return { watch, log, storage, advance: (ms) => { clock += ms; }, setSwappable: (value) => { swappable = value; } };
  };
  const same = versionCase('<script type="module" src="/assets/index-OLD.js"></script>');
  await same.watch.check(); await same.watch.check();
  assert.deepEqual(same.log, { shells: 1, swaps: 0, kept: 0 }, 'an unchanged deploy is asked about at most once a minute and never reloads');
  same.advance(61_000); await same.watch.check(); assert.equal(same.log.shells, 2);
  const offlineShell = versionCase(new Error('offline')); await offlineShell.watch.check();
  assert.deepEqual(offlineShell.log, { shells: 1, swaps: 0, kept: 0 }, 'no connection leaves the running app alone');
  const fresh = versionCase('<script type="module" crossorigin src="/assets/index-NEW.js"></script>');
  fresh.setSwappable(false); await fresh.watch.check();
  assert.deepEqual(fresh.log, { shells: 1, swaps: 0, kept: 0 }, 'typing, a dialog or a pending save postpones the swap');
  fresh.setSwappable(true); await fresh.watch.check();
  assert.deepEqual(fresh.log, { shells: 1, swaps: 1, kept: 1 }, 'the postponed swap happens on the next appearance without asking again, after keeping the place');
  const repeat = versionCase('<script type="module" src="/assets/index-NEW.js"></script>', { storage: fresh.storage });
  await repeat.watch.check();
  assert.equal(repeat.log.swaps, 0, 'if the reload still came back old (deploy spreading), it does not loop');
  repeat.advance(11 * 60_000); await repeat.watch.check(); assert.equal(repeat.log.swaps, 1, 'it tries again after a while');
  const oldShell = '<script type="module" src="/assets/index-OLD.js"></script><link rel="stylesheet" href="/assets/index-OLD.css">';
  const newStyle = oldShell.replace('index-OLD.css', 'index-NEW.css');
  assert.notEqual(shellVersion(oldShell), shellVersion(newStyle), 'a style-only release is an app update too');
  const stylesOnly = new AppVersionWatch({ current: shellVersion(oldShell), loadShell: async () => newStyle, storage: memory(), canSwap: () => true, beforeSwap() {}, reload() { styleSwaps++; } });
  let styleSwaps = 0;
  await stylesOnly.check(); assert.equal(styleSwaps, 1);

  // 실제 감시 연결: 앱을 계속 열어 둬도 확인하며, 숨김·입력·종료 뒤 응답은 새로고침하지 않는다.
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousWindow = globalThis.window, previousFetch = globalThis.fetch, previousNow = Date.now;
  try {
    const win = new EventTarget(), doc = new EventTarget(), timers = new Map();
    let clock = 10_000_000, shell = oldShell, reads = 0, swaps = 0, kept = 0, busy = false, load;
    Date.now = () => clock;
    win.sessionStorage = memory(); win.location = { reload: () => swaps++ };
    win.setInterval = (tick, delay) => { assert.equal(delay, 60_000); timers.set(1, tick); return 1; };
    win.clearInterval = (id) => timers.delete(id);
    doc.visibilityState = 'visible';
    doc.querySelectorAll = (selector) => selector.startsWith('script') ? [{ getAttribute: () => '/assets/index-OLD.js' }] : [{ getAttribute: () => '/assets/index-OLD.css' }];
    Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
    globalThis.window = win;
    globalThis.fetch = async (_url, options) => { assert.equal(options.cache, 'no-store'); reads++; if (load) return load(); return { ok: true, text: async () => shell }; };
    const flush = () => new Promise((resolve) => setImmediate(resolve));
    assert.equal(runningVersion(doc), shellVersion(oldShell));
    const stop = watchAppVersion({ canSwap: () => !busy, beforeSwap: () => kept++ });
    await flush(); assert.equal(reads, 1, 'startup checks once');
    win.dispatchEvent(new Event('focus')); await flush(); assert.equal(reads, 1, 'quick focus changes do not add requests');
    doc.visibilityState = 'hidden'; clock += 61_000; timers.get(1)(); await flush(); assert.equal(reads, 1, 'background apps do not poll');
    doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange')); await flush(); assert.equal(reads, 2);
    shell = newStyle; busy = true; clock += 61_000; timers.get(1)(); await flush();
    assert.equal(reads, 3); assert.equal(swaps, 0, 'typing postpones a periodic update');
    busy = false; doc.dispatchEvent(new Event('focusout')); await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(swaps, 1); assert.equal(kept, 1, 'finishing input saves the reading place then reloads');
    assert.equal(reads, 3, 'the deferred update reuses the detected version');
    stop(); assert.equal(timers.size, 0, 'unmount removes the timer');
    clock += 61_000; win.dispatchEvent(new Event('online')); doc.dispatchEvent(new Event('visibilitychange')); await flush(); assert.equal(reads, 3, 'unmount removes event listeners too');
    // 요청 중 앱이 종료되거나 가려져도 늦은 응답이 새로고침을 일으키지 않는다.
    win.sessionStorage = memory(); let finish;
    load = () => new Promise((resolve) => { finish = resolve; });
    const close = watchAppVersion({ canSwap: () => true, beforeSwap: () => kept++ });
    await flush(); close(); finish({ ok: true, text: async () => newStyle }); await flush();
    assert.equal(swaps, 1, 'a late response after cleanup cannot reload the app');
    win.sessionStorage = memory(); clock += 61_000;
    const hide = watchAppVersion({ canSwap: () => true, beforeSwap: () => kept++ });
    await flush(); doc.visibilityState = 'hidden'; finish({ ok: true, text: async () => newStyle }); await flush();
    assert.equal(swaps, 1, 'a response received in the background waits');
    hide();
  } finally {
    Date.now = previousNow; globalThis.fetch = previousFetch; globalThis.window = previousWindow;
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document;
  }
  const place = memory(), now = 5_000_000;
  const point = { account: 'reader', at: now, scope: 'feed', folderId: null, feedId: 'feed-1', search: 'bitcoin', saved: false, articleId: 'art-1', listScroll: 640, readerScroll: 1200 };
  keepResumePoint(point, place);
  assert.equal(takeResumePoint('someone-else', now + 1000, place), null, 'another account never gets the place');
  keepResumePoint(point, place);
  assert.deepEqual(takeResumePoint('reader', now + 3000, place), point);
  assert.equal(takeResumePoint('reader', now + 3000, place), null, 'the place is used once');
  keepResumePoint(point, place); assert.equal(takeResumePoint('reader', now + 3 * 60_000, place), null, 'an old place is ignored');
  keepResumePoint({ ...point, scope: 'admin', articleId: { id: 1 } }, place); assert.equal(takeResumePoint('reader', now + 1000, place), null, 'malformed places are ignored');
  keepResumePoint({ ...point, listScroll: -5, readerScroll: 'x' }, place);
  assert.deepEqual(takeResumePoint('reader', now + 1000, place), { ...point, listScroll: 0, readerScroll: 0 });
  console.log('PASS: install manifest, iPhone/iPad browser detection, Safari handoff before losing the tap, copy/navigation failures and fallback, native prompt lifecycle, visible Mac/web apps polling for code/style releases, safe deferred reload and scheduler cleanup while keeping the reading place, safe public-only offline caching and deployment headers.');
} finally { delete globalThis.window; await vite.close(); }
