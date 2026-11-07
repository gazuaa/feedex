import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const previousObserver = globalThis.IntersectionObserver;
try {
  let observer;
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; observer = this; }
    observe() {} unobserve() {} disconnect() {}
    emit(rows) { this.callback(rows); }
  };
  const { bindScrollRead } = await vite.ssrLoadModule('/src/client/scrollRead.ts');
  const root = new EventTarget(), frames = new Map(), marked = [];
  let frameId = 0, allowed = true, blocked = false;
  const view = { requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; }, cancelAnimationFrame(id) { frames.delete(id); } };
  root.ownerDocument = { defaultView: view, visibilityState: 'visible', querySelector: () => blocked ? {} : null };
  root.scrollTop = 0; root.closest = () => null;
  root.getBoundingClientRect = () => ({ top: 100, bottom: 500, right: 400 });
  const row = (id, top, read = false) => ({ dataset: { articleId: id, articleRead: String(read) }, isConnected: true, top, getBoundingClientRect() { return { top: this.top, bottom: this.top + 100 }; } });
  const a = row('a', 110), b = row('b', 220), read = row('read', 330, true), skipped = row('skipped', 900);
  root.querySelectorAll = () => [a, b, read, skipped];
  const cleanup = bindScrollRead(root, { canRead: () => allowed, onRead: (ids) => marked.push(ids) });
  const visible = (...rows) => observer.emit(rows.map((target) => ({ target, isIntersecting: true })));
  const scroll = (top) => { root.scrollTop = top; root.dispatchEvent(new Event('scroll')); for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } };
  visible(a, b, read);
  a.top = -10; scroll(120);
  await new Promise((resolve) => setTimeout(resolve, 280));
  assert.deepEqual(marked, [], 'restoring a scroll position without user input never marks articles');
  a.top = 110; scroll(0); visible(a, b, read);
  root.dispatchEvent(new Event('wheel'));
  a.top = -10; scroll(120);
  b.top = -20; read.top = -30; skipped.top = -50; scroll(900);
  await new Promise((resolve) => setTimeout(resolve, 280));
  assert.deepEqual(marked, [['a', 'b']], 'only seen unread rows crossing the top are batched; skipped rows and duplicates are excluded');
  visible(a); root.dispatchEvent(new Event('wheel')); scroll(800);
  await new Promise((resolve) => setTimeout(resolve, 280));
  assert.equal(marked.length, 1, 'scrolling up does not mark rows');
  a.top = 120; visible(a); root.dispatchEvent(new Event('touchmove')); a.top = -10; scroll(950); allowed = false;
  await new Promise((resolve) => setTimeout(resolve, 280));
  assert.equal(marked.length, 1, 'turning the option off cancels a pending write');
  allowed = true; blocked = true; a.top = 110; visible(a); root.dispatchEvent(new Event('wheel')); a.top = -10; scroll(1100);
  await new Promise((resolve) => setTimeout(resolve, 280));
  assert.equal(marked.length, 1, 'settings/dialogs do not trigger automatic reading');
  cleanup(); root.dispatchEvent(new Event('wheel')); scroll(1300);
  assert.equal(frames.size, 0);

  const { UnreadSession, readRowsExpired } = await vite.ssrLoadModule('/src/client/unreadSession.ts');
  assert.equal(readRowsExpired(5_000, 1200), false, 'a quick look at another app keeps the read rows in place');
  assert.equal(readRowsExpired(299_999, 1200), false, 'coming back within five minutes keeps the read rows in place');
  assert.equal(readRowsExpired(300_000, 1200), true, 'locking the phone for five minutes starts a new reading');
  assert.equal(readRowsExpired(1_000, 0), true, 'coming back at the top would only show read rows');
  const article = (id, is_read = false) => ({ id, published_at: `2026-10-27T0${id === 'a' ? 2 : 1}:00:00Z`, is_read, is_saved: false, title: id });
  const session = new UnreadSession();
  session.merge([article('a'), article('b')]); session.update(article('a', true));
  let retained = session.merge([article('b')]);
  assert.deepEqual(retained.map((item) => [item.id, item.is_read]), [['a', true], ['b', false]], 'read rows remain after a server refresh in the mobile session');
  session.patch('a', { full_content_html: 'body' });
  assert.equal(session.merge([])[0].full_content_html, 'body');
  session.update(article('a'));
  assert.equal(session.merge([])[0].is_read, false, 'manual unread and failed writes can roll back');
  session.clear();
  assert.deepEqual(session.merge([article('b')]).map((item) => item.id), ['b'], 'returning to the library or refreshing releases read rows');
  assert.deepEqual(new UnreadSession().merge([]), [], 'restarting the app never restores the temporary rows');
  // 앱이 다시 뜨면 기기 저장본의 글이 안 읽음으로 먼저 온 뒤, 동기화가 읽음을 알려 준다. 이런 글은 남기지 않는다.
  const reopened = new UnreadSession();
  reopened.merge([article('a'), article('b')]);
  reopened.synced(article('a', true));
  assert.deepEqual(reopened.merge([article('b')]).map((item) => item.id), ['b'], 'an article read before the app came back is not kept');
  assert.deepEqual(new UnreadSession().merge([article('a', true), article('b')]).map((item) => item.id), ['b'], 'a row that arrives already read never enters the list');
  const staying = new UnreadSession();
  staying.merge([article('a'), article('b')]); staying.patch('a', { is_read: true });
  staying.synced({ ...article('a', true), title: 'new title' });
  assert.deepEqual(staying.merge([]).map((item) => [item.id, item.is_read, item.title]), [['a', true, 'new title'], ['b', false, 'b']], 'the sync echo of a row read here keeps the row');
  staying.synced(article('b', false));
  assert.equal(staying.merge([]).find((item) => item.id === 'b').is_read, false);
  staying.synced(article('unknown', true));
  assert.equal(staying.merge([]).length, 2, 'articles outside the list are ignored');
  staying.dropRead();
  assert.deepEqual(staying.merge([]).map((item) => item.id), ['b'], 'coming back drops only the read rows');
  // 새로고침처럼 오래 걸리는 작업이 끝난 뒤에 부른 fetchArticles가 그사이 옮긴 목록을 덮어쓰면 안 된다.
  const appSource = readFileSync('src/App.tsx', 'utf8');
  assert.match(appSource, /publishSyncedPage\.current !== fetchArticles\) return publishSyncedPage\.current\(\)/, 'a late list fetch forwards to the list on screen');
  assert.match(appSource, /useLayoutEffect\(\(\) => \{\s*if \(user\) \{\s*fetchArticles\(\);/, 'a ready list replaces the old one before paint');
  // 오래 떠났다 돌아오면 읽은 행이 빠진 목록을 맨 위부터 보여 준다. 기억한 행이 다시 끌어내리면 안 된다.
  const afterAwaySource = appSource.slice(appSource.indexOf('afterAway.current = (away)'), appSource.indexOf('const fetchArticles = useCallback'));
  assert.match(afterAwaySource, /forgetListAnchor\(\);\s*list\?\.scrollTo\(\{ top: 0 \}\);/, 'coming back starts at the top and the anchor cannot pull it back');
  assert.match(afterAwaySource, /selectedArticleId/, 'an open article keeps its list position');
  assert.match(afterAwaySource, /articles\.some\(\(article\) => article\.is_read\)\) return;\s*forgetListAnchor\(\);/, 'a list with no read rows stays where it was');
  const anchorSource = readFileSync('src/client/listAnchor.ts', 'utf8');
  assert.match(anchorSource, /return useCallback\(\(\) => \{ anchor\.current = null; \}/, 'the list anchor can be forgotten');
  // 목록이 바뀐 첫 그리기에 남은 앞 목록의 행을 새 목록의 위치로 기억하면, 같은 글이 있는 새 목록이 그 글 자리로 열린다.
  assert.match(anchorSource, /const switched = shown\.current !== scope; shown\.current = scope;\s*if \(switched\) anchor\.current = null;/, 'switching lists drops the old anchor');
  assert.match(anchorSource, /if \(!switched\) remember\(\);/, 'the first paint of a new list does not remember the old rows');
  // 목록을 고르면 같은 목록이라도 맨 위부터 보여 준다.
  const selectSource = appSource.slice(appSource.indexOf('const handleSelectScope = ('), appSource.indexOf('const handleSelectLibraryTab'));
  assert.match(selectSource, /pendingScroll\.current = null;\s*forgetListAnchor\(\);\s*articleListRef\.current\?\.scrollTo\(\{ top: 0 \}\);/, 'choosing a list starts at the top');
  const { TextSizeControl, ScrollReadSetting } = await vite.ssrLoadModule('/src/components/ReadingSettings.tsx');
  const controls = renderToStaticMarkup(React.createElement(TextSizeControl));
  assert.ok(!controls.includes('%') && !controls.includes('type="range"'));
  assert.match(controls, /글자 작게/); assert.match(controls, /글자 크게/);
  assert.ok(!renderToStaticMarkup(React.createElement(ScrollReadSetting, { markReadOnScroll: false, onChangeMarkReadOnScroll() {} })).includes('checked=""'));

  const { app } = await vite.ssrLoadModule('/src/server/app.ts');
  const { LocalD1Database } = await vite.ssrLoadModule('/src/server/localD1.ts');
  const db = new LocalD1Database(':memory:', 'migrations/0001_schema.sql'), env = { DB: db, ALLOW_QUICK_LOGIN: 'true' };
  const login = async (email) => (await app.request('/api/auth/google/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) }, env)).json();
  const owner = await login('scroll@example.test'), other = await login('other-scroll@example.test');
  const request = (path, token = owner.token, body, method = 'POST') => app.request(path, { method: body === undefined ? 'GET' : method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  const preferences = async (token = owner.token) => (await (await request('/api/user/me', token)).json()).user.preferences;
  assert.equal((await preferences()).markReadOnScroll, false, 'existing accounts default to off');
  await request('/api/user/preferences', owner.token, { markReadOnScroll: true }, 'PUT');
  await request('/api/user/preferences', owner.token, { layout: 'list' }, 'PUT');
  assert.equal((await preferences()).markReadOnScroll, true, 'the setting survives other preference changes and new sessions');
  assert.equal((await preferences(other.token)).markReadOnScroll, false, 'preferences are account scoped');
  await request('/api/user/preferences', owner.token, { markReadOnScroll: 'false' }, 'PUT');
  assert.equal((await preferences()).markReadOnScroll, true, 'invalid values cannot change the setting');
  const now = new Date().toISOString();
  for (const [id, user] of [['own', owner], ['outside', other]]) {
    await db.prepare('INSERT INTO feeds(id,xml_url,title,created_at) VALUES(?,?,?,?)').bind(id, `https://example.test/${id}`, id, now).run();
    await db.prepare('INSERT INTO subscriptions(id,user_id,feed_id,created_at) VALUES(?,?,?,?)').bind(`sub-${id}`, user.user.id, id, now).run();
    for (const suffix of ['a', 'b']) await db.prepare('INSERT INTO articles(id,feed_id,guid,title,url,published_at,created_at) VALUES(?,?,?,?,?,?,?)').bind(`${id}-${suffix}`, id, suffix, suffix, `https://example.test/${id}/${suffix}`, now, now).run();
  }
  await db.prepare('INSERT INTO article_states(user_id,article_id,is_saved,saved_at) VALUES(?,?,1,?)').bind(owner.user.id, 'own-a', now).run();
  const result = await request('/api/articles/mark-read', owner.token, { articleIds: ['own-a', 'own-a', 'own-b', 'outside-a', 'missing'] });
  assert.equal(result.status, 200);
  const states = (await db.prepare('SELECT article_id,is_read,is_saved,saved_at FROM article_states WHERE user_id=? ORDER BY article_id').bind(owner.user.id).all()).results;
  assert.deepEqual(states.map((state) => [state.article_id, state.is_read, state.is_saved]), [['own-a', 1, 1], ['own-b', 1, 0]], 'batch reading preserves bookmarks and cannot modify another account or unknown articles');
  assert.equal(states[0].saved_at, now);
  for (const articleIds of [[], Array(51).fill('own-a'), [null]]) assert.equal((await request('/api/articles/mark-read', owner.token, { articleIds })).status, 400);
  await request('/api/user/preferences', owner.token, { markReadOnScroll: false }, 'PUT');
  assert.equal((await preferences()).markReadOnScroll, false);
  console.log('PASS: user-driven downward scroll, batching, skipped/read-row exclusion, restore/upward/dialog guards, cleanup, mobile retained-read sessions, +/- font controls, account settings and authorized bookmark-preserving batch writes.');
} finally {
  if (previousObserver === undefined) delete globalThis.IntersectionObserver; else globalThis.IntersectionObserver = previousObserver;
  await vite.close();
}
