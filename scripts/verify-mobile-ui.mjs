import assert from 'node:assert/strict';
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
  const { framedCopy } = await vite.ssrLoadModule('/src/client/mobile.ts');
  assert.match(framedCopy('<!doctype html><html lang="ko"><head><base href="https://site.example.test/"></head><body></body></html>'), /^<!doctype html><html lang="ko"><style>html,body\{overflow-x:hidden!important\}<\/style><meta http-equiv="Content-Security-Policy" content="script-src 'nonce-sfeed-scroll'"><script nonce="sfeed-scroll">/, 'the copy never pans sideways, and its policy comes before any page script');
  assert.ok(framedCopy('<p>bare</p>').startsWith('<style>'));
  assert.match(framedCopy('<p>bare</p>'), /sfeedSqueezed/, 'a copy laid out for a desktop says so');

  const { MobileLibrary } = await vite.ssrLoadModule('/src/components/MobileLibrary.tsx');
  const { MobileSettings, MobileHeader } = await vite.ssrLoadModule('/src/components/MobileChrome.tsx');
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
  assert.match(header({ sort: 'oldest' }), /class="feedex-mobile-sort"[^>]*aria-label="정렬: 오래된순, 최신순으로 전환"[\s\S]*?<span>오래된순<\/span><\/button><details[^>]*feedex-mobile-settings/, 'a list shows its current order as a button just left of the settings');
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
  console.log('PASS: one filtered library entry, correct counts, context-specific settings, shared persistent text size, scroll direction thresholds, edge bounce and focused-input handling.');
} finally { await vite.close(); }
