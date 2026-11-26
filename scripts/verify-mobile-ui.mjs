import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
try {
  const { scrollChrome } = await vite.ssrLoadModule('/src/client/mobile.ts');
  let position = { top: 0, travel: 0, hidden: false };
  for (const top of [7, 14, 22, 30, 38]) position = scrollChrome(position, top, 400);
  assert.equal(position.hidden, true, 'slow downward motion hides the bars');
  position = scrollChrome(position, 35, 400);
  assert.equal(position.hidden, true, 'tiny changes do not flicker');
  position = scrollChrome(position, 20, 400);
  assert.equal(position.hidden, false, 'upward scrolling reveals the bars');
  position = scrollChrome({ top: 400, travel: 80, hidden: true }, 460, 400);
  position = scrollChrome(position, 400, 400);
  assert.equal(position.hidden, true, 'bottom rubber-banding must not reveal chrome');
  assert.equal(scrollChrome(position, 420, 400, true).hidden, false, 'settings and input focus keep controls visible');
  assert.equal(scrollChrome(position, -30, 400).hidden, false);
  const { framedCopy, UNPIN_SCRIPT } = await vite.ssrLoadModule('/src/client/mobile.ts');
  // 공유: 공유 사이트 주소, 붙여 넣을 글, 복사가 막힐 때의 대체 방법, 메뉴 순서.
  {
    const { shareLinks, copyText } = await vite.ssrLoadModule('/src/client/share.ts');
    const shared = { title: 'Bitcoin & ETF 소식', url: 'https://news.example.test/a?b=1&c=2' };
    const links = shareLinks(shared);
    const slap = new URL(links.slap), slapShare = new URLSearchParams(slap.hash.slice(1));
    assert.equal(slap.origin, 'https://slap.jyk.workers.dev');
    assert.equal(slap.searchParams.get('share'), '1');
    assert.equal(slapShare.get('share'), shared.url); assert.equal(slapShare.get('title'), shared.title);
    const { grokLink } = await vite.ssrLoadModule('/src/client/share.ts');
    const grok = new URL(grokLink(shared.url, false));
    assert.equal(grok.origin, 'https://grok.com'); assert.equal(grok.searchParams.get('q'), shared.url, 'Ask Grok fills only the link');
    const grokPhone = new URL(grokLink(shared.url, true), 'https://feedex.example');
    assert.equal(grokPhone.pathname, '/grok.html', 'phones go through the forwarding page'); assert.equal(grokPhone.searchParams.get('q'), shared.url);
    // 홈 화면 앱의 공유 창: 다른 앱에 다녀와 돌아오면 닫고, 그냥 다시 보이기만 하면 그대로 둔다. 연 사이트와의 연결(opener)은 끊는다.
    const { openClosingOnReturn } = await vite.ssrLoadModule('/src/client/share.ts');
    const sheetWindow = () => { const listeners = []; const sheet = { opener: 'app', closed: false, close() { sheet.closed = true; } };
      const win = { document: { visibilityState: 'visible', addEventListener: (_, fn) => listeners.push(fn), removeEventListener: (_, fn) => listeners.splice(listeners.indexOf(fn), 1) }, open: () => sheet, setTimeout: () => 0 };
      const fire = (state) => { win.document.visibilityState = state; [...listeners].forEach((fn) => fn()); };
      return { win, sheet, fire, listeners }; };
    const shared1 = sheetWindow(); assert.equal(openClosingOnReturn('https://grok.com/', shared1.win), true); assert.equal(shared1.sheet.opener, null, 'the opened site cannot reach the app');
    shared1.fire('visible'); assert.equal(shared1.sheet.closed, false, 'the sheet stays while the app never left');
    shared1.fire('hidden'); shared1.fire('visible'); assert.equal(shared1.sheet.closed, true, 'coming back from another app closes the blank sheet'); assert.equal(shared1.listeners.length, 0);
    const blocked = sheetWindow(); blocked.win.open = () => null; assert.equal(openClosingOnReturn('https://grok.com/', blocked.win), false);
    // Grok: 홈 화면 앱은 피드엑스 페이지를 떠나지 않고 잠깐 뒤 grok.com으로 넘긴다(중간 페이지가 피드엑스를 대신하지 않게).
    const { openGrok, tookExternalTrip } = await vite.ssrLoadModule('/src/client/share.ts');
    const { askLink } = await vite.ssrLoadModule('/src/client/share.ts');
    // 공유 메뉴 편집: 저장한 순서대로, 저장한 적 없는 항목은 원래 순서로 뒤에. 새 AI 항목은 처음엔 숨긴다.
    const { orderShareItems, readShareMenu, saveShareMenu } = await vite.ssrLoadModule('/src/client/shareMenu.ts');
    const shareItems = ['copy-link', 'slap', 'x', 'grok', 'chatgpt'].map((id) => ({ id }));
    assert.deepEqual(orderShareItems(shareItems, ['x', 'copy-link']).map((item) => item.id), ['x', 'copy-link', 'slap', 'grok', 'chatgpt']);
    const memoryStore = new Map(); const store = { getItem: (key) => memoryStore.get(key) ?? null, setItem: (key, value) => memoryStore.set(key, value) };
    assert.deepEqual(readShareMenu(store).hidden, ['chatgpt', 'claude', 'gemini'], 'new AI shortcuts start hidden so the menu looks the same');
    saveShareMenu({ order: ['grok', 'x'], hidden: ['slap'] }, store); assert.deepEqual(readShareMenu(store), { order: ['grok', 'x'], hidden: ['slap'] });
    assert.equal(new URL(askLink('chatgpt', shared.url, false)).origin, 'https://chatgpt.com', 'Ask ChatGPT opens chatgpt.com');
    const chatPhone = new URL(askLink('chatgpt', shared.url, true), 'https://feedex.example');
    assert.equal(new URL(askLink('claude', shared.url, false)).href.startsWith('https://claude.ai/new?q='), true, 'Ask Claude opens a new Claude chat');
    assert.equal(new URL(askLink('claude', shared.url, true), 'https://feedex.example').searchParams.get('to'), 'claude');
    const gemini = new URL(askLink('gemini', shared.url, false));
    assert.equal(gemini.origin, 'https://gemini.google.com'); assert.equal(gemini.searchParams.get('prompt'), shared.url, 'Gemini takes the link as prompt'); assert.equal(gemini.searchParams.has('q'), false);
    assert.equal(chatPhone.pathname, '/grok.html'); assert.equal(chatPhone.searchParams.get('to'), 'chatgpt'); assert.equal(chatPhone.searchParams.get('q'), shared.url);
    const grokWindow = () => { const w = { opened: [], timers: [], location: { href: 'https://feedex.example/' }, open(url) { w.opened.push(url); return null; }, setTimeout(fn) { w.timers.push(fn); return 1; } }; return w; };
    const home = grokWindow(); openGrok(shared.url, true, true, home);
    assert.equal(home.opened.length, 0, 'the home screen app does not open the forwarding page over FeedEx'); home.timers[0]();
    assert.equal(home.location.href, `https://grok.com/?q=${encodeURIComponent(shared.url).replace(/%20/g, '+')}`);
    assert.equal(tookExternalTrip(), true, 'coming back from Grok keeps the read rows'); assert.equal(tookExternalTrip(), false, 'the trip is reported once');
    const browserPhone = grokWindow(); openGrok(shared.url, true, false, browserPhone); assert.match(browserPhone.opened[0], /^\/grok\.html\?q=/);
    const desk = grokWindow(); openGrok(shared.url, false, false, desk); assert.match(desk.opened[0], /^https:\/\/grok\.com\/\?q=/); tookExternalTrip();
    const telegramApp = new URL(links.telegramApp);
    assert.equal(telegramApp.protocol, 'tg:'); assert.equal(telegramApp.searchParams.get('url'), shared.url); assert.equal(telegramApp.searchParams.get('text'), shared.title);
    // Slap 앱: 데스크톱은 전용 주소(web+slap:)로 설치한 앱을 연다. 아이폰·아이패드 홈 화면 앱은 링크로 열 수 없다.
    // 아이폰 상단 누르기: 문서를 1px 스크롤되게 두고, 손가락 없이 0으로 올라간 것만 상단 누르기로 본다.
    const { isStatusBarTap } = await vite.ssrLoadModule('/src/client/statusBarTap.ts');
    assert.equal(isStatusBarTap(0, false, 5000), true, 'a scroll to 0 with no finger is a status bar tap');
    assert.equal(isStatusBarTap(0, true, 0), false, 'a finger dragging the page is not a status bar tap');
    assert.equal(isStatusBarTap(0, false, 200), false, 'momentum right after a swipe is not a status bar tap');
    assert.equal(isStatusBarTap(1, false, 5000), false, 'the parked page is not a status bar tap');
    const { deferRows } = await vite.ssrLoadModule('/src/client/mobileScrollRecovery.ts');
    assert.equal(deferRows(200, false), true, 'long lists defer offscreen rows on other browsers');
    assert.equal(deferRows(200, true), false, 'iOS keeps every row rendered so scrolling up does not jump');
    assert.equal(deferRows(50, false), false, 'short lists render every row');
    assert.match(readFileSync('src/index.css', 'utf8'), /html\.feedex-status-tap body \{ min-height: calc\(100dvh \+ 1px\); \}/);
    assert.match(readFileSync('src/App.tsx', 'utf8'), /useStatusBarTap\(articleListRef, /, 'the article list returns to the top');
    assert.match(readFileSync('src/components/ArticleDrawer.tsx', 'utf8'), /useStatusBarTap\(bodyRef, /, 'the reader returns to the top');
    const { slapAppLink, isAppleTouch, openAppLink } = await vite.ssrLoadModule('/src/client/share.ts');
    const appLink = new URL(slapAppLink(shared));
    assert.equal(appLink.protocol, 'web+slap:'); assert.equal(appLink.searchParams.get('url'), shared.url); assert.equal(appLink.searchParams.get('title'), shared.title);
    assert.equal(isAppleTouch('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5), true);
    assert.equal(isAppleTouch('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), true, 'an iPad looks like a Mac but has touch');
    assert.equal(isAppleTouch('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0), false);
    assert.equal(isAppleTouch('Mozilla/5.0 (Linux; Android 14; Pixel 8)', 5), false);
    const fakeWindow = () => {
      const handlers = {}, timers = [], add = (type, fn) => { handlers[type] = fn; }, remove = (type) => { delete handlers[type]; };
      return { handlers, timers, location: { href: '' }, addEventListener: add, removeEventListener: remove, document: { addEventListener: add, removeEventListener: remove }, setTimeout: (fn) => { timers.push(fn); return 1; } };
    };
    let missed = 0;
    const opened = fakeWindow(); openAppLink('web+slap:share?url=x', () => missed++, opened);
    assert.equal(opened.location.href, 'web+slap:share?url=x'); opened.handlers.blur(); opened.timers[0]();
    assert.equal(missed, 0, 'the app opened, so the window lost focus and nothing is said');
    assert.equal(opened.handlers.blur, undefined, 'the focus watch is removed afterwards');
    const notOpened = fakeWindow(); openAppLink('web+slap:share?url=x', () => missed++, notOpened); notOpened.timers[0]();
    assert.equal(missed, 1, 'nothing took the address, so the reader is told instead of opening a second tab');
    assert.equal(new URL(links.x).searchParams.get('url'), shared.url); assert.equal(new URL(links.x).searchParams.get('text'), shared.title);
    assert.equal(new URL(links.telegram).origin, 'https://t.me'); assert.equal(new URL(links.telegram).searchParams.get('url'), shared.url);
    assert.equal(new URL(links.threads).origin, 'https://www.threads.com');
    assert.equal(new URL(links.threads).searchParams.get('text'), `${shared.title}\n${shared.url}`, 'Threads gets the title and the address');
    assert.ok(links.email.startsWith('mailto:?subject=')); assert.equal(decodeURIComponent(links.email.split('&body=')[1]), `${shared.title}\n${shared.url}`, 'the e-mail body carries the title too');
    const saved = { navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'), document: Object.getOwnPropertyDescriptor(globalThis, 'document') };
    try {
      let written = '', fallback = '', focused = 0;
      const area = { style: {}, setAttribute() {}, select() { fallback = this.value; }, remove() {} };
      Object.defineProperty(globalThis, 'document', { configurable: true, value: { activeElement: { focus: () => focused++ }, createElement: () => area, body: { appendChild() {} }, execCommand: (command) => command === 'copy' } });
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async (text) => { written = text; } } } });
      assert.equal(await copyText('one'), true); assert.equal(written, 'one');
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async () => { throw new Error('denied'); } } } });
      assert.equal(await copyText('two'), true, 'a blocked clipboard falls back to copying a hidden selection'); assert.equal(fallback, 'two'); assert.equal(focused, 1, 'focus returns to where it was');
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
      document.execCommand = () => false;
      assert.equal(await copyText('three'), false, 'a failed copy is reported');
    } finally {
      for (const [key, value] of Object.entries(saved)) if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key];
    }
    const drawerSource = readFileSync(new URL('../src/components/ArticleDrawer.tsx', import.meta.url), 'utf8');
    const options = drawerSource.slice(drawerSource.indexOf('const shareOptions = (close: () => void) => {'), drawerSource.indexOf('return (\n    <div className="feedex-article-reader'));
    // 다른 앱으로 공유는 휴대폰(터치 화면)에서만 맨 위에 둔다. 컴퓨터의 시스템 공유는 이메일 정도만 떠서 쓸모가 없다.
    assert.match(options, /const phoneShare = isMobile && [^;]*navigator\.share === 'function'[^;]*\(pointer: coarse\)/, 'other apps appear only on touch phones');
    assert.match(options, /phoneShare && \{ id: 'device'[^\n]*\n[^\n]*shareWithDevice[^\n]*\n\s*\{ id: 'copy-link'/, 'on phones other apps come first');
    assert.equal(options.match(/다른 앱으로 공유/g).length, 2, 'other apps appear only in the phone-only entry (its label and its button)');
    for (const label of ['Copy link', 'Share to Slap', 'Share to X', 'Ask Grok', 'Share to Threads', 'Share to Telegram', 'Share by email']) assert.ok(options.includes(label), label);
    assert.match(options, /<button type="button"[^\n]+openShareLink\(links\.x, close\)[^\n]+<\/button>/, 'the X action survives social share link filters');
    assert.match(options, /<button type="button"[^\n]+shareToTelegram\(links, close\)[^\n]+<\/button>/, 'the Telegram action survives social share link filters');
    assert.match(drawerSource, /openAppLink\(links\.telegramApp, \(\) => \{[^\n]*openClosingOnReturn\(links\.telegram\)/, 'iPhone opens the Telegram app directly and falls back to t.me');
    assert.match(drawerSource, /opensOriginalSeparately\(\)\) \{[^}]*openClosingOnReturn\(url\)/, 'home screen share links close their blank sheet on return');
    for (const label of ['제목과 링크 복사', '요약과 함께 복사']) assert.ok(!drawerSource.includes(label), `${label} is not offered`);
    // 시스템 공유는 누른 순간 메뉴를 닫기 전에 연다. 열지 못하면 링크를 복사해 둔다.
    const device = drawerSource.slice(drawerSource.indexOf('const shareWithDevice = (close: () => void) => {'), drawerSource.indexOf('const shareOptions = (close'));
    assert.ok(device.indexOf('navigator.share(') < device.indexOf('close();'), 'the system share opens before the menu closes');
    assert.match(device, /AbortError'\) return;\s*if \(shownArticleId\.current === article\.id\) onCopyLink\(article\);/, 'a share that cannot open copies the link instead');
    assert.match(options, /nativePlatform\(\) !== 'mac' && \{ id: 'email'[^\n]*\n[^\n]*href=\{links\.email\}/, 'the Mac app, which cannot open mail links, hides e-mail sharing');
    // Slap에 공유: 먼저 같은 이메일 앞으로 Slap에 맡기고, 기기에 맞게 연다.
    const slapFlow = drawerSource.slice(drawerSource.indexOf('const shareToSlap = async'), drawerSource.indexOf('const shareOptions = (close'));
    assert.match(slapFlow, /apiRequest<\{ ok: boolean \}>\(`\/api\/articles\/\$\{article\.id\}\/slap`/, 'the article is left in Slap first');
    assert.ok(slapFlow.indexOf('/slap`') < slapFlow.indexOf('bridge.postMessage'), 'desktop apps open Slap only after the article is left');
    assert.match(slapFlow, /nativeFeatures\(\)\.includes\('openSlap'\) \? \{ type: 'openSlap', url: app, fallback: web \} : \{ type: 'openExternal', url: web \}/, 'new desktop apps open the Slap app, older ones the browser');
    // 아이폰·아이패드는 누른 순간 링크 그대로 사파리에서 Slap 공유 창을 연다(기다린 뒤 열면 막힌다).
    assert.match(slapFlow, /const appleTouch = !bridge && isAppleTouch\(navigator\.userAgent, navigator\.maxTouchPoints\);\s*if \(!appleTouch\) linkEvent\.preventDefault\(\);/, 'iPhone and iPad follow the Slap link to Safari right away');
    assert.match(slapFlow, /if \(appleTouch\) return;/, 'iPhone and iPad still leave the article for the home-screen app');
    assert.match(slapFlow, /openAppLink\(app, \(\) => onNotice\(/, 'desktop browsers open the installed app through web+slap:');
    assert.match(options, /onClick=\{\(event\) => void shareToSlap\(close, event\)\}/);
  }
  assert.match(framedCopy('<!doctype html><html lang="ko"><head><base href="https://site.example.test/"></head><body></body></html>'), /^<!doctype html><html lang="ko"><style>html,body\{overflow-x:hidden!important\}[^<]*<\/style><meta http-equiv="Content-Security-Policy" content="script-src 'nonce-sfeed-scroll'"><script nonce="sfeed-scroll">/, 'the copy document stays in place, and its policy comes before any page script');
  assert.ok(framedCopy('<p>bare</p>').startsWith('<style>'));
  assert.match(framedCopy('<p>bare</p>'), /sfeedSqueezed/, 'a copy laid out for a desktop says so');
  // 사본에는 사이트 스크립트가 없어 고정 머리말이 글 위에 붙어 따라온다. 고정 요소를 문서와 함께 스크롤되게 푼다.
  assert.ok(framedCopy('<p>bare</p>').includes(UNPIN_SCRIPT), 'every copy unpins fixed and sticky parts');
  {
    const element = (position, overflowX = 'visible') => { const set = {}; return { position, overflowX, set, style: { setProperty: (name, value, priority) => { set[name] = `${value}${priority ? ' !' + priority : ''}`; } } }; };
    const header = element('fixed'), menu = element('fixed', 'auto'), sideNav = element('sticky'), text = element('static'), card = element('relative');
    const listeners = [];
    const unpin = new Function('document', 'getComputedStyle', 'addEventListener', `${UNPIN_SCRIPT}return sfeedUnpin;`)(
      { body: { getElementsByTagName: () => [header, menu, sideNav, text, card] } }, (e) => ({ position: e.position, overflowX: e.overflowX }), (type) => listeners.push(type));
    assert.deepEqual(listeners, ['DOMContentLoaded', 'load'], 'unpinning runs once the page is read and again after it loads');
    unpin();
    // 고정 요소 안에서 화면 밖으로 삐져나온 장식이 문서를 넓히면 iOS가 사본을 좌우로 흔든다.
    assert.deepEqual(header.set, { position: 'absolute !important', 'overflow-x': 'clip !important' }, 'a fixed header stays at the top of the document and scrolls away without widening it');
    assert.deepEqual(menu.set, { position: 'absolute !important' }, 'a fixed part that scrolls sideways itself keeps scrolling');
    assert.deepEqual(sideNav.set, { position: 'relative !important', top: 'auto !important', bottom: 'auto !important' }, 'a sticky bar stays in its place in the page');
    assert.deepEqual(text.set, {}); assert.deepEqual(card.set, {}, 'other parts are left alone');
  }

  const { MobileLibrary } = await vite.ssrLoadModule('/src/components/MobileLibrary.tsx');
  const { MobileSettingsContent: MobileSettings, MobileHeader } = await vite.ssrLoadModule('/src/components/MobileChrome.tsx');
  const settings = { theme: 'dark', layout: 'magazine', markReadOnScroll: false, autoRefreshMinutes: 15, onChangeAutoRefreshMinutes() {}, onChangeMarkReadOnScroll() {}, onChangeTheme() {}, onChangeLayout() {}, onOpenOpml() {} };
  const props = { ...settings, user: { id: 'test', name: 'Test', email: 'mobile@example.test' }, folders: [], subscriptions: [], counts: { totalArticles: 123, totalUnread: 24, savedCount: 7 }, onChangeCountTab() {}, onSelectTab() {}, onSelectFolder() {}, onSelectFeed() {}, onAdd() {}, onRefresh() {}, refreshing: false, onCreateFolder() {}, onDeleteFolder() {}, onUnsubscribe() {}, onLogout() {} };
  for (const [countTab, count] of [['all', 123], ['unread', 24], ['saved', 7]]) {
    const html = renderToStaticMarkup(React.createElement(MobileLibrary, { ...props, countTab }));
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert.ok(text.includes(`전체 글 ${count}`), text);
    assert.equal((text.match(/전체 글/g) ?? []).length, 1);
    assert.ok(!text.includes('안 읽은 글') && !text.includes('저장한 글'));
  }
  const library = renderToStaticMarkup(React.createElement(MobileSettings, { ...settings, library: true }));
  assert.ok(!library.includes('매거진 뷰') && !library.includes('목록 보기'));
  assert.ok(!library.includes('type="range"') && !library.includes('%'));
  assert.match(library, /글자 작게/); assert.match(library, /글자 크게/); assert.ok(!library.includes('스크롤 시 읽음 처리')); assert.match(library, /자동 새로고침/);
  assert.ok(!renderToStaticMarkup(React.createElement(MobileSettings, { ...settings, sort: 'newest', onChangeSort() {}, library: true })).includes('오래된순'), 'the library has no article order');
  const list = renderToStaticMarkup(React.createElement(MobileSettings, settings));
  assert.match(list, /매거진 뷰/);
  assert.ok(!renderToStaticMarkup(React.createElement(MobileSettings, { ...settings, sort: 'oldest', onChangeSort() {} })).includes('오래된순'), 'the article order is not hidden in the settings menu');
  const header = (fields) => renderToStaticMarkup(React.createElement(MobileHeader, { ...settings, title: 'X', search: '', onSearch() {}, onAdd() {}, onChangeSort() {}, ...fields }));
  for (const library of [false, true]) {
    assert.doesNotMatch(header({ library, syncStatus: { online: true, failed: false } }), /feedex-mobile-sync-status/);
    assert.match(header({ library, syncStatus: { online: true, failed: true } }), /새로고침 실패/);
    assert.match(header({ library, syncStatus: { online: false, failed: false } }), /오프라인/);
  }
  assert.match(header({ sort: 'oldest' }), /class="feedex-mobile-sort"[^>]*aria-label="정렬: 오래된순, 최신순으로 전환"[\s\S]*?<span>오래된순<\/span><\/button><div[^>]*feedex-mobile-settings/, 'a list shows its current order as a button just left of the settings');
  assert.match(header({ sort: 'newest' }), /<span>최신순<\/span>/);
  assert.ok(!header({ sort: 'newest', library: true }).includes('feedex-mobile-sort'), 'the library has no article order button');
  assert.match(list, /스크롤 시 읽음 처리/); assert.match(list, /자동 새로고침/);
  // 이름만으로 알 수 있는 설정은 설명 줄 없이 한 줄로 두고, 읽기와 새 글 설정은 한 묶음에 둔다.
  assert.match(list, /title="위로 지나간 글을 읽음으로 표시해요"><span class="feedex-setting-label">.*<span>스크롤 시 읽음 처리<\/span><\/span><input/, 'the scroll setting explains itself only on hover');
  assert.match(list, /title="바뀐 내용만 가볍게 확인해요"><span class="feedex-setting-label">.*<span>자동 새로고침<\/span><\/span><select/, 'the refresh setting explains itself only on hover');
  assert.doesNotMatch(list, /aria-label="새 글"/, 'reading and new-article settings share one group');
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new Map([['sfeed_font_scale', '1.2']]);
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) } });
    const { readTextSize, setTextSize } = await vite.ssrLoadModule('/src/client/textSize.ts');
    assert.equal(readTextSize(), 1.2, 'existing reader size is retained');
    setTextSize(1.35); assert.equal(storage.get('sfeed_font_scale'), '1.35');
    setTextSize(20); assert.equal(readTextSize(), 1.35, 'invalid sizes cannot break layout');
    setTextSize(1);
  } finally { if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage); else delete globalThis.localStorage; }
  // 사이트를 그대로 띄운 웹 보기는 다 불러온 순간 막대를 잠깐 보여 준 뒤 접는다.
  const drawer = readFileSync(new URL('../src/components/ArticleDrawer.tsx', import.meta.url), 'utf8');
  assert.match(drawer, /useLayoutEffect\(\(\) => \{ if \(framed\) setPeek\(\(value\) => value \+ 1\); \}, \[framed\]\);/, 'a loaded site keeps its bars for a moment before folding');
  assert.match(drawer, /setTimeout\(\(\) => setPeek\(0\), PEEK_MS\)/, 'the bars fold again once the peek ends');
  assert.match(drawer, /const barsHidden = !mobileMenu && !peek && \(chromeHidden \|\| framed\)/, 'an open menu keeps the bars visible, and tapping the folded pill unfolds them however they folded');
  assert.match(drawer, /if \(chromeHidden && !wasChromeHidden\.current && !framed\) setPeek\(0\);/, 'scrolling down again folds the unfolded bars back into the pill');
  // 밀어서 뒤로 가는 동안 막대를 없애면(display:none) 위쪽 높이가 0으로 재어져 원본 사이트의 뒤로 가기가 끊긴다.
  assert.match(readFileSync(new URL('../src/index.css', import.meta.url), 'utf8'), /:has\(\.feedex-web-pager\[data-sliding\]\)[^{]*\{ visibility: hidden !important; transition: none !important; \}/, 'bars are only hidden, not removed, while sliding back');
  assert.match(drawer, /const measure = \(\) => \{ if \(!top\.offsetHeight\) return;/, 'a bar measured at zero height does not move the site');
  // 위쪽 ... 메뉴의 첫 항목은 AI 요약이다.
  assert.match(drawer, /className="feedex-mobile-reader-menu"[^\n]+>\s*(?:\{\/\*[^]*?\*\/\}\s*)?<button aria-pressed=\{aiOpen\} onClick=\{\(\) => \{ closeMobileMenu\(\); toggleAiSummary\(\); \}\}>/, 'the top more menu offers the AI summary first');
  // 휴대폰 다듬기: 한국어 줄바꿈, 피드 제외 창의 키보드, 사진 보기의 안전 영역과 아래로 밀어 닫기, 번역 띠 한 줄.
  const styles = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.match(styles, /body \{ word-break: keep-all; overflow-wrap: break-word; \}/, 'Korean lines break between words');
  // 선택한 글자는 밝은 화면에서도 보인다. 예전처럼 연한 초록 글자를 모든 화면에 고정하지 않는다.
  assert.match(styles, /::selection \{ background: #a7f3d0; color: #064e3b; \}/, 'selected text stays dark on the light theme');
  assert.match(styles, /html\.dark ::selection \{ background: #10b9814d; color: #d1fae5; \}/, 'selected text stays light on the dark theme');
  assert.doesNotMatch(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), /selection:text-/, 'no fixed selection text colour for every theme');
  const exclusions = readFileSync(new URL('../src/components/FeedExclusionsDialog.tsx', import.meta.url), 'utf8');
  assert.match(exclusions, /matchMedia\?\.\('\(pointer: coarse\)'\)\.matches\) ref\.current\?\.focus\(\{ preventScroll: true \}\);\s*else ref\.current\?\.querySelector\('input'\)\?\.focus\(\);/, 'phones do not pop the keyboard when the exclusion dialog opens');
  const viewer = readFileSync(new URL('../src/client/xPostFrame.ts', import.meta.url), 'utf8');
  assert.match(viewer, /height:calc\(52px \+ env\(safe-area-inset-top\)\)/, 'the photo viewer close button clears the notch');
  assert.match(viewer, /height:100dvh/); assert.match(viewer, /padding:8px 16px calc\(24px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(viewer, /else if \(dy > 90 && dy > Math\.abs\(dx\) \* 1\.5\) close\(\);/, 'a downward swipe closes the photo viewer');
  assert.match(drawer, /<span className="min-w-0 truncate">[^\n]*피드 본문만 번역[^\n]*<\/span>/, 'the translation label can shrink to fit one line on phones');
  // 휴대폰 시작: 로그인한 앱은 구글 로그인 스크립트를 받지 않고, 로그인 화면은 버튼이 첫 화면에 오게 긴 소개를 접는다.
  assert.doesNotMatch(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), /<script[^>]*accounts\.google\.com\/gsi\/client/, 'the app shell no longer loads Google sign-in for signed-in people');
  const loginView = readFileSync(new URL('../src/components/LoginView.tsx', import.meta.url), 'utf8');
  assert.match(loginView, /script\.src = 'https:\/\/accounts\.google\.com\/gsi\/client';[\s\S]*?loadGsi\(\);\s*tryInitGsi\(\);/, 'the login screen loads Google sign-in itself');
  assert.match(loginView, /<p className="hidden lg:block /, 'phones skip the long intro'); assert.match(loginView, /<div className="hidden lg:grid /, 'phones skip the feature cards');
  const installCard = readFileSync(new URL('../src/components/PwaInstall.tsx', import.meta.url), 'utf8');
  assert.match(installCard, /onClick=\{prompt\.dismiss\}[^>]*className="[^"]*h-10 w-10/, 'the install card close button is finger sized');
  console.log('PASS: one filtered library entry, correct counts, context-specific settings, shared persistent text size, scroll direction thresholds, edge bounce, focused-input handling a brief bar peek after a framed site loads, Korean word wrapping, no keyboard pop in the exclusion dialog, a notch-safe swipe-to-close photo viewer, a one-line translation bar, readable selected text in both themes, share links, Slap sharing that opens the installed app (or tells iPhone to open it), status bar taps that return iPhone lists and articles to the top, phone-only system sharing that falls back to copying, a clipboard fallback, site headers in web copies that scroll away instead of following, and the AI summary in the top more menu.');
} finally { await vite.close(); }
