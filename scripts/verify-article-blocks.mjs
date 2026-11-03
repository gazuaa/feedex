import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const originals = Object.fromEntries(['localStorage', 'Notification', 'navigator'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const memory = new Map();
let failWrites = false;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => { if (failWrites) throw new Error('QuotaExceeded'); memory.set(key, String(value)); },
} });
try {
  const { compileArticleBlocks, suggestArticleBlock, parseBlockTerms, blockRuleError, readArticleBlocks, saveArticleBlock, removeArticleBlock, visibleArticleNeighbors } = await vite.ssrLoadModule('/src/client/articleBlocks.ts');
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

  assert.equal(readArticleBlocks('owner').length, 0);
  saveArticleBlock('owner', rule);
  const snapshot = readArticleBlocks('owner');
  assert.equal(snapshot, readArticleBlocks('owner'), '같은 저장값은 안정적인 스냅숏을 반환한다.');
  assert.equal(readArticleBlocks('other').length, 0, '다른 계정과 규칙을 공유하지 않는다.');
  assert.equal(compileArticleBlocks(snapshot)(sample), true);
  saveArticleBlock('owner', { ...rule, enabled: false });
  assert.equal(compileArticleBlocks(readArticleBlocks('owner'))(sample), false);
  saveArticleBlock('owner', rule);
  assert.equal(readArticleBlocks('owner').length, 1, '수정은 같은 규칙을 중복 추가하지 않는다.');
  failWrites = true;
  assert.throws(() => saveArticleBlock('owner', { ...rule, enabled: false }), /저장하지 못/);
  failWrites = false;
  assert.equal(readArticleBlocks('owner')[0].enabled, true, '저장에 실패하면 적용됐다고 처리하지 않는다.');
  removeArticleBlock('owner', rule.id); assert.equal(readArticleBlocks('owner').length, 0);
  saveArticleBlock('owner', rule); assert.equal(readArticleBlocks('owner').length, 1, '삭제한 규칙은 실행 취소로 복원할 수 있다.');
  for (const raw of ['invalid JSON', '{}', JSON.stringify([{ ...rule, any: 'invalid' }]), JSON.stringify([{ ...rule, feedId: '' }]), JSON.stringify([{ ...rule, all: [], any: [] }])]) {
    memory.set('sfeed_article_blocks_v1:corrupt', raw);
    assert.equal(readArticleBlocks('corrupt').length, 0, '손상된 규칙은 전체 차단으로 확대하지 않는다.');
  }
  memory.set('sfeed_article_blocks_v1:external', JSON.stringify([rule]));
  assert.equal(readArticleBlocks('external')[0].id, rule.id, '다른 창이나 다음 실행에서 저장한 규칙도 읽는다.');
  memory.set('sfeed_article_blocks_v1:external', '[]'); assert.equal(readArticleBlocks('external').length, 0);

  Object.defineProperty(globalThis, 'Notification', { configurable: true, value: { permission: 'granted' } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Test browser', maxTouchPoints: 0 } });
  const { setLocalNotifications, notifyNewArticles } = await vite.ssrLoadModule('/src/client/localNotifications.ts');
  const shown = [];
  const show = async (title, options) => shown.push({ title, ...options });
  setLocalNotifications('owner', true);
  await notifyNewArticles('owner', [sample, { ...sample, id: 'approval', title: '비트코인 현물 ETF 승인 소식' }], show);
  assert.equal(shown.length, 1); assert.equal(shown[0].body, '비트코인 현물 ETF 승인 소식');
  saveArticleBlock('owner', { ...rule, enabled: false });
  await notifyNewArticles('owner', [{ ...sample, id: 'after-disable' }], show); assert.equal(shown.length, 2);
  setLocalNotifications('other', true);
  await notifyNewArticles('other', [{ ...sample, id: 'other-account' }], show); assert.equal(shown.length, 3);
  let duringDelivery = 0;
  await notifyNewArticles('owner', [{ ...sample, id: 'first-delivery', title: '일반 뉴스' }, { ...sample, id: 'blocked-during-delivery' }], async () => { duringDelivery++; saveArticleBlock('owner', rule); });
  assert.equal(duringDelivery, 1, '알림을 보내는 중 규칙을 켜면 뒤의 차단 기사 알림은 보내지 않는다.');
  console.log('PASS: recurring-title suggestions, AND/OR literals, feed scopes, Unicode/spacing, empty/corrupt safeguards, per-account durable rules, toggle/delete/restore, failed writes and notification exclusions.');
} finally {
  for (const [name, descriptor] of Object.entries(originals)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  await vite.close();
}
