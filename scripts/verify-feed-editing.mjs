import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
try {
  const { app } = await vite.ssrLoadModule('/src/server/app.ts');
  const { LocalD1Database } = await vite.ssrLoadModule('/src/server/localD1.ts');
  const { upsertFeedAndArticles } = await vite.ssrLoadModule('/src/server/seedService.ts');
  const db = new LocalD1Database(':memory:', 'migrations/0001_schema.sql'), env = { DB: db, ALLOW_QUICK_LOGIN: 'true' };
  const login = async email => {
    const { user, token } = await (await app.request('/api/auth/google/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) }, env)).json();
    const api = (path, body) => app.request(path, { method: body === undefined ? 'GET' : 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env); api.id = user.id; api.token = token; return api;
  };
  const owner = await login('feed-edit@example.test'), other = await login('feed-other@example.test');
  const { feedId } = await upsertFeedAndArticles(db, { title: 'Original publisher', xmlUrl: 'https://edit.example.test/feed', htmlUrl: 'https://edit.example.test', description: null, faviconUrl: null, articles: [] });
  for (const api of [owner, other]) {
    await db.prepare('INSERT INTO folders(id,user_id,name,created_at) VALUES(?,?,?,?)').bind(`folder-${api.id}`, api.id, 'Folder', new Date().toISOString()).run();
    await db.prepare('INSERT INTO subscriptions(id,user_id,feed_id,folder_id,created_at) VALUES(?,?,?,?,?)').bind(`sub-${api.id}`, api.id, feedId, `folder-${api.id}`, new Date().toISOString()).run();
  }
  const prepare = db.prepare.bind(db);
  db.prepare = sql => { const statement = prepare(sql), bind = statement.bind.bind(statement); statement.bind = (...values) => { assert.ok(values.every(value => typeof value !== 'boolean'), 'D1 only accepts supported parameter types'); return bind(...values); }; return statement; };
  const path = `/api/subscriptions/sub-${owner.id}`, state = () => db.prepare('SELECT * FROM subscriptions WHERE id=?').bind(`sub-${owner.id}`).first();
  assert.equal((await other(path, { customTitle: 'Wrong account' })).status, 404);
  for (const body of [{}, { customTitle: '' }, { customTitle: '   ' }, { customTitle: 5 }, { customTitle: 'a'.repeat(201) }, { customTitle: 'bad\nname' }, { folderId: 5 }, []]) assert.equal((await owner(path, body)).status, 400);
  const cursor = (await (await owner('/api/bootstrap')).json()).syncCursor;
  const response = await owner(path, { customTitle: '  My publisher  ' }); assert.equal(response.status, 200); assert.equal((await response.json()).title, 'My publisher');
  assert.equal((await state()).folder_id, `folder-${owner.id}`, 'renaming does not move the feed');
  assert.equal((await state()).custom_title, 'My publisher');
  assert.equal((await db.prepare('SELECT title FROM feeds WHERE id=?').bind(feedId).first()).title, 'Original publisher', 'the shared publisher name stays unchanged');
  const boot = await (await other('/api/bootstrap')).json(); assert.equal(boot.subscriptions[0].title, 'Original publisher', 'other accounts keep their own name');
  const delta = await (await app.request('/api/sync', { method: 'POST', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ cursor }) }, env)).json();
  assert.equal(delta.subscriptions.find(sub => sub.feed_id === feedId).title, 'My publisher', 'the new name reaches another device through metadata sync');
  assert.equal((await owner(path, { folderId: `folder-${other.id}`, customTitle: 'Do not save' })).status, 404); assert.equal((await state()).custom_title, 'My publisher', 'invalid folders never partially rename a feed');
  assert.equal((await owner(path, { folderId: null })).status, 200); assert.equal((await state()).custom_title, 'My publisher', 'moving preserves the custom name');
  const reset = await owner(path, { customTitle: null }); assert.equal((await reset.json()).title, 'Original publisher'); assert.equal((await state()).custom_title, null);
  const { contextMenuIcon } = await vite.ssrLoadModule('/src/components/DesktopContextMenu.tsx');
  const ids = ['copy-text','read','save','block-title','edit-builder','rename-feed','feed-history','open-feed','mark-feed','move-feed','updates','unsubscribe','open-folder','mark-folder','delete-folder','open-original','copy-link','all','refresh','add'];
  for (const id of ids) { const Icon = contextMenuIcon({ id, label: id }); assert.match(renderToStaticMarkup(React.createElement(Icon, { 'aria-hidden': true })), /<svg/); }
  assert.notEqual(contextMenuIcon({ id: 'updates', label: '업데이트 다시 받기' }), contextMenuIcon({ id: 'updates', label: '업데이트 중지' }));
  console.log('PASS: account-only renaming/reset, input validation, preserved folders, atomic invalid moves, device metadata sync, shared names unchanged, and icons for every menu action.');
} finally { await vite.close(); }
