import assert from 'node:assert/strict';
import { createServer } from 'vite';

// 피드별 글 수: 처음 쓸 때 표와 트리거를 만들고 채운다. 글이 들어오고 나가고 옮겨질 때 트리거가 맞추고,
// 첫 화면·동기화 개수는 이 값을 쓴다. 준비하지 못하면 예전처럼 직접 센다.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
try {
  const { app } = await vite.ssrLoadModule('/src/server/app.ts');
  const { LocalD1Database } = await vite.ssrLoadModule('/src/server/localD1.ts');
  const { feedCountsReady, reconcileFeedCounts } = await vite.ssrLoadModule('/src/server/feedCounts.ts');

  const setup = (wrap = (db) => db) => {
    const raw = new LocalD1Database(':memory:', 'migrations/0001_schema.sql');
    const sql = [];
    const traced = wrap({
      prepare(query) { sql.push(query); return raw.prepare(query); },
      batch: (statements) => raw.batch(statements),
      exec: (...args) => raw.exec(...args),
    });
    const env = { DB: traced, ALLOW_QUICK_LOGIN: 'true' };
    const login = async (email) => (await app.request('/api/auth/google/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) }, env)).json();
    const stamp = () => new Date().toISOString();
    const feed = async (id, users) => {
      await raw.prepare('INSERT INTO feeds(id,xml_url,title,created_at) VALUES(?,?,?,?)').bind(id, `https://example.test/${id}`, id, stamp()).run();
      for (const user of users) await raw.prepare('INSERT INTO subscriptions(id,user_id,feed_id,created_at) VALUES(?,?,?,?)').bind(`${user.id}-${id}`, user.id, id, stamp()).run();
    };
    const add = (id, feedId, hoursAgo = 1) => raw.prepare('INSERT INTO articles(id,feed_id,guid,title,url,published_at,created_at) VALUES(?,?,?,?,?,?,?)')
      .bind(id, feedId, id, `title ${id}`, `https://example.test/a/${id}`, new Date(Date.now() - hoursAgo * 3600_000).toISOString(), stamp()).run();
    const bootstrap = async (token) => (await app.request('/api/bootstrap', { headers: { authorization: `Bearer ${token}` } }, env)).json();
    const stored = async () => Object.fromEntries((await raw.prepare('SELECT feed_id,total FROM feed_article_counts ORDER BY feed_id').all()).results.map((row) => [row.feed_id, Number(row.total)]));
    const actual = async () => Object.fromEntries((await raw.prepare('SELECT feed_id,COUNT(*) AS n FROM articles GROUP BY feed_id ORDER BY feed_id').all()).results.map((row) => [row.feed_id, Number(row.n)]));
    return { raw, traced, env, sql, login, feed, add, bootstrap, stored, actual };
  };

  // 처음 쓸 때 지금 글 수로 채우고, 그 뒤로는 트리거가 맞춘다. 한 번 만든 뒤에는 다시 만들지 않는다.
  {
    const t = setup();
    const owner = await t.login('counts-owner@example.test'), other = await t.login('counts-other@example.test');
    await t.feed('big', [owner.user]); await t.feed('small', [owner.user, other.user]);
    for (let i = 0; i < 30; i++) await t.add(`big-${i}`, 'big', i);
    for (let i = 0; i < 4; i++) await t.add(`small-${i}`, 'small', i * 24);
    const first = await t.bootstrap(owner.token);
    assert.deepEqual(await t.stored(), { big: 30, small: 4 }, 'the first use fills counts from the existing articles');
    assert.deepEqual(first.subscriptions.map((s) => [s.feed_id, s.total_count]).sort(), [['big', 30], ['small', 4]]);
    assert.equal(first.counts.totalArticles, 34);
    assert.ok(t.sql.some((query) => query.includes('FROM feed_article_counts c WHERE c.feed_id=s.feed_id')), 'totals come from the stored counts');
    assert.ok(!t.sql.some((query) => /SELECT COUNT\(\*\) FROM articles a WHERE a\.feed_id = f\.id/.test(query)), 'totals no longer count every article');
    const creates = () => t.sql.filter((query) => query.includes('CREATE TRIGGER')).length;
    const before = creates();
    await t.bootstrap(other.token); await t.bootstrap(owner.token);
    assert.equal(creates(), before, 'the table and triggers are made once');

    // 새 글, 같은 글 다시 넣기(수집의 upsert), 지우기, 다른 피드로 옮기기를 트리거가 맞춘다.
    await t.add('big-new', 'big');
    await t.raw.prepare(`INSERT INTO articles(id,feed_id,guid,title,url,published_at,created_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(feed_id,guid) DO UPDATE SET title=excluded.title`).bind('dup', 'big', 'big-new', 'again', 'https://example.test/dup', new Date().toISOString(), new Date().toISOString()).run();
    await t.raw.prepare(`INSERT INTO articles(id,feed_id,guid,title,url,published_at,created_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(feed_id,guid) DO NOTHING`).bind('dup2', 'small', 'small-0', 'again', 'https://example.test/dup2', new Date().toISOString(), new Date().toISOString()).run();
    await t.raw.prepare('DELETE FROM articles WHERE id IN (?,?)').bind('big-0', 'big-1').run();
    await t.raw.prepare('UPDATE articles SET feed_id=? WHERE id=?').bind('small', 'big-2').run();
    await t.raw.prepare('UPDATE articles SET title=? WHERE id=?').bind('renamed', 'big-3').run();
    assert.deepEqual(await t.stored(), await t.actual(), 'inserts, upserts, deletes and moves keep the counts exact');
    assert.deepEqual(await t.stored(), { big: 28, small: 5 });
    const later = await t.bootstrap(owner.token);
    assert.deepEqual(later.subscriptions.map((s) => [s.feed_id, s.total_count]).sort(), [['big', 28], ['small', 5]]);
    const sync = await (await app.request('/api/sync', { method: 'POST', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ cursor: first.syncCursor }) }, t.env)).json();
    assert.deepEqual(sync.subscriptionCounts.map((s) => [s.feed_id, s.total_count]).sort(), [['big', 28], ['small', 5]], 'sync counts use the stored totals too');

    // 만일 어긋나도 정기 실행이 오래 확인하지 않은 피드부터 다시 센다. 사라진 피드의 줄은 지운다.
    await t.raw.prepare('UPDATE feed_article_counts SET total=999, checked_at=0 WHERE feed_id=?').bind('small').run();
    await t.raw.prepare('INSERT INTO feed_article_counts(feed_id,total,checked_at) VALUES(?,?,?)').bind('gone', 7, 5).run();
    assert.equal(await reconcileFeedCounts(t.traced, 1), 1);
    const fixed = await t.stored();
    assert.equal(fixed.small, 5, 'a drifted count is corrected'); assert.equal(fixed.gone, undefined, 'rows for missing feeds are removed');
  }

  // 표나 트리거를 만들지 못하면(오래된 DB 등) 예전처럼 직접 세서 같은 개수를 돌려준다.
  {
    const t = setup((db) => ({ ...db, batch: async (statements) => { throw new Error('triggers are not allowed here'); } }));
    const owner = await t.login('counts-fallback@example.test');
    await t.feed('only', [owner.user]);
    for (let i = 0; i < 3; i++) await t.add(`only-${i}`, 'only', i);
    const warn = console.warn; console.warn = () => {};
    try {
      const data = await t.bootstrap(owner.token);
      assert.deepEqual(data.subscriptions.map((s) => [s.feed_id, s.total_count]), [['only', 3]], 'counting still works without stored counts');
      assert.ok(!t.sql.some((query) => query.includes('FROM feed_article_counts c')), 'the stored counts are not used when missing');
      assert.equal(await feedCountsReady(t.traced), false, 'a failed setup waits before trying again');
    } finally { console.warn = warn; }
  }
  console.log('PASS: feed counts are filled once on first use, kept exact by triggers through inserts, upserts, deletes and moves, used by bootstrap and sync, corrected by the hourly check, and fall back to counting when unavailable.');
} finally { await vite.close(); }
