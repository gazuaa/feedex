import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DOMParser } from 'linkedom';
import { createServer } from 'vite';

// 맥 앱: 시스템 로그인 창에서 받은 일회용 코드로 로그인하고, 웹 보기 자리에 원문 화면을 겹친다.
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
  const { nativeBridge, inNativeApp, articlePlacement, nativeAppScale } = await vite.ssrLoadModule('/src/client/nativeApp.ts');
  assert.equal(nativeBridge({}), null);
  assert.equal(nativeAppScale({}), 0.9);
  for (const value of [NaN, Infinity, 0, 0.49, 1.51]) assert.equal(nativeAppScale({ feedexAppScale: value }), 0.9);
  assert.equal(nativeAppScale({ feedexAppScale: 0.7 }), 0.7);
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
  const { NativeAppScaleSetting, NativeAppUpdateSetting } = await vite.ssrLoadModule('/src/components/ReadingSettings.tsx');
  assert.match(renderToStaticMarkup(React.createElement(NativeAppScaleSetting)), /앱 화면 작게/);
  assert.match(renderToStaticMarkup(React.createElement(NativeAppUpdateSetting)), /업데이트 확인/);
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
  assert.match(swift, /FEEDEX_DEBUG_DIR/); assert.match(readFileSync('native/macos/Info.plist', 'utf8'), /<key>CFBundleName<\/key><string>FeedEx<\/string>/, 'the Mac app is called FeedEx');
  if (process.platform === 'darwin') {
    const directory = mkdtempSync(join(tmpdir(), 'feedex-launch-test-'));
    try {
      const test = join(directory, 'LaunchTest.swift');
      const executable = join(directory, 'launch-test');
      writeFileSync(test, `import Foundation
import CryptoKit
import UserNotifications
@main struct LaunchTest {
    static func main() {
        precondition(NativeNotifications.permission(.notDetermined) == "default")
        precondition(NativeNotifications.permission(.denied) == "denied")
        precondition(NativeNotifications.permission(.authorized) == "granted")
        precondition(NotificationTarget(["account": "", "articleId": "a"]) == nil)
        precondition(NotificationTarget(["account": "owner", "articleId": ""]) == nil)
        precondition(NotificationTarget(["account": "owner", "articleId": "a"])!.identifier == NotificationTarget(["account": "owner", "articleId": "a"])!.identifier)
        precondition(NotificationTarget(["account": "owner", "articleId": "a"])!.identifier != NotificationTarget(["account": "other", "articleId": "a"])!.identifier)
        precondition(AppScale.restored(nil) == 0.9)
        for value in [Double.nan, Double.infinity, 0.49, 1.51] { precondition(AppScale.restored(value) == 0.9) }
        precondition(AppScale.restored(0.7) == 0.7)
        precondition(AppScale.changed(0.9, action: "smaller") == 0.8)
        precondition(AppScale.changed(0.9, action: "larger") == 1.0)
        precondition(AppScale.changed(0.5, action: "smaller") == 0.5)
        precondition(AppScale.changed(1.5, action: "larger") == 1.5)
        precondition(AppScale.changed(1.2, action: "reset") == 0.9)
        precondition(AppScale.changed(0.9, action: "unknown") == nil)
        let rect = CGRect(x: 320, y: 100, width: 700, height: 640)
        precondition(AppScale.frame(rect, scale: 0.9) == CGRect(x: 288, y: 90, width: 630, height: 576))
        precondition(AppScale.frame(rect, scale: 1.2) == CGRect(x: 384, y: 120, width: 840, height: 768))
        // 재실행 시 저장한 앱 배율을 복원한다. 실제 사용자 설정은 건드리지 않는다.
        let suite = "feedex-scale-test-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defaults.set(0.7, forKey: AppScale.preferenceKey)
        precondition(AppScale.restored(UserDefaults(suiteName: suite)!.object(forKey: AppScale.preferenceKey) as? Double) == 0.7)
        defaults.removePersistentDomain(forName: suite)
        // 배포 파일과 서명을 실제 공개 키로 검증하고, 한 바이트라도 달라지면 거절한다.
        let key = try! Curve25519.Signing.PublicKey(rawRepresentation: Data(base64Encoded: CommandLine.arguments[1])!)
        let signature = Data(base64Encoded: CommandLine.arguments[2])!
        var archive = try! Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[3]))
        precondition(key.isValidSignature(signature, for: archive))
        archive[0] ^= 1
        precondition(!key.isValidSignature(signature, for: archive))
        precondition(isMainAppLink(URL(string: "feedex-reader://launch")!))
        for value in [
            "https://launch", "feedex-reader://open", "feedex-reader://signed-in?code=secret",
            "feedex-reader://launch?token=secret", "feedex-reader://launch#token",
            "feedex-reader://launch/extra", "feedex-reader://user@launch",
            "feedex-reader://user:secret@launch", "feedex-reader://launch:443"
        ] {
            precondition(!isMainAppLink(URL(string: value)!))
        }
    }
}`);
      execFileSync('xcrun', ['swiftc', '-parse-as-library', '-module-cache-path', join(directory, 'modules'), 'native/macos/AppLinks.swift', 'native/macos/AppScale.swift', 'native/macos/Notifications.swift', test, '-o', executable], { stdio: 'pipe' });
      const plist = readFileSync('native/macos/Info.plist', 'utf8');
      const publicKey = /<key>SUPublicEDKey<\/key><string>([^<]+)<\/string>/.exec(plist)[1];
      const feed = readFileSync('public/downloads/appcast.xml', 'utf8');
      const signature = /sparkle:edSignature="([^"]+)"/.exec(feed)[1];
      execFileSync(executable, [publicKey, signature, 'public/downloads/FeedEx-for-Mac.zip'], { stdio: 'pipe' });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
  // 맥 앱 받기: 앱 설치는 위쪽 버튼 하나로 들어가고, 맥 브라우저에서만 안내 창 맨 위에 맥 앱을 둔다.
  const { macAppOffered, installEntry, PwaInstall, InstallAppButton } = await vite.ssrLoadModule('/src/components/PwaInstall.tsx');
  const { MAC_APP_VERSION, MAC_APP_DOWNLOAD, MAC_APP_OPEN } = await vite.ssrLoadModule('/src/shared/macApp.ts');
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
  assert.equal(macAppOffered(mac, 0), false, 'inside the Mac app the download is not offered');
  delete globalThis.webkit;
  assert.equal(renderToStaticMarkup(React.createElement(NativeAppScaleSetting)), '', 'browser apps keep their own zoom controls');
  assert.equal(renderToStaticMarkup(React.createElement(NativeAppUpdateSetting)), '', 'Sparkle controls appear only in the native app');
  assert.equal(macAppOffered(mac, 0), true);
  assert.equal(macAppOffered(mac, 5), false, 'iPads that report a Mac browser are left out');
  assert.equal(macAppOffered('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0', 0), false);
  assert.equal(installEntry('manual', 'desktop', true, false), '앱 설치');
  assert.equal(installEntry('installed', 'desktop', true, false), '맥 앱 받기', 'a Mac with the browser app installed can still get the Mac app');
  assert.equal(installEntry('installed', 'desktop', false, false), null, 'nothing is offered once installed elsewhere');
  assert.equal(installEntry('manual', 'ios', false, true), '홈 화면 추가 안내');
  const agent = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: mac });
  let help;
  try {
    help = renderToStaticMarkup(React.createElement(PwaInstall));
    const entry = renderToStaticMarkup(React.createElement(InstallAppButton));
    assert.equal(MAC_APP_OPEN, 'feedex-reader://launch');
    assert.match(entry, /href="feedex-reader:\/\/launch"/, 'the primary Mac action launches the native app, even with browser-app support');
    assert.match(entry, /맥 앱으로 열기/);
    assert.match(entry, /aria-label="맥 앱 설치 안내"/, 'installation stays available separately');
    assert.ok(entry.indexOf('맥 앱으로 열기') < entry.indexOf('맥 앱 설치 안내'), 'opening the native app comes first');
  } finally { if (agent) Object.defineProperty(navigator, 'userAgent', agent); else delete navigator.userAgent; }
  assert.match(help, new RegExp(`href="/downloads/FeedEx-for-Mac\\.zip\\?v=${MAC_APP_VERSION.replace('.', '\\.')}"`)); assert.match(help, /download="FeedEx-for-Mac\.zip"/);
  assert.match(help, /href="feedex-reader:\/\/launch"/);
  assert.match(help, /브라우저 앱으로 설치/, 'the browser install steps follow the Mac app');
  assert.match(help, /href="x-apple\.systempreferences:com\.apple\.preference\.security\?General"[^>]*>시스템 설정 열기</, 'a button opens the security settings where macOS offers to open the app anyway');
  assert.ok(help.indexOf('한 번 열어요') < help.indexOf('시스템 설정 열기'), 'the steps say to try opening the app first');
  assert.doesNotMatch(help, /feedex-install-banner/, 'no floating install banner on the desktop');
  const { DesktopReadingSettings } = await vite.ssrLoadModule('/src/components/ReadingSettings.tsx');
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(DesktopReadingSettings, { markReadOnScroll: false, onChangeMarkReadOnScroll() {}, autoRefreshMinutes: 15, onChangeAutoRefreshMinutes() {}, layout: 'magazine', onChangeLayout() {} })), /FeedEx-for-Mac\.zip/, 'the settings panel no longer repeats the download');
  assert.equal(MAC_APP_DOWNLOAD, `/downloads/FeedEx-for-Mac.zip?v=${MAC_APP_VERSION}`);
  const zip = 'public/downloads/FeedEx-for-Mac.zip';
  assert.ok(statSync(zip).size < 5_000_000, 'the download stays small');
  const feed = readFileSync('public/downloads/appcast.xml', 'utf8');
  assert.match(feed, /<!-- sparkle-signatures:/, 'the appcast is signed too');
  const enclosure = /<enclosure [^>]*url="([^"]+)"[^>]*length="(\d+)"/.exec(feed);
  assert.equal(enclosure[1], `https://feedex.jyk.workers.dev/downloads/FeedEx-for-Mac-${MAC_APP_VERSION}.zip`);
  assert.equal(Number(enclosure[2]), statSync(zip).size);
  assert.deepEqual(readFileSync(`public/downloads/FeedEx-for-Mac-${MAC_APP_VERSION}.zip`), readFileSync(zip));
  assert.ok(execFileSync('unzip', ['-l', zip], { encoding: 'utf8' }).includes('Frameworks/Sparkle.framework'));
  assert.ok(execFileSync('unzip', ['-l', zip], { encoding: 'utf8' }).includes('Resources/Sparkle-LICENSE.txt'));
  assert.doesNotMatch(readFileSync('src/App.tsx', 'utf8'), /Cloudflare Workers · D1 SQLite · Workers AI/);
  const version = (plist) => /<key>CFBundleShortVersionString<\/key><string>([^<]+)<\/string>/.exec(plist)?.[1];
  assert.equal(version(readFileSync('native/macos/Info.plist', 'utf8')), MAC_APP_VERSION, 'the link and the app source share one version');
  assert.equal(version(execFileSync('unzip', ['-p', zip, 'FeedEx.app/Contents/Info.plist'], { encoding: 'utf8' })), MAC_APP_VERSION, 'the zip holds that version');
  const sources = [...readdirSync('native/macos').filter((name) => name.endsWith('.swift')).sort().map((name) => `native/macos/${name}`), 'native/macos/Info.plist'];
  const listing = sources.map((path) => `${createHash('sha256').update(readFileSync(path)).digest('hex')}  ${path}\n`).join('');
  assert.equal(createHash('sha256').update(listing).digest('hex'), readFileSync('public/downloads/FeedEx-for-Mac.source', 'utf8').trim(), 'the Mac app source changed: run scripts/build-macos-reader.sh to rebuild the download');
  assert.doesNotMatch(readFileSync('public/sw.js', 'utf8'), /downloads/, 'the service worker never stores the download on every device');
  console.log('PASS: one install button, Mac app first in its dialog only on Mac browsers outside the app, no floating banner or settings duplicate, versioned link, zip version and source fingerprint match, not cached by the service worker; one-minute single-use Mac sign-in codes that never act as sessions, bridge placement and covers, system sign-in button and hand-off screen, original-view slot without frames, X copies kept, no install prompt, and message/sign-in origin checks in the Mac app.');
} finally {
  for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  await vite.close();
}
