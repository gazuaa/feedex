import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DOMParser } from 'linkedom';
import { createServer } from 'vite';

// 맥 앱(FeedEx for Mac): 시스템 로그인 창에서 받은 일회용 코드로 로그인하고, 웹 보기 자리에 원문 화면을 겹친다.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const previous = { webkit: Object.getOwnPropertyDescriptor(globalThis, 'webkit'), DOMParser: Object.getOwnPropertyDescriptor(globalThis, 'DOMParser'), window: Object.getOwnPropertyDescriptor(globalThis, 'window') };
try {
  // 서버: 로그인한 사람만 코드를 받고, 코드는 API에 쓰지 못하며, 한 번만 1분 안에 새 세션으로 바꿀 수 있다.
  const { app } = await vite.ssrLoadModule('/src/server/app.ts');
  const { LocalD1Database } = await vite.ssrLoadModule('/src/server/localD1.ts');
  const db = new LocalD1Database(':memory:', 'migrations/0001_schema.sql'), env = { DB: db, ALLOW_QUICK_LOGIN: 'true' };
  const call = (path, { token, body } = {}) => app.request(path, { method: body === undefined && !path.includes('native-code') ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  const owner = await (await call('/api/auth/google/quick', { body: { email: 'mac-owner@example.test' } })).json();
  assert.equal((await call('/api/user/native-code')).status, 401, 'only a signed-in person gets a code');
  const issued = await call('/api/user/native-code', { token: owner.token });
  assert.equal(issued.status, 200);
  const { code } = await issued.json();
  assert.match(code, /^sfeed_code_[0-9a-f]{64}$/);
  const stored = await db.prepare('SELECT expires_at, created_at FROM sessions WHERE token = ?').bind(code).first();
  assert.ok(Date.parse(stored.expires_at) - Date.parse(stored.created_at) <= 60_000, 'a code lives for one minute');
  assert.equal((await call('/api/user/me', { token: code })).status, 401, 'a code never works as a session, so it cannot be stretched to a year');
  assert.equal((await call('/api/auth/native-code/redeem', { body: { code: 'sfeed_code_short' } })).status, 400);
  const redeemed = await call('/api/auth/native-code/redeem', { body: { code } });
  assert.equal(redeemed.status, 200);
  const session = await redeemed.json();
  assert.equal(session.user.email, 'mac-owner@example.test');
  assert.notEqual(session.token, owner.token, 'the Mac app gets its own session');
  assert.equal((await call('/api/user/me', { token: session.token })).status, 200);
  assert.equal((await call('/api/auth/native-code/redeem', { body: { code } })).status, 401, 'a code works once');
  // 같은 코드를 동시에 두 번 바꿔도 하나만 성공한다.
  const { code: raced } = await (await call('/api/user/native-code', { token: owner.token })).json();
  const both = await Promise.all([call('/api/auth/native-code/redeem', { body: { code: raced } }), call('/api/auth/native-code/redeem', { body: { code: raced } })]);
  assert.deepEqual(both.map((response) => response.status).sort(), [200, 401], 'two redeems at once yield one session');
  const old = `sfeed_code_${'a'.repeat(64)}`;
  await db.prepare('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').bind(old, owner.user.id, new Date(Date.now() - 1000).toISOString(), new Date(Date.now() - 61_000).toISOString()).run();
  assert.equal((await call('/api/auth/native-code/redeem', { body: { code: old } })).status, 401, 'an expired code is refused');
  await call('/api/user/native-code', { token: owner.token });
  assert.equal(await db.prepare('SELECT token FROM sessions WHERE token = ?').bind(old).first(), null, 'issuing a code clears unused expired codes');

  // 웹: 맥 앱이 만든 통로가 있을 때만 맥 앱으로 본다. 웹 보기 자리와 덮인 상태를 알린다.
  const { nativeBridge, inNativeApp, articlePlacement } = await vite.ssrLoadModule('/src/client/nativeApp.ts');
  assert.equal(nativeBridge({}), null);
  assert.equal(inNativeApp({ webkit: { messageHandlers: { feedex: {} } } }), false, 'a handler without postMessage is not the app');
  const sent = [];
  const host = { webkit: { messageHandlers: { feedex: { postMessage: (message) => sent.push(message) } } } };
  assert.equal(inNativeApp(host), true);
  const slot = (width, height) => ({ getBoundingClientRect: () => ({ left: 320.4, top: 96.6, width, height }) });
  const page = (cover = null) => ({ querySelector: () => cover });
  assert.deepEqual(articlePlacement(slot(700.2, 640), page(), 'https://www.hankyung.com/article/1', 1.1), { type: 'article', url: 'https://www.hankyung.com/article/1', zoom: 1.1, hidden: false, rect: { x: 320, y: 97, width: 700, height: 640 } });
  assert.equal(articlePlacement(slot(0, 640), page(), 'https://a.test/', 1).hidden, true, 'an empty slot hides the original view');
  assert.equal(articlePlacement(slot(700, 640), page({}), 'https://a.test/', 1).hidden, true, 'a dialog or menu over the slot hides the original view');

  // 화면: 맥 앱 안에서는 시스템 로그인 창 버튼을 보이고, 웹 보기 자리에 원문 화면 자리만 둔다.
  Object.defineProperty(globalThis, 'webkit', { value: host.webkit, configurable: true });
  Object.defineProperty(globalThis, 'DOMParser', { value: DOMParser, configurable: true });
  const { LoginView } = await vite.ssrLoadModule('/src/components/LoginView.tsx');
  const login = renderToStaticMarkup(React.createElement(LoginView, { onLoginSuccess() {} }));
  assert.match(login, /Google 계정으로 로그인/); assert.match(login, /시스템 로그인 창/);
  assert.doesNotMatch(login, /Google Identity Services/, 'the in-app Google button that Google blocks is not drawn');
  const { NativeHandoff } = await vite.ssrLoadModule('/src/components/NativeHandoff.tsx');
  const handoff = renderToStaticMarkup(React.createElement(NativeHandoff, { email: 'mac-owner@example.test', isDark: false, onUseAnother() {} }));
  assert.match(handoff, /mac-owner@example\.test/); assert.match(handoff, /맥 앱으로 로그인/); assert.match(handoff, /다른 계정으로 로그인/);
  const { ArticleDrawer } = await vite.ssrLoadModule('/src/components/ArticleDrawer.tsx');
  const base = { feed_id: 'feed', feed_title: 'Hankyung', published_at: new Date().toISOString(), is_read: false, is_saved: false, content_html: '<p>Feed summary only</p>', summary: 'Feed summary only' };
  const drawer = (article) => renderToStaticMarkup(React.createElement(ArticleDrawer, { article, accountId: 'mac-owner', viewMode: 'web', isDark: false, onClose() {}, onToggleRead() {}, onToggleSaved() {}, onUpdateArticleFields() {}, onChangeViewMode() {}, onNavigateRelative() {}, onCopyLink() {}, onNotice() {}, hasPrev: false, hasNext: false }));
  const web = drawer({ ...base, id: 'hk', title: 'Premium article', url: 'https://www.hankyung.com/article/202611060532i' });
  assert.match(web, /data-native-article/, 'the web view leaves a slot for the original view');
  assert.doesNotMatch(web, /<iframe/, 'no framed site or copy is drawn under the original view');
  assert.match(web, /브라우저에서 열기/); assert.doesNotMatch(web, /원문에서 읽기·로그인/, 'the same-window original link is not needed in the Mac app');
  const x = drawer({ ...base, id: 'x', title: 'Post', url: 'https://x.com/NASA/status/1', feed_title: 'NASA (@NASA)' });
  assert.doesNotMatch(x, /data-native-article/, 'X posts keep the public mirror copy');
  const { installState } = await vite.ssrLoadModule('/src/client/pwa.ts');
  assert.equal(installState(), 'installed', 'the Mac app never shows the install prompt');
  const { inNativeSignInWindow } = await vite.ssrLoadModule('/src/client/nativeApp.ts');
  assert.equal(inNativeSignInWindow('?native-sign-in=1'), true); assert.equal(inNativeSignInWindow('?x=1'), false);
  assert.match(handoff, /text-slate-900/, 'the account is readable on the light theme');

  // 맥 앱 코드: FeedEx 화면의 맨 위 문서가 보낸 메시지만 받고, 로그인 코드는 앱이 시작한 시스템 로그인 창으로만 받는다.
  const swift = ['FeedExWindow', 'Main', 'Reader'].map((name) => readFileSync(`native/macos/${name}.swift`, 'utf8')).join('\n');
  assert.match(swift, /message\.webView === app, message\.frameInfo\.isMainFrame,\s*sameOrigin\(message\.frameInfo\.request\.url, home\)/);
  assert.match(swift, /ASWebAuthenticationSession\(url: url, callbackURLScheme: "feedex-reader"\)/);
  assert.match(swift, /code\.range\(of: "\^sfeed_code_\[0-9a-f\]\{64\}\$", options: \.regularExpression\)/);
  assert.doesNotMatch(readFileSync('native/macos/Main.swift', 'utf8'), /signed-in/, 'links opened from elsewhere cannot sign the app in');
  assert.match(swift, /FEEDEX_DEBUG_DIR/); assert.match(readFileSync('native/macos/Info.plist', 'utf8'), /FeedEx for Mac/);
  console.log('PASS: one-minute single-use Mac sign-in codes that never act as sessions, bridge placement and covers, system sign-in button and hand-off screen, original-view slot without frames, X copies kept, no install prompt, and message/sign-in origin checks in the Mac app.');
} finally {
  for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  await vite.close();
}
