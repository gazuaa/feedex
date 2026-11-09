import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const { window } = parseHTML('<!doctype html><html><head></head><body><div id="root"></div></body></html>');
const values = new Map(), media = { matches: true, addEventListener() {}, removeEventListener() {} };
window.matchMedia = () => media;
window.scrollTo = () => {};
window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
window.cancelAnimationFrame = (id) => clearTimeout(id);

const globals = {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  Element: window.Element,
  DOMParser: window.DOMParser,
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
  localStorage: { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k), clear: () => values.clear() },
  IS_REACT_ACT_ENVIRONMENT: true,
};

const originals = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, value });

try {
  const { UnreadSession } = await vite.ssrLoadModule('/src/client/unreadSession.ts');
  const { filteredPage, mergeOldestWindow, matchesPage } = await vite.ssrLoadModule('/src/client/syncPages.ts');
  const { parseXPost } = await vite.ssrLoadModule('/src/client/xTimeline.ts');

  // 1. UnreadSession sort safety with missing/undefined published_at or id
  const session = new UnreadSession();
  const dummyArticles = [
    { id: '1', feed_id: 'f1', title: 'T1', published_at: '2026-11-01T00:00:00Z', is_read: false, is_saved: false },
    { id: '2', feed_id: 'f1', title: 'T2', published_at: '', is_read: false, is_saved: false },
    { id: '3', feed_id: 'f1', title: 'T3', published_at: undefined, is_read: false, is_saved: false },
  ];
  const sortedNewest = session.merge(dummyArticles, 'newest');
  assert.equal(sortedNewest.length, 3);
  const sortedOldest = session.merge(dummyArticles, 'oldest');
  assert.equal(sortedOldest.length, 3);

  // 2. mergeOldestWindow and order safety with edge values
  const qs = new URLSearchParams('sort=oldest');
  const cache = new Map(dummyArticles.map((a) => [a.id, a]));
  const merged = mergeOldestWindow(qs, dummyArticles.slice(0, 1), dummyArticles, cache, false);
  assert.ok(Array.isArray(merged));

  // 3. parseXPost safety with null/undefined title and attributes
  const emptyArticle = { id: 'x-empty', feed_id: 'fx', url: '', title: undefined, published_at: '', is_read: false, is_saved: false };
  const post = parseXPost(emptyArticle);
  assert.ok(post);
  assert.equal(typeof post.name, 'string');
  assert.equal(typeof post.text, 'string');

  console.log('PASS: sort toggling, unread session merging and x post parsing are crash-proof under edge cases.');
} finally {
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
  await vite.close();
}
