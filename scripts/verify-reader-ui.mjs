import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const originals = Object.fromEntries(['localStorage', 'navigator', 'Notification'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
try {
  const values = new Map(), notifications = [];
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } });
  Object.defineProperty(globalThis, 'Notification', { configurable: true, value: { permission: 'granted', requestPermission: async () => 'granted' } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: { getRegistration: async () => ({ active: true, showNotification: async (title, options) => notifications.push({ title, options }) }) } } });
  const { setLocalNotifications, notifyNewArticles, localNotificationsEnabled } = await vite.ssrLoadModule('/src/client/localNotifications.ts');
  setLocalNotifications('owner', true);
  assert.equal(localNotificationsEnabled('owner'), true); assert.equal(localNotificationsEnabled('other'), false);
  const news = [{ id: 'a', feed_title: 'GeekNews (긱뉴스)', title: '새 글 제목' }];
  await notifyNewArticles('owner', [...news, ...news]); await notifyNewArticles('owner', news);
  assert.equal(notifications.length, 1, 'local device history and notification tags prevent duplicates');
  assert.equal(notifications[0].title, 'GeekNews (긱뉴스)'); assert.equal(notifications[0].options.body, '새 글 제목', 'feed name and article title appear on separate notification lines');
  assert.equal(notifications[0].options.data.account, 'owner');
  await notifyNewArticles('owner', [{ id: 'no-feed-name', feed_title: '  ', title: '피드명이 없는 글' }]);
  assert.equal(notifications[1].title, 'FeedEx'); assert.equal(notifications[1].options.body, '피드명이 없는 글');
  navigator.userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/156.0.0.0 Safari/537.36'; navigator.maxTouchPoints = 0;
  await notifyNewArticles('owner', [{ id: 'mac', feed_title: 'Decrypt', title: 'Bithumb Says Hackers Accessed Internal System' }]);
  assert.equal(notifications[2].title, 'Decrypt · Bithumb Says Hackers Accessed Internal System');
  assert.ok(!('body' in notifications[2].options), 'macOS origin attribution follows all article content instead of splitting feed and headline');
  navigator.maxTouchPoints = 5;
  await notifyNewArticles('owner', [{ id: 'ipad-desktop', feed_title: 'Decrypt', title: 'iPad article' }]);
  assert.equal(notifications[3].title, 'Decrypt'); assert.equal(notifications[3].options.body, 'iPad article', 'iPad desktop mode retains mobile notification formatting');
  navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15'; navigator.maxTouchPoints = 1;
  await notifyNewArticles('owner', [{ id: 'iphone', feed_title: 'Decrypt', title: 'iPhone article' }]);
  assert.equal(notifications[4].title, 'Decrypt'); assert.equal(notifications[4].options.body, 'iPhone article');
  setLocalNotifications('owner', false); await notifyNewArticles('owner', [{ id: 'b', title: 'Muted' }]); assert.equal(notifications.length, 5);
  setLocalNotifications('owner', true); await notifyNewArticles('owner', [{ id: 'c', title: 'Old session' }], undefined, () => false); assert.equal(notifications.length, 5, 'logout cancels late notifications');

  const { bindLongPress } = await vite.ssrLoadModule('/src/client/longPress.ts');
  const doc = new EventTarget(); let opened = 0;
  const target = { control: false, closest(selector) { return selector.startsWith('[data-') ? {} : this.control ? {} : null; } };
  const cleanup = bindLongPress(doc, () => opened++);
  const touch = (type, x, y, fingers = 1) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, { target: { value: target }, touches: { value: type === 'touchend' ? [] : Array.from({ length: fingers }, () => ({ clientX: x, clientY: y })) } });
    doc.dispatchEvent(event); return event;
  };
  touch('touchstart', 100, 200); await new Promise((resolve) => setTimeout(resolve, 480)); assert.equal(opened, 1);
  assert.equal(touch('touchend', 100, 200).defaultPrevented, true);
  const ghostClick = new Event('click', { cancelable: true }); doc.dispatchEvent(ghostClick); assert.equal(ghostClick.defaultPrevented, true, 'releasing a long press does not also open the article');
  const menuClick = new Event('click', { cancelable: true });
  Object.defineProperty(menuClick, 'target', { value: { closest: (selector) => selector === '.feedex-context-menu' ? {} : null } });
  doc.dispatchEvent(menuClick); assert.equal(menuClick.defaultPrevented, false, 'a menu item can be tapped immediately after a long press');
  touch('touchstart', 100, 200); touch('touchmove', 100, 230); await new Promise((resolve) => setTimeout(resolve, 480)); assert.equal(opened, 1, 'scrolling cancels a long press');
  target.control = true; touch('touchstart', 100, 200); target.control = false;
  cleanup(); await new Promise((resolve) => setTimeout(resolve, 480)); assert.equal(opened, 1);

  // 메뉴는 손가락 아래에 뜨므로 메뉴 글자를 고를 수 없어야 iOS 글자 선택이 이어지지 않는다.
  const css = readFileSync('src/index.css', 'utf8');
  const unselectable = (selector) => css.match(new RegExp(`(?:^|\\n)\\s*[^{}\\n]*${selector}[^{}\\n]*\\{[^}]*\\}`, 'g'))?.some((rule) => /-webkit-user-select: none/.test(rule) && /-webkit-touch-callout: none/.test(rule));
  assert.ok(unselectable('\\.feedex-context-menu'), 'the long-press menu text cannot be selected');
  assert.ok(unselectable('\\.feedex-web-status'), 'the web view status bar text cannot be selected');
  const { emptiesUnreadList } = await vite.ssrLoadModule('/src/client/mobile.ts');
  const list = { scope: 'folder', search: '' };
  assert.equal(emptiesUnreadList(list, true, false), true, 'reading a whole unread list leaves nothing to show');
  assert.equal(emptiesUnreadList(list, false, false), false, 'the all tab still shows the read articles');
  assert.equal(emptiesUnreadList(list, true, true), false, 'saved articles stay after reading');
  assert.equal(emptiesUnreadList({ ...list, scope: 'saved' }, true, false), false);
  assert.equal(emptiesUnreadList({ ...list, search: 'kim' }, true, false), false, 'search results keep the search open');
  assert.equal(emptiesUnreadList({ ...list, edge: { side: 'below' } }, true, false), false, 'reading part of a list leaves the rest');

  const { MobileLibrary } = await vite.ssrLoadModule('/src/components/MobileLibrary.tsx');
  const { Sidebar } = await vite.ssrLoadModule('/src/components/Sidebar.tsx');
  const shared = { user: { id: 'owner', name: 'Test' }, theme: 'light', layout: 'magazine', autoRefreshMinutes: 15, folders: [{ id: 'empty-folder', name: 'Zero folder' }, { id: 'unread-folder', name: 'Unread folder' }], subscriptions: [{ id: 'empty-sub', feed_id: 'empty', folder_id: 'empty-folder', title: 'Zero feed', total_count: 4, unread_count: 0, saved_count: 0 }, { id: 'unread-sub', feed_id: 'unread', folder_id: 'unread-folder', title: 'Unread feed', total_count: 3, unread_count: 1, saved_count: 0 }], counts: { totalArticles: 7, totalUnread: 1, savedCount: 0 } };
  const mobileUnread = renderToStaticMarkup(React.createElement(MobileLibrary, { ...shared, countTab: 'unread' }));
  assert.ok(!mobileUnread.includes('Zero folder') && !mobileUnread.includes('Zero feed')); assert.match(mobileUnread, /Unread folder/);
  const desktopUnread = renderToStaticMarkup(React.createElement(Sidebar, { ...shared, libraryTab: 'unread' }));
  assert.ok(!desktopUnread.includes('Zero folder') && !desktopUnread.includes('Zero feed')); assert.match(desktopUnread, /Unread feed/);
  assert.match(renderToStaticMarkup(React.createElement(Sidebar, { ...shared, libraryTab: 'all' })), /Zero folder/);
  assert.match(renderToStaticMarkup(React.createElement(Sidebar, { ...shared, libraryTab: 'unread', activeScope: 'folder', activeFolderId: 'empty-folder' })), /Zero folder/, 'the open folder stays in the unread tab even with nothing unread');
  const { ArticleList } = await vite.ssrLoadModule('/src/components/ArticleList.tsx');
  const article = { id: 'no-image', feed_id: 'unread', feed_title: 'Example', feed_favicon: 'https://example.test/logo.svg', feed_html_url: 'https://example.test', title: 'No thumbnail', url: 'https://example.test/post', thumbnail_url: '', published_at: new Date().toISOString(), is_read: false, is_saved: false };
  for (const layout of ['magazine', 'cards']) {
    const html = renderToStaticMarkup(React.createElement(ArticleList, { articles: [article], layout, hasSubscriptions: true }));
    assert.match(html, /feedex-feed-logo/); assert.match(html, /https:\/\/example.test\/logo.svg/);
  }
  // 매거진 목록은 상자 없이 구분선으로 나눈 줄이다. 제목이 먼저, 출처·시간이 아래, 썸네일은 오른쪽이다.
  const magazine = renderToStaticMarkup(React.createElement(ArticleList, { articles: [article], layout: 'magazine', hasSubscriptions: true }));
  const row = /<article[^>]*class="feedex-magazine-row[^"]*"/.exec(magazine)?.[0] || '';
  assert.match(row, /border-b/); assert.match(row, /flex-row-reverse/); assert.doesNotMatch(row, /rounded-xl/, 'magazine rows are not boxes');
  assert.doesNotMatch(row, /bg-white|bg-slate-900\/55/, 'rows take the pane background instead of floating white strips');
  assert.match(css, /\.feedex-list-items\.feedex-magazine-list \{ padding: 0; \}/, 'the magazine list has no gutter around it');
  assert.match(css, /\.feedex-feed-list:has\(\.feedex-magazine-list\) \{ background: var\(--feedex-panel\); \}/, 'the pane behind the magazine list is one sheet');
  assert.ok(magazine.indexOf('<h2') < magazine.indexOf('feedex-magazine-author') || magazine.indexOf('<h2') < magazine.indexOf('· '), 'the title comes before the source line');
  // 여러 피드가 섞인 목록에서도 X 글은 X 폴더와 같은 모양으로 그리고, 다른 글은 그대로 둔다.
  const xArticle = { ...article, id: 'x-post', feed_title: 'NASA (@NASA)', feed_html_url: 'https://x.com/NASA', feed_favicon: '', title: 'Liftoff from the pad', url: 'https://x.com/NASA/status/1', content_html: '<p>Liftoff from the pad</p>' };
  for (const [layout, variant] of [['magazine', 'row'], ['cards', 'card'], ['list', 'plain']]) {
    const mixed = renderToStaticMarkup(React.createElement(ArticleList, { articles: [article, xArticle], layout, hasSubscriptions: true, onSelectArticle() {}, onToggleRead() {}, onToggleSaved() {}, isDark: false }));
    assert.equal((mixed.match(/class="feedex-x-post/g) || []).length, 1, `${layout}: the X post uses the X row`);
    assert.match(mixed, new RegExp(`data-x-variant="${variant}"`), `${layout}: the X row fits the list layout`);
    assert.match(mixed, /@NASA/); assert.match(mixed, /No thumbnail/, `${layout}: other articles keep their rows`);
  }
  const { patchPage } = await vite.ssrLoadModule('/src/client/syncPages.ts');
  const page = { articles: [{ ...article, id: 'new', published_at: '2026-10-27' }, { ...article, id: 'old', published_at: '2026-01-01' }], hasMore: false };
  assert.deepEqual(patchPage(page, 'articles?scope=all&sort=oldest', [], new Set(), new Set()).articles.map((item) => item.id), ['old', 'new']);
  console.log('PASS: local feed-name/article-title notifications, fallback, permission/dedup/account boundaries; mobile long-press/scroll/ghost-click guards; zero-unread folders/feeds hidden; logo fallback; X rows inside mixed lists; oldest-first local ordering.');
} finally {
  for (const [key, descriptor] of Object.entries(originals)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  await vite.close();
}
