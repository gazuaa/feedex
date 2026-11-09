import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { parseHTML } from 'linkedom';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const previousObserver = globalThis.ResizeObserver;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
try {
  const { bindWebPager } = await vite.ssrLoadModule('/src/client/webPager.ts');
  const { bindSwipeBack } = await vite.ssrLoadModule('/src/client/swipeBack.ts');
  const setup = () => {
    const { window, document } = parseHTML('<html><body><header class="feedex-workspace-header"></header><main class="feedex-feed-list"></main><section class="feedex-article-reader"><div class="feedex-reader"><div class="feedex-reader-content"><p>본문</p></div><div class="feedex-web-pager"><div></div><div><iframe></iframe></div></div></div></section></body></html>');
    document.getSelection = () => null; window.innerWidth = 393; window.matchMedia = () => ({ matches: false }); window.getComputedStyle = () => ({ position: 'fixed', overflowX: 'visible' });
    let id = 0, now = 0;
    const timers = new Map(), frames = new Map();
    window.setTimeout = (fn, ms) => { const key = ++id; timers.set(key, { fn, at: now + ms }); return key; };
    window.clearTimeout = key => timers.delete(key);
    window.requestAnimationFrame = fn => { const key = ++id; frames.set(key, fn); return key; };
    window.cancelAnimationFrame = key => frames.delete(key);
    const tick = ms => { now += ms; for (const [key, timer] of [...timers]) if (timer.at <= now) { timers.delete(key); timer.fn(); } };
    const render = () => { for (let i = 0; i < 3; i++) for (const [key, fn] of [...frames]) { frames.delete(key); fn(); } };
    const pager = document.querySelector('.feedex-web-pager'), source = {};
    Object.defineProperties(pager, { scrollWidth: { value: 786 }, clientWidth: { value: 393 } });
    Object.defineProperty(document.querySelector('iframe'), 'contentWindow', { value: source });
    let backs = 0;
    const cleanup = bindWebPager(pager, () => backs++);
    const message = (count, sender = source) => { const e = new window.Event('message'); Object.assign(e, { source: sender, data: { sfeedTouchCount: count } }); window.dispatchEvent(e); };
    const touch = (type, count) => { const e = new window.Event(type); Object.assign(e, { touches: Array.from({ length: count }) }); pager.dispatchEvent(e); };
    const edge = () => { pager.scrollLeft = 0; pager.dispatchEvent(new window.Event('scroll')); pager.dispatchEvent(new window.Event('scrollend')); };
    return { window, document, pager, tick, render, cleanup, message, touch, edge, backs: () => backs };
  };
  {
    const s = setup(); s.message(1); s.edge(); s.tick(2000); s.render();
    assert.equal(s.backs(), 0, '사본 안에서 손가락을 누르고 멈춰도 리더를 지우지 않는다');
    s.message(0); s.tick(200); s.render(); assert.equal(s.backs(), 1);
    assert.equal(s.document.querySelector('.feedex-feed-list').style.transform || '', '', '돌아오기 전에 목록의 변형을 정리한다'); s.cleanup();
  }
  {
    const s = setup(); s.touch('touchstart', 1); s.edge(); s.tick(2000); s.render(); assert.equal(s.backs(), 0);
    s.touch('touchend', 0); s.tick(200); s.render(); assert.equal(s.backs(), 1, '페이저 위 터치도 종료 후에만 이동한다'); s.cleanup();
  }
  {
    const s = setup(); s.message(1, {}); s.edge(); s.tick(200); s.render(); assert.equal(s.backs(), 1, '다른 프레임은 현재 밀기를 잠그지 못한다'); s.cleanup();
  }
  {
    // X 글은 미리보기 프레임을 스레드 프레임으로 바꾼다. 지워진 프레임이 남긴 터치 때문에 리더가 화면 밖에 걸려 남지 않는다.
    const s = setup(); s.message(1);
    const replaced = s.document.createElement('iframe'); Object.defineProperty(replaced, 'contentWindow', { value: {} });
    s.document.querySelector('iframe').replaceWith(replaced);
    s.edge(); s.tick(200); s.render(); assert.equal(s.backs(), 1, '바뀐 프레임의 터치는 잊고 뒤로 간다'); s.cleanup();
  }
  {
    // 지워진 프레임이 사라지기 직전에 보낸 '손가락 뗌' 알림도 받는다.
    const s = setup(), old = {}; s.message(1); s.message(0, old); s.edge(); s.tick(200); s.render();
    assert.equal(s.backs(), 0, '다른 프레임의 뗌 알림이 지금 프레임의 터치를 지우지 않는다');
    s.message(0); s.tick(200); s.render(); assert.equal(s.backs(), 1); s.cleanup();
  }
  {
    // 터치를 시작한 덮개가 지워지면 종료가 페이저까지 오지 않는다. 그 터치는 잊는다.
    const s = setup(), cover = s.document.createElement('div'); s.pager.lastElementChild.append(cover);
    const start = new s.window.Event('touchstart', { bubbles: true }); Object.assign(start, { touches: [{}] }); cover.dispatchEvent(start);
    s.edge(); s.tick(2000); s.render(); assert.equal(s.backs(), 0, '덮개 위 손가락이 그대로면 닫지 않는다');
    cover.remove(); s.edge(); s.tick(200); s.render(); assert.equal(s.backs(), 1, '덮개가 사라진 뒤에는 남은 터치 때문에 멈추지 않는다'); s.cleanup();
  }
  {
    const s = setup(); s.edge(); s.pager.scrollLeft = 393; s.pager.dispatchEvent(new s.window.Event('scroll')); s.tick(200); s.render(); assert.equal(s.backs(), 0, '취소한 밀기는 뒤로 가지 않는다');
    s.edge(); s.cleanup(); s.tick(2000); s.render(); assert.equal(s.backs(), 0, '닫힌 프레임의 예약 작업은 실행하지 않는다');
  }
  {
    const s = setup(), target = s.document.querySelector('p'); s.cleanup();
    const cleanup = bindSwipeBack(s.document, { canGoBack: () => true, back() {} });
    const touch = (type, x) => { const e = new s.window.Event(type, { bubbles: true, cancelable: true }); Object.defineProperties(e, { touches: { value: [{ clientX: x, clientY: 300 }] }, changedTouches: { value: [{ clientX: x, clientY: 300 }] }, timeStamp: { value: x } }); target.dispatchEvent(e); };
    touch('touchstart', 80); touch('touchmove', 180); assert.ok(s.document.querySelector('.feedex-feed-list').style.transform);
    s.window.dispatchEvent(new s.window.Event('popstate'));
    assert.equal(s.document.querySelector('.feedex-feed-list').style.transform || '', '', '네이티브 뒤로가기가 중간 밀기를 끊어도 목록 레이어가 남지 않는다'); cleanup();
  }
  const { ResizableWorkspace } = await vite.ssrLoadModule('/src/components/ResizableWorkspace.tsx');
  for (const state of [{ mobileReaderOpen: true }, { inactive: true }, {}]) {
    const html = renderToStaticMarkup(React.createElement(ResizableWorkspace, { userId: 'test', isDark: false, ...state, children: React.createElement('button', null, '기사') }));
    const { document } = parseHTML(html), list = document.querySelector('#feed-article-list');
    assert.equal(list.closest('[inert]'), null, '목록의 네이티브 스크롤 영역은 비활성화하지 않는다');
    assert.equal(list.firstElementChild.hasAttribute('inert'), Boolean(state.mobileReaderOpen || state.inactive), '배경의 글·버튼은 계속 입력과 포커스에서 제외한다');
  }
  console.log('통과: 길게 누른 웹뷰 밀기·종료 확인·취소·다른 프레임 무시·바뀐 프레임과 지워진 덮개의 남은 터치 정리·기록 이동 정리·스크롤 영역과 배경 포커스 분리.');
} finally { globalThis.ResizeObserver = previousObserver; await vite.close(); }
