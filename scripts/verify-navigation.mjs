import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
try {
  const { MobileNavigation } = await vite.ssrLoadModule('/src/client/navigation.ts');
  const { bindSwipeBack } = await vite.ssrLoadModule('/src/client/swipeBack.ts');
  const library = { scope: 'all', folderId: null, feedId: null, search: '', unread: false, articleId: null, library: true };
  const list = { ...library, scope: 'folder', folderId: 'crypto', library: false };
  const a = { ...list, articleId: 'article-a' }, b = { ...list, articleId: 'article-b' };
  const entries = [null]; let index = 0, location = library, scroll = 0, navigation, deferredBack = null, childHistory = 0;
  const history = {
    get length() { return entries.length; },
    get state() { return entries[index]; },
    replaceState(state) { entries[index] = structuredClone(state); },
    pushState(state) { entries.splice(index + 1); entries.push(structuredClone(state)); index++; },
    go(delta) {
      // 원문 프레임의 기록을 지나면 바깥 페이지에는 popstate가 오지 않는다.
      if (delta === -1 && childHistory > 0) { childHistory--; return; }
      assert.ok(index + delta >= 0 && index + delta < entries.length);
      const pop = () => { index += delta; navigation.pop(this.state); };
      if (deferredBack) deferredBack.push(pop);
      else pop();
    },
  };
  const restore = (next, position) => { location = next; scroll = position; };
  navigation = new MobileNavigation(history, 'owner', library, restore);
  assert.equal(navigation.canGoBack(), false, 'swiping at the root must not leave the app');
  const open = (next, top = 0) => { location = next; navigation.record(next, top); };
  const back = () => { history.go(-1); navigation.record(location); };
  const forward = () => { history.go(1); navigation.record(location); };
  open(list); open(a, 620); open(b);
  assert.equal(navigation.canGoBack(), true);
  assert.equal(entries.length, 4);
  back(); assert.deepEqual(location, a);
  back(); assert.deepEqual(location, list); assert.equal(scroll, 620);
  back(); assert.deepEqual(location, library);
  forward(); assert.deepEqual(location, list);
  forward(); assert.deepEqual(location, a);
  forward(); assert.deepEqual(location, b);
  // 닫기는 원문 프레임을 먼저 지운 뒤, 열었던 글들을 건너뛰고 목록 기록으로 돌아간다.
  deferredBack = [];
  open(list);
  navigation.record(location);
  assert.equal(deferredBack.length, 1);
  assert.deepEqual(location, list, '기록 이동을 기다리는 동안에도 목록이 보여야 한다');
  deferredBack[0]();
  deferredBack = null;
  navigation.record(location);
  assert.deepEqual(location, list);
  assert.equal(index, 1); assert.equal(scroll, 620);
  open(a, 620);
  childHistory = 1;
  open(list);
  assert.equal(index, 2);
  const resumed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('목록 기록으로 돌아오지 않았다')), 1000);
    deferredBack = { push: (pop) => { clearTimeout(timeout); pop(); resolve(); } };
  });
  await resumed;
  deferredBack = null;
  assert.equal(index, 1, '원문 기록이 바깥 페이지의 popstate를 소비해도 목록으로 돌아간다');
  assert.equal(scroll, 620);
  open(library); assert.equal(index, 0);
  forward();
  const stepsBefore = entries.length;
  open({ ...list, unread: true });
  const unread = location;
  open({ ...unread, search: 'b' }); open({ ...unread, search: 'bitcoin' });
  assert.equal(index, 1); assert.equal(entries.length, stepsBefore, 'switching to the unread tab and typing replace the list entry');
  open({ ...location, articleId: 'read-article' }, 300);
  back(); assert.equal(location.search, 'bitcoin'); assert.equal(location.unread, true); assert.equal(scroll, 300);
  back(); assert.equal(location.library, true, 'swiping back from a list goes to the library, not to the previous tab');
  forward(); forward();
  {
    // 아래 막대의 전체·안 읽음·저장 탭은 뒤로 가기 단계를 만들지 않는다. 전체 글의 저장 탭은 범위가 'saved'로 바뀐다.
    const before = { location, scroll, entries: entries.length, index, deferred: deferredBack };
    const tabEntries = [null]; let tabIndex = 0, tabLocation = library;
    const tabHistory = {
      get length() { return tabEntries.length; }, get state() { return tabEntries[tabIndex]; },
      replaceState(state) { tabEntries[tabIndex] = structuredClone(state); },
      pushState(state) { tabEntries.splice(tabIndex + 1); tabEntries.push(structuredClone(state)); tabIndex++; },
      go(delta) { tabIndex += delta; tabs.pop(this.state); },
    };
    const tabs = new MobileNavigation(tabHistory, 'owner', library, (next) => { tabLocation = next; });
    const show = (next) => { tabLocation = next; tabs.record(next, 0); };
    const all = { ...library, library: false };
    show(all); assert.equal(tabEntries.length, 2);
    show({ ...all, unread: true }); show({ ...all, scope: 'saved' }); show(all); show({ ...all, unread: true });
    assert.equal(tabEntries.length, 2, 'switching tabs on the all list adds no back steps');
    assert.equal(tabs.backTarget(), 'library');
    tabs.back(); tabs.record(tabLocation); assert.equal(tabLocation.library, true, 'back goes to the library, not to the previous tab');
    const feed = { ...list, scope: 'feed', folderId: null, feedId: 'news' };
    show(feed); const steps = tabEntries.length;
    show({ ...feed, unread: true }); show({ ...feed, saved: true }); show(feed);
    assert.equal(tabEntries.length, steps, 'switching tabs inside a feed adds no back steps either');
    show({ ...feed, feedId: 'other' }); assert.equal(tabEntries.length, steps + 1, 'opening another feed is still a back step');
    assert.deepEqual({ location, scroll, entries: entries.length, index, deferred: deferredBack }, before);
  }
  // 다시 불러와도 본문을 저장하지 않고 ID만으로 지금 보던 리더를 되살릴 수 있다.
  navigation = new MobileNavigation(history, 'owner', library, restore);
  assert.equal(location.articleId, 'read-article'); assert.equal(scroll, 300, 'an ordinary reload keeps the list place behind the article');
  // 새 버전으로 바꾸느라 새로 고쳤으면 글은 되살리되 뒤의 글 목록은 맨 위에서 보여 준다.
  navigation = new MobileNavigation(history, 'owner', library, restore, true);
  assert.equal(location.articleId, 'read-article'); assert.equal(scroll, 0, 'after an update reload the list starts at the top');
  assert.equal(history.state.sfeedNavigation.scroll, 0);
  navigation.record(location);
  assert.ok(!JSON.stringify(history.state).includes('content_html'));
  // 다른 계정으로 로그인하면 이전 계정의 리더를 되살리지 않는다.
  navigation = new MobileNavigation(history, 'another-account', library, restore);
  assert.equal(history.state.sfeedNavigation.account, 'another-account');
  assert.deepEqual(history.state.sfeedNavigation.location, library);
  back(); assert.equal(location.articleId, null); assert.equal(location.library, true);
  // 보관함에는 글 목록이 없으므로, 목록의 검색어는 보관함을 거쳐 다음 목록으로 이어진다.
  open({ ...list, search: 'eth' }); open({ ...location, library: true }); navigation.record(location);
  assert.equal(location.library, true); assert.equal(location.search, 'eth', 'going back to the library keeps the search');
  assert.equal(history.state.sfeedNavigation.location.search, 'eth');
  open({ ...location, scope: 'feed', folderId: null, feedId: 'other', library: false });
  back(); assert.equal(location.library, true); assert.equal(location.search, 'eth');
  forward(); assert.equal(location.feedId, 'other'); assert.equal(location.search, 'eth');

  // 설치된 터치 리스너를 실제와 같은 이벤트 경로로 시험한다.
  const doc = new EventTarget(), view = new EventTarget();
  view.innerWidth = 390; view.visualViewport = { scale: 1 };
  view.getComputedStyle = (node) => ({ overflowX: node.horizontal ? 'auto' : 'visible' });
  doc.defaultView = view; doc.querySelector = () => null; doc.getSelection = () => null;
  const container = {};
  const target = { parentElement: null, scrollWidth: 100, clientWidth: 100, horizontal: false, control: false,
    closest(selector) { return selector.startsWith('.feedex-feed-list') ? container : this.control ? {} : null; } };
  let backs = 0, allowed = true;
  const unbind = bindSwipeBack(doc, { canGoBack: () => allowed, back: () => backs++ });
  const touch = (type, x, y, time, options = {}) => {
    const event = new Event(type, { cancelable: options.cancelable !== false });
    Object.defineProperties(event, { target: { value: target }, timeStamp: { value: time },
      touches: { value: type === 'touchend' ? [] : Array.from({ length: options.fingers ?? 1 }, () => ({ clientX: x, clientY: y })) },
      changedTouches: { value: [{ clientX: x, clientY: y }] } });
    doc.dispatchEvent(event); return event;
  };
  const swipe = (fromX, fromY, toX, toY, duration = 240, options = {}) => {
    touch('touchstart', fromX, fromY, 0, options);
    const move = touch('touchmove', toX, toY, duration / 2, options);
    const end = touch('touchend', toX, toY, duration, options);
    return { move, end };
  };
  const ordinary = swipe(95, 300, 240, 310);
  assert.equal(backs, 1); assert.equal(ordinary.move.defaultPrevented, true); assert.equal(ordinary.end.defaultPrevented, true);
  const vertical = swipe(95, 300, 105, 500);
  assert.equal(vertical.move.defaultPrevented, false); assert.equal(backs, 1);
  for (const gesture of [[10, 300, 200, 300], [95, 300, 125, 300], [95, 300, 240, 500], [240, 300, 95, 300]]) swipe(...gesture);
  swipe(95, 300, 240, 300, 1200); swipe(95, 300, 240, 300, 240, { fingers: 2 });
  swipe(95, 300, 240, 300, 240, { cancelable: false });
  assert.equal(backs, 1, 'edge, short, diagonal, leftward, long, pinch and browser-owned gestures do not navigate');
  target.control = true; swipe(95, 300, 240, 300); target.control = false;
  target.horizontal = true; target.scrollWidth = 500; swipe(95, 300, 240, 300); target.horizontal = false;
  view.visualViewport.scale = 1.5; swipe(95, 300, 240, 300); view.visualViewport.scale = 1;
  allowed = false; swipe(95, 300, 240, 300); allowed = true;
  touch('touchstart', 95, 300, 0); view.dispatchEvent(new Event('popstate')); touch('touchend', 240, 300, 240);
  assert.equal(backs, 1, 'controls, horizontal content, zoom, root and a native history traversal are preserved');
  unbind(); swipe(95, 300, 240, 300); assert.equal(backs, 1, 'listeners are removed after logout or switching to desktop');

  const { app } = await vite.ssrLoadModule('/src/server/app.ts');
  const { LocalD1Database } = await vite.ssrLoadModule('/src/server/localD1.ts');
  const db = new LocalD1Database(':memory:', 'migrations/0001_schema.sql');
  const env = { DB: db, ALLOW_QUICK_LOGIN: 'true' };
  const login = async (email) => (await app.request('/api/auth/google/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) }, env)).json();
  const owner = await login('history@example.test'), other = await login('other-history@example.test');
  const now = new Date().toISOString();
  await db.prepare('INSERT INTO feeds(id,xml_url,title,created_at) VALUES(?,?,?,?)').bind('history-feed', 'https://example.test/feed', 'History', now).run();
  await db.prepare('INSERT INTO subscriptions(id,user_id,feed_id,created_at) VALUES(?,?,?,?)').bind('history-sub', owner.user.id, 'history-feed', now).run();
  await db.prepare('INSERT INTO articles(id,feed_id,guid,title,url,published_at,created_at) VALUES(?,?,?,?,?,?,?)').bind('history-article', 'history-feed', 'history', 'Restored article', 'https://example.test/post', now, now).run();
  await db.prepare('INSERT INTO article_states(user_id,article_id,is_read,is_saved) VALUES(?,?,1,1)').bind(owner.user.id, 'history-article').run();
  const query = '/api/articles?articleId=history-article&scope=saved&unreadOnly=true&search=does-not-match&before=1900';
  const get = async (token, url = query) => (await app.request(url, { headers: { authorization: `Bearer ${token}` } }, env)).json();
  const restored = await get(owner.token);
  assert.equal(restored.articles[0].id, 'history-article');
  assert.equal(restored.articles[0].is_read, true); assert.equal(restored.articles[0].is_saved, true);
  assert.equal((await get(other.token)).articles.length, 0, 'a single-article lookup still requires a subscription');
  assert.equal((await get(owner.token, '/api/articles?unreadOnly=true')).articles.length, 0, 'history restoration must not mark read articles unread');
  assert.equal((await app.request(query, {}, env)).status, 401);
  console.log('PASS: ordinary right-swipe Back; native gesture, vertical scroll, horizontal content, controls and pinch preservation; mobile history, scroll/filter restoration, searches carried through the library, tab switches that add no back steps, reload (list at the top after an update reload) and account isolation.');
} finally { await vite.close(); }
