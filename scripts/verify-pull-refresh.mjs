import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
try {
  const { bindPullRefresh, PULL_REFRESH_THRESHOLD } = await vite.ssrLoadModule('/src/client/pullRefresh.ts');
  const doc = new EventTarget(), view = new EventTarget();
  doc.defaultView = view; view.visualViewport = { scale: 1 };
  let blocked = false, allowed = true, progress = 0, refreshes = 0, finish;
  doc.querySelector = () => blocked ? {} : null;
  const root = { scrollTop: 0, inert: false, closest() { return this.inert ? {} : null; } };
  const target = { control: false, reader: false, closest(selector) { return selector.startsWith('input') ? this.control ? {} : null : this.reader ? null : root; } };
  const cleanup = bindPullRefresh(doc, {
    canRefresh: () => allowed,
    onProgress: (value) => { progress = value; },
    onRefresh: () => { refreshes++; return new Promise((resolve) => { finish = resolve; }); },
  });
  const touch = (type, x, y, { fingers = 1, cancelable = true } = {}) => {
    const event = new Event(type, { cancelable });
    Object.defineProperties(event, { target: { value: target }, touches: { value: type === 'touchend' ? [] : Array.from({ length: fingers }, () => ({ clientX: x, clientY: y })) } });
    doc.dispatchEvent(event); return event;
  };
  const swipe = (x, y, options) => {
    touch('touchstart', 100, 200, options);
    const move = touch('touchmove', x, y, options);
    touch('touchend', x, y, options); return move;
  };
  touch('touchstart', 100, 200);
  const pull = touch('touchmove', 104, 340);
  assert.equal(pull.defaultPrevented, true); assert.ok(progress >= PULL_REFRESH_THRESHOLD);
  touch('touchend', 104, 340); await Promise.resolve();
  assert.equal(refreshes, 1); assert.equal(progress, 0);
  swipe(104, 350); await Promise.resolve();
  assert.equal(refreshes, 1, 'a second pull cannot duplicate a refresh in flight');
  finish(); await new Promise(setImmediate);

  assert.equal(swipe(240, 208).defaultPrevented, false, 'horizontal back gestures remain native');
  swipe(102, 250); swipe(104, 100); swipe(180, 280);
  root.scrollTop = 100; assert.equal(swipe(104, 350).defaultPrevented, false); root.scrollTop = 0;
  target.reader = true; swipe(104, 350); target.reader = false;
  target.control = true; swipe(104, 350); target.control = false;
  root.inert = true; swipe(104, 350); root.inert = false;
  blocked = true; swipe(104, 350); blocked = false;
  allowed = false; swipe(104, 350); allowed = true;
  view.visualViewport.scale = 1.5; swipe(104, 350); view.visualViewport.scale = 1;
  swipe(104, 350, { fingers: 2 }); swipe(104, 350, { cancelable: false });
  touch('touchstart', 100, 200); touch('touchmove', 104, 350); touch('touchcancel', 104, 350); touch('touchend', 104, 350);
  touch('touchstart', 100, 200); touch('touchmove', 104, 350); view.dispatchEvent(new Event('popstate')); touch('touchend', 104, 350);
  await Promise.resolve();
  assert.equal(refreshes, 1, 'short/up/diagonal drags, scrolled lists, reader, controls, dialogs, pinch and cancelled gestures do not refresh');

  // iOS는 가장자리에서 튕길 때 scrollTop을 음수로 알릴 수 있다.
  root.scrollTop = -3; swipe(104, 350); await Promise.resolve();
  assert.equal(refreshes, 2); finish(); await new Promise(setImmediate);
  cleanup(); swipe(104, 350); await Promise.resolve();
  assert.equal(refreshes, 2, 'listeners are removed when leaving the list or logging out');

  const { PullRefreshIndicator } = await vite.ssrLoadModule('/src/components/PullRefreshIndicator.tsx');
  const render = (distance, refreshing) => renderToStaticMarkup(React.createElement(PullRefreshIndicator, { distance, refreshing }));
  assert.equal(render(0, false), '');
  assert.match(render(20, false), /당겨서 새로고침/);
  assert.match(render(PULL_REFRESH_THRESHOLD, false), /놓으면 새로고침/);
  assert.match(render(0, true), /새로고침 중/);

  const { MobileDock } = await vite.ssrLoadModule('/src/components/MobileChrome.tsx');
  const dock = (props) => renderToStaticMarkup(React.createElement(MobileDock, { active: 'all', onSelect() {}, onRefresh() {}, onMarkAllRead() {}, onAdd() {}, refreshing: false, ...props }));
  const refreshButton = (markup) => markup.match(/<button aria-label="피드 새로고침"[^>]*>.*?<\/button>/)[0];
  assert.doesNotMatch(refreshButton(dock({})), /animate-spin|aria-busy/);
  for (const state of [{ syncing: true }, { refreshing: true }]) {
    const button = refreshButton(dock(state));
    assert.match(button, /animate-spin/, 'the dock icon turns during a background sync and a full refresh');
    assert.match(button, /aria-busy="true"/);
    assert.doesNotMatch(button, /disabled/, 'the turning icon stays at full strength and the press is deduplicated by the refresh itself');
  }
  console.log('PASS: pull threshold/release, progress state, request deduplication, top-only scrolling, iOS bounce, horizontal back gestures, cancellation, pinch/input/dialog guards, cleanup and the dock sync spinner.');
} finally { await vite.close(); }
