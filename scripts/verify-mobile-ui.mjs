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
    assert.match(options, /\{phoneShare && <button[^\n]*다른 앱으로 공유<\/button>\}\s*<button[^>]*>.*링크 복사/, 'on phones other apps come first');
    assert.equal(options.match(/다른 앱으로 공유/g).length, 1, 'desktops do not list other apps at the bottom');
    for (const label of ['링크 복사', 'Slap에 공유', 'X에 공유', 'Threads에 공유', '텔레그램으로 공유', '이메일로 공유']) assert.ok(options.includes(label), label);
    assert.match(options, /<button type="button"[^\n]+links\.x[^\n]+X에 공유<\/button>/, 'the X action survives social share link filters');
    assert.match(options, /<button type="button"[^\n]+links\.telegram[^\n]+텔레그램으로 공유<\/button>/, 'the Telegram action survives social share link filters');
    for (const label of ['제목과 링크 복사', '요약과 함께 복사']) assert.ok(!drawerSource.includes(label), `${label} is not offered`);
    // 시스템 공유는 누른 순간 메뉴를 닫기 전에 연다. 열지 못하면 링크를 복사해 둔다.
    const device = drawerSource.slice(drawerSource.indexOf('const shareWithDevice = (close: () => void) => {'), drawerSource.indexOf('const shareOptions = (close'));
    assert.ok(device.indexOf('navigator.share(') < device.indexOf('close();'), 'the system share opens before the menu closes');
    assert.match(device, /AbortError'\) return;\s*if \(shownArticleId\.current === article\.id\) onCopyLink\(article\);/, 'a share that cannot open copies the link instead');
    assert.match(options, /\{nativePlatform\(\) !== 'mac' && <a className=\{option\} href=\{links\.email\}/, 'the Mac app, which cannot open mail links, hides e-mail sharing');
  }
  assert.match(framedCopy('<!doctype html><html lang="ko"><head><base href="https://site.example.test/"></head><body></body></html>'), /^<!doctype html><html lang="ko"><style>html,body\{overflow-x:hidden!important\}[^<]*<\/style><meta http-equiv="Content-Security-Policy" content="script-src 'nonce-sfeed-scroll'"><script nonce="sfeed-scroll">/, 'the copy document stays in place, and its policy comes before any page script');
  assert.ok(framedCopy('<p>bare</p>').startsWith('<style>'));
  assert.match(framedCopy('<p>bare</p>'), /sfeedSqueezed/, 'a copy laid out for a desktop says so');
  // 사본에는 사이트 스크립트가 없어 고정 머리말이 글 위에 붙어 따라온다. 고정 요소를 문서와 함께 스크롤되게 푼다.
  assert.ok(framedCopy('<p>bare</p>').includes(UNPIN_SCRIPT), 'every copy unpins fixed and sticky parts');
  {
    const element = (position) => { const set = {}; return { position, set, style: { setProperty: (name, value, priority) => { set[name] = `${value}${priority ? ' !' + priority : ''}`; } } }; };
    const header = element('fixed'), sideNav = element('sticky'), text = element('static'), card = element('relative');
    const listeners = [];
    const unpin = new Function('document', 'getComputedStyle', 'addEventListener', `${UNPIN_SCRIPT}return sfeedUnpin;`)(
      { body: { getElementsByTagName: () => [header, sideNav, text, card] } }, (e) => ({ position: e.position }), (type) => listeners.push(type));
    assert.deepEqual(listeners, ['DOMContentLoaded', 'load'], 'unpinning runs once the page is read and again after it loads');
    unpin();
    assert.deepEqual(header.set, { position: 'absolute !important' }, 'a fixed header stays at the top of the document and scrolls away');
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
  assert.match(drawer, /const barsHidden = !mobileMenu && \(chromeHidden \|\| \(framed && !peek\)\)/, 'an open menu keeps the bars visible over a framed site');
  // 위쪽 ... 메뉴의 첫 항목은 AI 요약이다.
  assert.match(drawer, /aria-label="본문 도구">\s*(?:\{\/\*[^]*?\*\/\}\s*)?<button aria-pressed=\{aiOpen\} onClick=\{\(\) => \{ closeMobileMenu\(\); toggleAiSummary\(\); \}\}>/, 'the top more menu offers the AI summary first');
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
  assert.match(drawer, /<span className="min-w-0 flex-1 truncate">[^\n]*피드 본문만 번역[^\n]*<\/span>/, 'the translation label can shrink to fit one line on phones');
  // 휴대폰 시작: 로그인한 앱은 구글 로그인 스크립트를 받지 않고, 로그인 화면은 버튼이 첫 화면에 오게 긴 소개를 접는다.
  assert.doesNotMatch(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), /<script[^>]*accounts\.google\.com\/gsi\/client/, 'the app shell no longer loads Google sign-in for signed-in people');
  const loginView = readFileSync(new URL('../src/components/LoginView.tsx', import.meta.url), 'utf8');
  assert.match(loginView, /script\.src = 'https:\/\/accounts\.google\.com\/gsi\/client';[\s\S]*?loadGsi\(\);\s*tryInitGsi\(\);/, 'the login screen loads Google sign-in itself');
  assert.match(loginView, /<p className="hidden lg:block /, 'phones skip the long intro'); assert.match(loginView, /<div className="hidden lg:grid /, 'phones skip the feature cards');
  const installCard = readFileSync(new URL('../src/components/PwaInstall.tsx', import.meta.url), 'utf8');
  assert.match(installCard, /aria-label="설치 안내 하루 동안 숨기기"[^>]*className="[^"]*h-10 w-10/, 'the install card close button is finger sized');
  console.log('PASS: one filtered library entry, correct counts, context-specific settings, shared persistent text size, scroll direction thresholds, edge bounce, focused-input handling a brief bar peek after a framed site loads, Korean word wrapping, no keyboard pop in the exclusion dialog, a notch-safe swipe-to-close photo viewer, a one-line translation bar, readable selected text in both themes, share links, phone-only system sharing that falls back to copying, a clipboard fallback, site headers in web copies that scroll away instead of following, and the AI summary in the top more menu.');
} finally { await vite.close(); }
