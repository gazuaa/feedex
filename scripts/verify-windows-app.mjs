import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DOMParser } from 'linkedom';
import { createServer } from 'vite';

// 윈도우 앱: 맥 앱과 같은 메시지를 WebView2 통로로 주고받고, 로그인은 기본 브라우저에서 상태 값과 함께 넘긴다.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const keys = ['chrome', 'feedexWindowsApp', 'webkit', 'location', 'DOMParser'];
const previous = Object.fromEntries(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const agent = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
const setGlobal = (key, value) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
const useAgent = (value) => Object.defineProperty(navigator, 'userAgent', { configurable: true, value });
const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0';
const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const linux = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const state = 'c'.repeat(64);
try {
  // 통로: 앱이 넣는 표시가 있을 때만 윈도우 앱으로 본다. 메시지는 어느 통로인지 붙여 보낸다.
  const { nativePlatform, nativeBridge, inNativeApp, nativeAppName, nativeSystemName, nativeSignInPlatform, nativeSignInState, nativeSignInCallback } = await vite.ssrLoadModule('/src/client/nativeApp.ts');
  const sent = [];
  const listeners = [];
  const view = { postMessage: (message) => sent.push(message), addEventListener: (type, listener) => { if (type === 'message') listeners.push(listener); } };
  const host = { chrome: { webview: view }, feedexWindowsApp: true };
  assert.equal(nativePlatform({}), null);
  assert.equal(nativePlatform({ chrome: { webview: view } }), null, 'another WebView2 program is not the FeedEx app');
  assert.equal(nativePlatform({ chrome: { webview: {} }, feedexWindowsApp: true }), null, 'a view without postMessage is not the app');
  assert.equal(nativePlatform(host), 'windows');
  assert.equal(nativePlatform({ webkit: { messageHandlers: { feedex: { postMessage() {} } } } }), 'mac');
  assert.equal(inNativeApp(host), true);
  nativeBridge(host).postMessage({ type: 'signIn' });
  assert.deepEqual(sent.pop(), { channel: 'feedex', body: { type: 'signIn' } }, 'the app reads the channel and the same message the Mac app gets');
  assert.equal(nativeAppName('windows'), '윈도우 앱'); assert.equal(nativeAppName('mac'), '맥 앱'); assert.equal(nativeAppName(null), '맥 앱');
  assert.equal(nativeSystemName('windows'), 'Windows'); assert.equal(nativeSystemName('mac'), 'macOS');
  assert.equal(nativeSignInPlatform(`?native-sign-in=windows&state=${state}`), 'windows');
  assert.equal(nativeSignInPlatform('?native-sign-in=1'), 'mac', 'the Mac app keeps its address');
  assert.equal(nativeSignInState(`?native-sign-in=windows&state=${state}`), state);
  assert.equal(nativeSignInState('?native-sign-in=windows&state=short'), null, 'a malformed state is not passed on');
  assert.equal(nativeSignInState(`?native-sign-in=windows&state=${state.toUpperCase()}`), null);
  const code = `sfeed_code_${'a'.repeat(64)}`;
  assert.equal(nativeSignInCallback(code, state), `feedex-reader://signed-in?code=${code}&state=${state}`);
  assert.equal(nativeSignInCallback(code, null), `feedex-reader://signed-in?code=${code}`, 'the Mac callback is unchanged');

  // 알림: 번호를 붙여 보내고 같은 번호의 답만 받는다.
  const { nativeNotificationBridge } = await vite.ssrLoadModule('/src/client/nativeNotifications.ts');
  const bridge = nativeNotificationBridge(host);
  assert.ok(bridge, 'the Windows app has a notification bridge');
  assert.equal(nativeNotificationBridge(host), bridge, 'one listener per view');
  assert.equal(listeners.length, 1);
  assert.equal(nativeNotificationBridge({ chrome: { webview: { postMessage() {} } }, feedexWindowsApp: true }), null, 'replies need a message listener');
  const status = bridge.postMessage({ action: 'status' });
  const request = sent.pop();
  assert.equal(request.channel, 'notifications'); assert.equal(typeof request.id, 'number'); assert.deepEqual(request.body, { action: 'status' });
  listeners[0]({ data: { channel: 'feedex', id: request.id, result: { permission: 'denied' } } });
  listeners[0]({ data: { channel: 'notifications', id: request.id + 1000, result: { permission: 'denied' } } });
  listeners[0]({ data: null });
  listeners[0]({ data: { channel: 'notifications', id: request.id, result: { permission: 'granted' } } });
  assert.deepEqual(await status, { permission: 'granted' }, 'only the matching reply ends the request');
  const failing = bridge.postMessage({ action: 'show', title: '', body: '', account: 'a', articleId: 'b' });
  listeners[0]({ data: { channel: 'notifications', id: sent.pop().id, error: '알림 내용을 확인해 주세요.' } });
  await assert.rejects(failing, /알림 내용을 확인해 주세요/);

  // 화면: 윈도우 앱 안에서는 기본 브라우저 로그인 단추와 윈도우 앱 설정을 보인다.
  setGlobal('chrome', host.chrome); setGlobal('feedexWindowsApp', true); setGlobal('DOMParser', DOMParser);
  delete globalThis.webkit;
  const { NativeAppScaleSetting, NativeAppUpdateSetting } = await vite.ssrLoadModule('/src/components/ReadingSettings.tsx');
  assert.match(renderToStaticMarkup(React.createElement(NativeAppScaleSetting)), /앱 화면 작게/);
  const update = renderToStaticMarkup(React.createElement(NativeAppUpdateSetting));
  assert.match(update, /윈도우 앱 업데이트/); assert.match(update, /받아서 설치해요/); assert.doesNotMatch(update, /맥 앱/);
  const { LoginView } = await vite.ssrLoadModule('/src/components/LoginView.tsx');
  const login = renderToStaticMarkup(React.createElement(LoginView, { onLoginSuccess() {} }));
  assert.match(login, /Google 계정으로 로그인/); assert.match(login, /기본 브라우저에서 로그인하면/);
  assert.doesNotMatch(login, /Safari/, 'no Safari wording in the Windows app');
  const { LocalNotificationSetting } = await vite.ssrLoadModule('/src/components/LocalNotificationSetting.tsx');
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(LocalNotificationSetting, { accountId: 'win-owner' })), /앱을 업데이트해 주세요/, 'the Windows app needs no update for notifications');
  const { ArticleDrawer } = await vite.ssrLoadModule('/src/components/ArticleDrawer.tsx');
  const web = renderToStaticMarkup(React.createElement(ArticleDrawer, { article: { id: 'hk', feed_id: 'feed', feed_title: 'Hankyung', title: 'Premium article', url: 'https://www.hankyung.com/article/1', published_at: new Date().toISOString(), is_read: false, is_saved: false, content_html: '<p>Feed summary only</p>', summary: 'Feed summary only' }, accountId: 'win-owner', viewMode: 'web', isDark: false, onClose() {}, onToggleRead() {}, onToggleSaved() {}, onUpdateArticleFields() {}, onChangeViewMode() {}, onNavigateRelative() {}, onCopyLink() {}, onNotice() {}, hasPrev: false, hasNext: false }));
  assert.match(web, /data-native-article/, 'the web view leaves a slot for the signed-in original view');
  assert.doesNotMatch(web, /<iframe/);
  const { installState } = await vite.ssrLoadModule('/src/client/pwa.ts');
  assert.equal(installState(), 'installed', 'the Windows app never shows the install prompt');
  const { desktopAppOffered, macAppOffered, windowsAppOffered, installEntry, PwaInstall, InstallAppButton } = await vite.ssrLoadModule('/src/components/PwaInstall.tsx');
  assert.equal(desktopAppOffered(windows, 0), null, 'inside the Windows app the download is not offered');

  // 로그인 넘기기: 기본 브라우저의 화면은 윈도우 앱 이름을 쓰고 상태 값을 돌려준다.
  setGlobal('location', { search: `?native-sign-in=windows&state=${state}` });
  delete globalThis.chrome; delete globalThis.feedexWindowsApp;
  const { NativeHandoff } = await vite.ssrLoadModule('/src/components/NativeHandoff.tsx');
  const handoff = renderToStaticMarkup(React.createElement(NativeHandoff, { email: 'win-owner@example.test', isDark: false, onUseAnother() {} }));
  assert.match(handoff, /FeedEx 윈도우 앱에 로그인/); assert.match(handoff, /윈도우 앱으로 로그인/); assert.doesNotMatch(handoff, /맥 앱/);
  const handoffLogin = renderToStaticMarkup(React.createElement(LoginView, { onLoginSuccess() {} }));
  assert.match(handoffLogin, /윈도우 앱에서 쓸 계정으로 로그인하세요/);
  setGlobal('location', { search: '?native-sign-in=1' });
  assert.match(renderToStaticMarkup(React.createElement(NativeHandoff, { email: 'mac-owner@example.test', isDark: false, onUseAnother() {} })), /맥 앱으로 로그인/, 'the Mac hand-off keeps its wording');
  delete globalThis.location;

  // 설치 안내: 윈도우 브라우저에서는 윈도우 앱을 먼저 두고, 브라우저 앱은 한 줄로 줄인다.
  assert.equal(windowsAppOffered(windows, 0), true); assert.equal(macAppOffered(windows, 0), false);
  assert.equal(windowsAppOffered(mac, 0), false); assert.equal(macAppOffered(mac, 0), true);
  assert.equal(desktopAppOffered(linux, 0), null, 'Linux gets only the browser app');
  assert.equal(windowsAppOffered('Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1) Edge/15', 0), false);
  assert.equal(installEntry('installed', 'desktop', 'windows', false), '윈도우 앱 받기', 'Windows with the browser app installed can still get the Windows app');
  const { WINDOWS_APP_VERSION, WINDOWS_APP_DOWNLOAD, WINDOWS_APP_OPEN } = await vite.ssrLoadModule('/src/shared/windowsApp.ts');
  assert.equal(WINDOWS_APP_DOWNLOAD, `/downloads/FeedEx-for-Windows.zip?v=${WINDOWS_APP_VERSION}`);
  assert.equal(WINDOWS_APP_OPEN, 'feedex-reader://launch');
  let help, first, entry, knownHelp, plain;
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const stored = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, String(value)), removeItem: (key) => stored.delete(key) } });
  try {
    useAgent(windows);
    help = renderToStaticMarkup(React.createElement(PwaInstall));
    first = renderToStaticMarkup(React.createElement(InstallAppButton));
    // 앱이 열린 적이 있는 브라우저. 앱 주소를 열어 브라우저가 포커스를 잃으면 기억한다.
    const { launchDesktopApp, knownDesktopApp, LAUNCH_WAIT_MS } = await vite.ssrLoadModule('/src/client/desktopApp.ts');
    const fakeHost = () => {
      const handlers = new Map(), timers = [];
      const on = (type, listener) => handlers.set(type, listener), off = (type) => handlers.delete(type);
      return { handlers, timers, location: { href: 'https://feedex.test/' }, addEventListener: on, removeEventListener: off, setTimeout: (run, ms) => { timers.push({ run, ms }); return timers.length; }, clearTimeout() {}, document: { visibilityState: 'visible', addEventListener: on, removeEventListener: off } };
    };
    let missing = 0;
    const absent = fakeHost();
    launchDesktopApp('windows', WINDOWS_APP_OPEN, () => missing++, absent);
    assert.equal(absent.location.href, WINDOWS_APP_OPEN, 'the app address is opened');
    assert.equal(absent.timers[0].ms, LAUNCH_WAIT_MS);
    absent.timers[0].run();
    assert.equal(missing, 1, 'nothing happening means the app is missing, so install help opens');
    assert.equal(knownDesktopApp('windows'), false);
    assert.equal(absent.handlers.size, 0, 'listeners are removed');
    const present = fakeHost();
    launchDesktopApp('windows', WINDOWS_APP_OPEN, () => missing++, present);
    present.handlers.get('blur')();
    present.timers[0].run();
    assert.equal(missing, 1, 'a browser prompt or the app taking focus is not missing');
    assert.equal(knownDesktopApp('windows'), true, 'an app that opened is remembered on this browser');
    entry = renderToStaticMarkup(React.createElement(InstallAppButton));
    knownHelp = renderToStaticMarkup(React.createElement(PwaInstall));
    useAgent(linux);
    plain = renderToStaticMarkup(React.createElement(PwaInstall));
  } finally {
    if (agent) Object.defineProperty(navigator, 'userAgent', agent); else delete navigator.userAgent;
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor); else delete globalThis.localStorage;
  }
  assert.doesNotMatch(first, /윈도우 앱으로 열기/, 'without the app the header offers installation, not a button that does nothing');
  assert.match(first, /앱 설치/);
  assert.match(help, /class="feedex-install-icon"><svg[^>]*><path d="M3 3h8\.5v8\.5H3z/, 'the Windows app has a Windows icon');
  assert.match(help, /lucide-chrome/, 'the browser app has a browser icon');
  assert.match(help, /border border-emerald-500[^"]*"[^>]*>.*?윈도우 앱으로 열기/, 'before the app has opened, download is the main action');
  assert.match(knownHelp, /href="feedex-reader:\/\/launch" class="mt-3 inline-flex items-center gap-2 rounded-xl bg-emerald-500/, 'after it has opened, opening is the main action');
  assert.match(help, new RegExp(`href="/downloads/FeedEx-for-Windows\\.zip\\?v=${WINDOWS_APP_VERSION.replace('.', '\\.')}"`)); assert.match(help, /download="FeedEx-for-Windows\.zip"/);
  assert.match(help, /href="feedex-reader:\/\/launch"[^>]*>.*윈도우 앱으로 열기/);
  assert.match(help, /모두 압축 풀기/); assert.match(help, /Windows의 PC 보호/); assert.match(help, /추가 정보/);
  assert.doesNotMatch(help, /FeedEx-for-Mac/, 'Windows browsers are not offered the Mac app');
  assert.ok(help.indexOf('aria-label="윈도우 앱"') < help.indexOf('aria-label="브라우저 앱"'), 'the Windows app comes first');
  assert.match(help, /주소창 오른쪽의 설치 아이콘으로 설치해요/, 'without a browser prompt the browser app is one line');
  for (const removed of ['설치 메뉴가 없으면', '브라우저 앱으로 설치', 'Google 로그인이 다시', '지금 설치', '알겠어요', 'FeedEx 설치</strong>'])
    assert.ok(!help.includes(removed), `the long browser install text is gone: ${removed}`);
  assert.match(entry, /href="feedex-reader:\/\/launch"/); assert.match(entry, /윈도우 앱으로 열기/); assert.match(entry, /aria-label="윈도우 앱 설치 안내"/);
  assert.match(plain, /FeedEx 앱 설치/); assert.match(plain, /aria-label="브라우저 앱"/);
  assert.doesNotMatch(plain, /윈도우 앱|맥 앱/, 'other desktops get no native app');

  // 받는 파일: 작고, 버전·지문·업데이트 정보가 맞고, 앱이 쓰는 파일만 들어 있다.
  const zip = 'public/downloads/FeedEx-for-Windows.zip';
  assert.ok(statSync(zip).size < 5_000_000, 'the download stays small');
  assert.deepEqual(readFileSync(`public/downloads/FeedEx-for-Windows-${WINDOWS_APP_VERSION}.zip`), readFileSync(zip));
  const files = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n').filter((name) => name && !name.endsWith('/')).sort();
  assert.deepEqual(files, ['FeedEx/FeedEx.exe', 'FeedEx/FeedEx.exe.config', 'FeedEx/Microsoft.Web.WebView2.Core.dll', 'FeedEx/Microsoft.Web.WebView2.WinForms.dll', 'FeedEx/WebView2-LICENSE.txt', 'FeedEx/runtimes/win-arm64/native/WebView2Loader.dll', 'FeedEx/runtimes/win-x64/native/WebView2Loader.dll', 'FeedEx/runtimes/win-x86/native/WebView2Loader.dll']);
  assert.match(execFileSync('unzip', ['-p', zip, 'FeedEx/FeedEx.exe.config'], { encoding: 'utf8' }), /key="DpiAwareness" value="PerMonitorV2"/, 'text stays sharp on scaled displays');
  const info = JSON.parse(readFileSync('public/downloads/FeedEx-for-Windows.json', 'utf8'));
  assert.equal(info.version, WINDOWS_APP_VERSION);
  assert.equal(info.download, `https://feedex.jyk.workers.dev/downloads/FeedEx-for-Windows-${WINDOWS_APP_VERSION}.zip`);
  assert.equal(info.sha256, createHash('sha256').update(readFileSync(zip)).digest('hex'));
  // 자동 업데이트: 업데이트 정보는 앱에 넣은 공개 키로 서명돼 있고, 앱이 바꾸는 파일은 zip의 파일과 같다.
  const { verifyUpdate } = await import('./windows-update-signing.mjs');
  const publicKey = /PublicKey = "([^"]+)"/.exec(readFileSync('native/windows/UpdateSignature.cs', 'utf8'))[1];
  assert.equal(verifyUpdate(publicKey, info.version, info.sha256, info.signature), true, 'the update info is signed with the key built into the app');
  assert.equal(verifyUpdate(publicKey, '9.9', info.sha256, info.signature), false, 'the signature covers the version');
  const updaterFiles = [...readFileSync('native/windows/Updater.cs', 'utf8').matchAll(/^\s+"([^"]+)",$/gm)].map((match) => `FeedEx/${match[1]}`).sort();
  assert.deepEqual(updaterFiles, files, 'the updater replaces exactly the files in the download');
  const project = readFileSync('native/windows/FeedEx.csproj', 'utf8');
  assert.equal(/<Version>([^<]+)<\/Version>/.exec(project)[1], WINDOWS_APP_VERSION, 'the link and the app source share one version');
  assert.match(project, /<TargetFramework>net48<\/TargetFramework>/, 'built for the .NET Framework that ships with Windows');
  const sources = [...readdirSync('native/windows').filter((name) => name.endsWith('.cs')).sort().map((name) => `native/windows/${name}`), 'native/windows/FeedEx.csproj', 'native/windows/App.config', 'native/windows/app.manifest', 'native/windows/FeedEx.ico'];
  const listing = sources.map((path) => `${createHash('sha256').update(readFileSync(path)).digest('hex')}  ${path}\n`).join('');
  assert.equal(createHash('sha256').update(listing).digest('hex'), readFileSync('public/downloads/FeedEx-for-Windows.source', 'utf8').trim(), 'the Windows app source changed: run scripts/build-windows-app.sh to rebuild the download');
  assert.doesNotMatch(readFileSync('public/sw.js', 'utf8'), /downloads/, 'the service worker never stores the download');

  // 앱 코드: FeedEx 화면의 맨 위 문서가 보낸 메시지만 받고, 로그인 코드는 이 앱이 시작한 로그인의 상태 값과 맞을 때만 쓴다.
  const read = (name) => readFileSync(`native/windows/${name}`, 'utf8');
  const form = read('MainForm.cs'), popup = read('PopupWindow.cs'), program = read('Program.cs'), support = read('Support.cs');
  assert.match(form, /!Uri\.TryCreate\(args\.Source, UriKind\.Absolute, out var source\) \|\| !AppLinks\.SameOrigin\(source, home\)\) return;/);
  assert.match(form, /pending != null && pending\.Accepts\(state, DateTime\.UtcNow\)\)\s*\{\s*signIn = null;/, 'a sign-in code needs the state this app started and works once');
  assert.ok(form.indexOf('pending.Accepts(state') < form.indexOf('feedexNativeSignedIn('), 'the code reaches the page only after the state matches');
  assert.match(form, /var core = article\.CoreWebView2;[\s\S]*?core\.Settings\.IsWebMessageEnabled = false;/, 'publisher pages cannot message the app');
  assert.match(popup, /core\.Settings\.IsWebMessageEnabled = false;/, 'publisher sign-in windows cannot message the app');
  assert.match(form, /window !== window\.top \|\| location\.origin !== " \+ origin \+ "\) return; window\.feedexWindowsApp = true;/, 'the app marker is only set in the FeedEx page');
  // Slap 공유: 이 컴퓨터에 web+slap 주소를 받는 앱(Chrome·Edge가 설치한 Slap)이 있을 때만 그것을 열고, 없으면 Slap 웹을 연다.
  assert.match(form, /window\.feedexWindowsApp = true; window\.feedexAppFeatures = \['openSlap'\];/, 'the app tells the page it can open Slap');
  assert.match(form, /case "openSlap": OpenSlap\(Json\.Text\(body, "url"\), Json\.Text\(body, "fallback"\)\); break;/);
  assert.match(form, /var app = AppLinks\.SlapAddress\(url\);\s*if \(app != null && Shell\.HasProtocolHandler\("web\+slap"\)\) \{ Shell\.Open\(app\); return; \}\s*var web = AppLinks\.WebAddress\(fallback\);/, 'Windows does not show its app picker when Slap is not installed');
  assert.match(support, /Registry\.ClassesRoot\.OpenSubKey\(scheme\)\) return key\?\.GetValue\("URL Protocol"\) != null;/);
  assert.ok(program.indexOf('Microsoft.Web.WebView2.Core.dll') < program.indexOf('Start(instance'), 'missing files are explained before WebView2 loads');
  assert.match(program, /\[MethodImpl\(MethodImplOptions\.NoInlining\)\]\s*static void Start/);
  assert.match(support, /Registry\.CurrentUser\.CreateSubKey\(@"Software\\Classes\\" \+ AppLinks\.Scheme\)/, 'links are registered for this user only');
  assert.match(support, /var command = "\\"" \+ exe \+ "\\" \\"%1\\"";/, 'the link is passed as one quoted argument');
  // 1.0은 Defender에 Wacatac.B!ml로 잡혔다. 악성코드가 자리 잡을 때 쓰는 동작은 넣지 않는다.
  const app = ['AppLinks', 'AppScale', 'DebugTools', 'MainForm', 'Notifications', 'PopupWindow', 'Program', 'Support', 'Updates'].map((name) => read(`${name}.cs`)).join('\n');
  assert.doesNotMatch(app, /WScript|CreateShortcut|GetTypeFromProgID|\.lnk/, 'no script-host shortcuts');
  assert.doesNotMatch(app, /AllowSetForegroundWindow\(-1|AnyProcess/, 'only the running FeedEx may take the foreground');
  assert.doesNotMatch(app, /CurrentVersion\\\\Run|Startup\)/, 'nothing starts with Windows');
  assert.match(support, /if \(existing\?\.GetValue\(""\) as string == command\) return;/, 'the link is not rewritten on every launch');
  assert.match(support, /new PipeAccessRule\(WindowsIdentity\.GetCurrent\(\)\.User, PipeAccessRights\.ReadWrite, AccessControlType\.Allow\)/, 'only this user can pass links to the running app');
  assert.match(read('DebugTools.cs'), /FEEDEX_DEBUG_DIR/);
  const updates = read('Updates.cs');
  assert.ok(updates.indexOf('UpdateSignature.Verify(') < updates.indexOf('Updater.Download('), 'nothing is downloaded before the signature checks out');
  assert.ok(updates.indexOf('Updater.CheckVersion(') < updates.indexOf('Updater.Install('), 'the new app version is checked before files are replaced');
  assert.match(form, /if \(debug != null\)[\s\S]*?home\.Scheme == Uri\.UriSchemeHttp && \(home\.Host == "127\.0\.0\.1" \|\| home\.Host == "localhost"\)[\s\S]*?FEEDEX_DEBUG_UPDATE_KEY/, 'a test key is only used by the debug build against this computer');
  assert.match(form, /core\.Settings\.IsZoomControlEnabled = false;\s*core\.ContentLoading \+= \(sender, args\) => KeepAppScale\(\);/, 'WebView2 resets zoom on each load, so the app scale is applied again');

  // 주소·로그인·배율 규칙은 .NET이 있으면 그대로 돌려 본다.
  const dotnet = spawnSync('dotnet', ['--version'], { encoding: 'utf8' });
  let ran = false;
  if (dotnet.status === 0) {
    const result = spawnSync('dotnet', ['run', '--project', 'native/windows/Tests/Tests.csproj', '--nologo'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /PASS: Windows app links/);
    ran = true;
  }
  console.log(`PASS: Windows app bridge detection and channels, numbered notification replies, Windows wording in settings, sign-in and hand-off with state, install dialog with the Windows app first and a one-line browser app, small versioned zip with matching update info and source fingerprint, message origin and sign-in state checks in the app, opening the installed Slap app${ran ? ', C# link/sign-in/scale rules' : ''}.`);
} finally {
  for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  await vite.close();
}
