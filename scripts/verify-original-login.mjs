import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
try {
  const { originalArticleUrl, leavesForOriginal } = await vite.ssrLoadModule('/src/client/originalWindow.ts');
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'https://user:secret@example.test/a', '/relative']) assert.equal(originalArticleUrl(url), null);
  // 원문은 이 창에서 연다. 새 탭이나 새 창으로 여는 클릭이면 FeedEx가 남으므로 돌아올 자리를 남기지 않는다.
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  assert.equal(leavesForOriginal(click), true);
  for (const change of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) assert.equal(leavesForOriginal({ ...click, ...change }), false, `${JSON.stringify(change)} keeps FeedEx open`);

  const { WebStatusBar } = await vite.ssrLoadModule('/src/components/WebStatusBar.tsx');
  const bar = (props) => renderToStaticMarkup(React.createElement(WebStatusBar, { url: 'https://login.example.test/article/one', isDark: false, hidden: false, canLogin: true, notice: 'notice', shortNotice: 'short', ...props }));
  const shown = bar();
  const link = /<a [^>]*href="https:\/\/login\.example\.test\/article\/one"[^>]*>/.exec(shown)?.[0];
  assert.ok(link, 'the bar links to the original article');
  assert.doesNotMatch(link, /target=/, 'the original opens in this window instead of a new one');
  assert.match(link, /rel="noreferrer"/);
  assert.match(shown, /원문에서 읽기·로그인/);
  assert.doesNotMatch(shown, /feedex-reader:|맥 읽기/, 'the Mac reader link is gone');
  assert.doesNotMatch(bar({ url: 'javascript:alert(1)' }), /<a /, 'unsafe addresses get no link');
  assert.doesNotMatch(bar({ canLogin: false }), /원문에서 읽기/, 'X posts open on X instead');

  // 돌아올 자리: 원문을 읽는 동안 한 시간까지 기다린다. 새 배포로 바꾸며 남긴 자리는 지금처럼 2분이다.
  const { keepResumePoint, takeResumePoint } = await vite.ssrLoadModule('/src/client/appVersion.ts');
  const values = new Map(), place = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const now = Date.now(), point = { account: 'reader', at: now, scope: 'folder', folderId: 'folder', feedId: null, search: '', saved: false, articleId: 'article', listScroll: 120, readerScroll: 0 };
  keepResumePoint({ ...point, original: true }, place);
  assert.deepEqual(takeResumePoint('reader', now + 50 * 60_000, place), { ...point, original: true }, 'a place left for the original waits while the article is read');
  keepResumePoint({ ...point, original: true }, place);
  assert.equal(takeResumePoint('reader', now + 61 * 60_000, place), null, 'a place left for the original expires after an hour');
  keepResumePoint(point, place);
  assert.equal(takeResumePoint('reader', now + 3 * 60_000, place), null, 'a place left for an update still expires after two minutes');

  // 링크를 누르기 직전에 자리를 남기고, 브라우저가 떠나기 전 화면을 그대로 되살리면 그 자리는 버린다.
  const app = readFileSync('src/App.tsx', 'utf8');
  assert.match(app, /onLeaveForOriginal=\{\(\) => saveResumePoint\(true\)\}/, 'the article view leaves its place before opening the original');
  assert.match(app, /if \(event\.persisted && user\?\.id\) takeResumePoint\(user\.id\)/, 'a page restored by the browser drops the unused place');
  console.log('PASS: originals open in this window with a safe link, new-tab clicks keep FeedEx, no Mac reader link, one-hour return place, restored pages drop the place, and unsafe URL rejection.');
} finally { await vite.close(); }
