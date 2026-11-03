import assert from 'node:assert/strict';
import { createServer } from 'vite';
const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
try {
  const { originalArticleUrl, openOriginalArticle, watchOriginalReturn } = await vite.ssrLoadModule('/src/client/originalWindow.ts');
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'https://user:secret@example.test/a', '/relative']) assert.equal(originalArticleUrl(url), null);
  const events = [], popup = { closed: false, opener: 'unsafe', location: { replace(url) { assert.equal(popup.opener, null, 'the opener is detached before sending the window to a publisher'); events.push(['navigate', url]); } }, focus() { events.push(['focus']); } };
  let opened = 0;
  const browser = { open(url) { opened++; assert.equal(url, 'about:blank'); return popup; } };
  assert.equal(openOriginalArticle('https://login.example.test/article/one', browser), true);
  assert.equal(openOriginalArticle('https://login.example.test/article/two', browser), true);
  assert.equal(opened, 1, 'articles of the same publisher reuse the original login window'); assert.equal(popup.location.href, 'https://login.example.test/article/two');
  assert.equal(openOriginalArticle('https://blocked.example.test/article', { open() { return null; } }), false, 'a blocked popup leaves the normal link available');
  const win = new EventTarget(), doc = new EventTarget(); doc.visibilityState = 'hidden'; let reloaded = 0;
  watchOriginalReturn(win, doc, () => { reloaded++; }); win.dispatchEvent(new Event('focus')); assert.equal(reloaded, 0);
  doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange')); win.dispatchEvent(new Event('focus')); assert.equal(reloaded, 1, 'returning reloads once, without claiming authentication succeeded');
  const stop = watchOriginalReturn(win, doc, () => { reloaded++; }); stop(); win.dispatchEvent(new Event('focus')); assert.equal(reloaded, 1, 'closing or changing articles cancels the return handler');
  console.log('PASS: original-site-only login windows, no opener, same-site reuse, popup fallback, one reload on return, cancellation, and unsafe URL rejection.');
} finally { await vite.close(); }
