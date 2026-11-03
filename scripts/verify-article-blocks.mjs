import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const originals = Object.fromEntries(['localStorage', 'Notification', 'navigator', 'fetch'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const memory = new Map();
let failWrites = false;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key) => memory.get(key) ?? null,
  removeItem: (key) => memory.delete(key),
  setItem: (key, value) => { if (failWrites) throw new Error('QuotaExceeded'); memory.set(key, String(value)); },
} });
try {
  const { app } = await vite.ssrLoadModule('/src/server/app.ts');
  const { LocalD1Database } = await vite.ssrLoadModule('/src/server/localD1.ts');
  const db = new LocalD1Database(':memory:', 'migrations/0001_schema.sql'), env = { DB: db, ALLOW_QUICK_LOGIN: 'true' };
  const login = await (await app.request('/api/auth/google/quick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'block-owner@example.test' }) }, env)).json();
  memory.set('sfeed_session_token', login.token);
  globalThis.fetch = (url, options) => app.request(url, options, env);
  const owner = login.user.id;
  const { formatPublicationDate } = await vite.ssrLoadModule('/src/client/api.ts');
  assert.match(formatPublicationDate({ published_at: '2026-11-03T03:14:00Z' }), /2026/);
  assert.equal(formatPublicationDate({ published_at: 'bad' }), '발행일 미제공');
  assert.equal(formatPublicationDate({ published_at: '2026-11-03T03:14:00Z', date_source: 'collected' }), '발행일 미제공');
  const { compileArticleBlocks, suggestArticleBlock, parseBlockTerms, blockRuleError, readArticleBlocks, saveArticleBlock, removeArticleBlock, visibleArticleNeighbors, syncArticleBlocks } = await vite.ssrLoadModule('/src/client/articleBlocks.ts');
  const sample = { id: 'eth', feed_id: 'digital-asset', feed_title: '디지털에셋', title: '미국 이더리움 현물 ETF, 하루새 1억3970만달러 순유출' };
  const rule = suggestArticleBlock(sample);
  assert.deepEqual(rule.all, ['현물 ETF', '하루새']); assert.deepEqual(rule.any, ['순유입', '순유출']);
  const blocked = compileArticleBlocks([rule]);
  for (const title of [sample.title, '미국 비트코인 현물 ETF, 하루새 3억9860만달러 순유출', '미국 비트코인 현물 ETF, 하루 새 500만달러 순유입', '미국 이더리움 현물 ＥＴＦ, 하루새 2억달러 순유입']) assert.equal(blocked({ ...sample, title }), true, title);
  for (const title of ['미국 비트코인 현물 ETF 승인 소식', '미국 비트코인 현물 ETF 운용사 규제 변경', '비트코인 펀드 하루새 1억달러 순유출', '미국 비트코인 현물 ETF 주간 1억달러 순유출']) assert.equal(blocked({ ...sample, title }), false, title);
  assert.equal(blocked({ ...sample, feed_id: 'other-feed' }), false, '같은 제목이어도 다른 피드에는 적용하지 않는다.');
  assert.equal(compileArticleBlocks([{ ...rule, enabled: false }])(sample), false);
  assert.equal(compileArticleBlocks([{ ...rule, feedId: null }])({ ...sample, feed_id: 'other-feed' }), true);
  assert.equal(compileArticleBlocks([{ ...rule, all: ['ETF'], any: [] }])(sample), true);
  assert.equal(compileArticleBlocks([{ ...rule, all: [], any: ['순유출'] }])(sample), true);
  assert.equal(compileArticleBlocks([{ ...rule, all: ['.*'], any: [] }])(sample), false, '정규식으로 실행하지 않는다.');
  assert.equal(compileArticleBlocks([{ ...rule, all: [], any: [] }])(sample), false, '빈 조건으로 모든 글을 숨기지 않는다.');
  assert.deepEqual(parseBlockTerms('현물 ETF, 하루새\n현물  etf, 순유출'), ['현물 ETF', '하루새', '순유출']);
  assert.ok(blockRuleError({ ...rule, all: [], any: [] }));
  assert.ok(blockRuleError({ ...rule, all: Array.from({ length: 13 }, (_, index) => String(index)) }));
  assert.ok(blockRuleError({ ...rule, all: ['x'.repeat(101)] }));
  const price = { ...sample, title: '오늘의 환율 1,400원 시장 동향' };
  assert.equal(compileArticleBlocks([suggestArticleBlock(price)])({ ...price, title: '오늘의 환율 1,500원 시장 동향' }), true);
  const page = [{ id: 'a' }, { id: 'hidden' }, { id: 'c' }, { id: 'last-hidden' }], visible = [page[0], page[2]];
  assert.deepEqual(visibleArticleNeighbors(page, visible, 'hidden'), { prev: page[0], next: page[2] });
  assert.deepEqual(visibleArticleNeighbors(page, visible, 'a'), { prev: null, next: page[2] });
  assert.deepEqual(visibleArticleNeighbors(page, [], 'hidden'), { prev: null, next: null });
  assert.deepEqual(visibleArticleNeighbors(page, visible, null), { prev: page[0], next: page[0] }, '선택한 글이 없을 때 위·아래 키로 첫 글을 여는 동작을 유지한다.');
  assert.equal(page.at(-1).id, 'last-hidden', '보기 필터는 다음 페이지에 쓰는 원래 마지막 행을 바꾸지 않는다.');

  assert.equal(readArticleBlocks(owner).length, 0);
  await saveArticleBlock(owner, rule);
  const snapshot = readArticleBlocks(owner);
  assert.equal(snapshot, readArticleBlocks(owner), '같은 저장값은 안정적인 스냅숏을 반환한다.');
  assert.equal(readArticleBlocks('other').length, 0, '다른 계정과 규칙을 공유하지 않는다.');
  assert.equal(compileArticleBlocks(snapshot)(sample), true);
  await saveArticleBlock(owner, { ...rule, enabled: false });
  assert.equal(compileArticleBlocks(readArticleBlocks(owner))(sample), false);
  await saveArticleBlock(owner, rule);
  assert.equal(readArticleBlocks(owner).length, 1, '수정은 같은 규칙을 중복 추가하지 않는다.');
  failWrites = true;
  await saveArticleBlock(owner, { ...rule, enabled: false });
  assert.equal(readArticleBlocks(owner)[0].enabled, false, '기기 저장이 부족해도 계정에 저장한 규칙은 적용한다.');
  failWrites = false;
  await saveArticleBlock(owner, rule);
  assert.equal(readArticleBlocks(owner)[0].enabled, true);
  await removeArticleBlock(owner, rule.id); assert.equal(readArticleBlocks(owner).length, 0);
  await saveArticleBlock(owner, rule); assert.equal(readArticleBlocks(owner).length, 1, '삭제한 규칙은 실행 취소로 복원할 수 있다.');
  for (const raw of ['invalid JSON', '{}', JSON.stringify([{ ...rule, any: 'invalid' }]), JSON.stringify([{ ...rule, feedId: '' }]), JSON.stringify([{ ...rule, all: [], any: [] }])]) {
    memory.set('sfeed_article_blocks_v1:corrupt', raw);
    assert.equal(readArticleBlocks('corrupt').length, 0, '손상된 규칙은 전체 차단으로 확대하지 않는다.');
  }
  memory.set('sfeed_article_blocks_v1:external', JSON.stringify([rule]));
  assert.equal(readArticleBlocks('external')[0].id, rule.id, '다른 창이나 다음 실행에서 저장한 규칙도 읽는다.');
  memory.set('sfeed_article_blocks_v1:external', '[]'); assert.equal(readArticleBlocks('external').length, 0);

  // 새 기기에는 서버에 저장한 규칙을 가져오며, 오래된 로컬 사본은 삭제를 되돌리지 않는다.
  memory.delete(`sfeed_article_blocks_v1:${owner}`); memory.delete(`sfeed_article_blocks_account_v1:${owner}`);
  await syncArticleBlocks(owner, true); assert.equal(readArticleBlocks(owner)[0].id, rule.id);
  await removeArticleBlock(owner, rule.id);
  memory.set(`sfeed_article_blocks_v1:${owner}`, JSON.stringify([rule])); memory.delete(`sfeed_article_blocks_account_v1:${owner}`);
  await syncArticleBlocks(owner, true); assert.equal(readArticleBlocks(owner).length, 0, '다른 기기의 과거 규칙으로 삭제한 규칙을 되살리지 않는다.');
  await saveArticleBlock(owner, rule);
  const auth = { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' };
  await app.request('/api/user/preferences', { method: 'PUT', headers: auth, body: JSON.stringify({ theme: 'light' }) }, env);
  const response = await app.request('/api/user/article-blocks', { headers: auth }, env);
  assert.equal(response.headers.get('Cache-Control'), 'no-store'); assert.equal((await response.json()).rules[0].id, rule.id);
  assert.equal((await app.request('/api/user/article-blocks', {}, env)).status, 401);
  assert.equal((await app.request('/api/user/article-blocks', { method: 'PUT', headers: auth, body: JSON.stringify({ action: 'save', rule: { ...rule, all: [], any: [] } }) }, env)).status, 400);
  const writeRule = (rule) => app.request('/api/user/article-blocks', { method: 'PUT', headers: auth, body: JSON.stringify({ action: 'save', rule }) }, env);
  const concurrentRules = [{ ...rule, id: 'parallel-a' }, { ...rule, id: 'parallel-b' }];
  const writes = await Promise.all(concurrentRules.map(writeRule));
  assert.deepEqual(writes.map((item) => item.status), [200, 200]);
  const merged = (await (await app.request('/api/user/article-blocks', { headers: auth }, env)).json()).rules;
  assert.ok(concurrentRules.every((item) => merged.some((saved) => saved.id === item.id)), '동시에 다른 규칙을 저장해도 서로 덮어쓰지 않는다.');
  const storedUser = await db.prepare('SELECT preferences_json FROM users WHERE id=?').bind(owner).first();
  assert.equal(JSON.parse(storedUser.preferences_json).theme, 'light', '계정 규칙 저장이 다른 환경설정을 덮어쓰지 않는다.');
  await Promise.all(concurrentRules.map((item) => app.request('/api/user/article-blocks', { method: 'PUT', headers: auth, body: JSON.stringify({ action: 'delete', id: item.id }) }, env)));
  await syncArticleBlocks(owner, true);

  const otherLogin = await (await app.request('/api/auth/google/quick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'block-other@example.test' }) }, env)).json();
  assert.deepEqual((await (await app.request('/api/user/article-blocks', { headers: { Authorization: `Bearer ${otherLogin.token}` } }, env)).json()).rules, []);

  Object.defineProperty(globalThis, 'Notification', { configurable: true, value: { permission: 'granted' } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Test browser', maxTouchPoints: 0 } });
  const { setLocalNotifications, notifyNewArticles } = await vite.ssrLoadModule('/src/client/localNotifications.ts');
  const shown = [];
  const show = async (title, options) => shown.push({ title, ...options });
  setLocalNotifications(owner, true);
  await notifyNewArticles(owner, [sample, { ...sample, id: 'approval', title: '비트코인 현물 ETF 승인 소식' }], show);
  assert.equal(shown.length, 1); assert.equal(shown[0].body, '비트코인 현물 ETF 승인 소식');
  await saveArticleBlock(owner, { ...rule, enabled: false });
  await notifyNewArticles(owner, [{ ...sample, id: 'after-disable' }], show); assert.equal(shown.length, 2);
  setLocalNotifications('other', true);
  await notifyNewArticles('other', [{ ...sample, id: 'other-account' }], show); assert.equal(shown.length, 3);
  let duringDelivery = 0;
  await notifyNewArticles(owner, [{ ...sample, id: 'first-delivery', title: '일반 뉴스' }, { ...sample, id: 'blocked-during-delivery' }], async () => { duringDelivery++; await saveArticleBlock(owner, rule); });
  assert.equal(duringDelivery, 1, '알림을 보내는 중 규칙을 켜면 뒤의 차단 기사 알림은 보내지 않는다.');
  console.log('PASS: recurring-title suggestions, AND/OR literals, feed scopes, Unicode/spacing, empty/corrupt safeguards, account-synced durable rules, legacy migration, concurrent writes, toggle/delete/restore, full-device-cache fallback and notification exclusions.');
} finally {
  for (const [name, descriptor] of Object.entries(originals)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  await vite.close();
}
