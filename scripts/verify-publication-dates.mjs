import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const originalFetch = globalThis.fetch;
try {
  const { parseXmlFeedContent } = await vite.ssrLoadModule('/src/server/rssParser.ts');
  const { extractOriginalPublishedAt, extractSummaryPublishedAt, parsePublicationDate } = await vite.ssrLoadModule('/src/server/publicationDate.ts');
  const { upsertFeedAndArticles } = await vite.ssrLoadModule('/src/server/seedService.ts');
  const { LocalD1Database } = await vite.ssrLoadModule('/src/server/localD1.ts');
  const { app } = await vite.ssrLoadModule('/src/server/app.ts');
  const { formatArticleDate } = await vite.ssrLoadModule('/src/client/api.ts');
  const url = 'https://www.hankyung.com/article/202609117709i';
  const published = '2026-09-10T15:58:00.000Z'; // 9월 11일 00:58 KST
  const updated = '2026-10-21T14:15:13.000Z';
  const card = `<h2 class="news-tit"><a href="${url}">Test title</a></h2><p class="txt-date">2026.09.11 00:58</p>`;
  const rss = (body = card, date = updated) => parseXmlFeedContent(`<rss><channel><title>Reporter</title><link>https://www.hankyung.com/</link><item><guid>stable-guid</guid><link>${url}</link><title>Test title</title><pubDate>${date}</pubDate><description><![CDATA[${body}]]></description></item></channel></rss>`, 'https://example.test/generated-rss');
  assert.equal(rss().articles[0].publishedAt, published);
  assert.equal(rss().articles[0].originalPublishedAt, published);
  assert.equal(extractOriginalPublishedAt(card.replace(url, 'https://www.hankyung.com/article/other'), url), null, 'related card must not date the current article');
  const postCard = '<h2><a href="https://www.blockmedia.co.kr/archives/1063994">A linked post</a></h2><div class="post-meta"><span class="date"><time class="post-date" datetime="2026-03-17T20:05:00+09:00">2026-03-17 20:05</time></span></div>';
  assert.equal(extractOriginalPublishedAt(postCard, 'https://www.blockmedia.co.kr/archives/1063994'), '2026-03-17T11:05:00.000Z');
  assert.equal(extractOriginalPublishedAt(postCard, 'https://www.blockmedia.co.kr/archives/another'), null, 'another linked post must not supply a date');
  assert.equal(extractOriginalPublishedAt(postCard.replace('post-date', 'post-date updated'), 'https://www.blockmedia.co.kr/archives/1063994'), null, 'an updated card time is not a publication date');
  assert.equal(extractOriginalPublishedAt('<p>A meeting on 2026.09.11 00:58</p>', url), null);
  assert.equal(extractOriginalPublishedAt('<time itemprop="dateModified" datetime="2026-10-21T00:00:00Z"></time>', url), null);
  assert.equal(extractOriginalPublishedAt('<meta property="article:modified_time" content="2026-10-21T00:00:00Z">', url), null);
  assert.equal(extractOriginalPublishedAt(`<meta content="2026-09-11T00:58:00+09:00" property="article:published_time"><meta property="article:modified_time" content="${updated}">`, url), published);
  assert.equal(extractOriginalPublishedAt('<time datetime="2026-09-11T00:58:00+09:00" itemprop="datePublished">Yesterday</time>', url), published);
  assert.equal(extractOriginalPublishedAt('<time class="entry-date published" datetime="2026-09-11T00:58:00+09:00">Yesterday</time>', 'https://other.test/blog/post'), published);
  assert.equal(extractOriginalPublishedAt('<meta name="parsely-pub-date" content="2026-09-11T00:58:00+09:00">', 'https://other.test/blog/post'), published);
  assert.equal(extractOriginalPublishedAt('<meta property="article:published_time" content="2026-10-21T20:16:02">', 'https://decrypt.co/article'), null, 'timezone-less overseas metadata must not be shifted by a Korean timezone assumption');
  const structured = (data) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
  assert.equal(extractOriginalPublishedAt(structured({ '@graph': [
    { '@type': 'NewsArticle', url: 'https://example.test/related', datePublished: updated },
    { '@type': 'NewsArticle', url, dateModified: updated, datePublished: '2026-09-11T00:58:00+09:00' },
  ] }), url), published);
  assert.equal(extractOriginalPublishedAt(structured({ '@type': 'Event', startDate: updated, datePublished: updated }), url), null);
  assert.equal(extractOriginalPublishedAt('<script type="application/ld+json">broken JSON</script>', url), null);
  assert.equal(extractSummaryPublishedAt('Test title 2026.09.11 00:58 글로벌 증시 Delivered by PolitePaul service', 'Test title', url), published);
  assert.equal(extractSummaryPublishedAt('Related title 2026.09.11 00:58', 'Test title', url), null);
  assert.equal(extractSummaryPublishedAt('Test title 2026.09.11 00:58', 'Test title', 'https://example.test/story'), null);
  assert.equal(extractSummaryPublishedAt('Digital Asset Research 이슈 Test title 포필러스 강희창 2025-08-05 20:00', 'Test title', 'https://www.blockmedia.co.kr/archives/956628'), '2025-08-05T11:00:00.000Z');
  assert.equal(extractSummaryPublishedAt('Digital Asset Research 이슈 Test title 포필러스 정재환(Jay) 2025-09-03 19:05', 'Test title', 'https://www.blockmedia.co.kr/archives/970428'), '2025-09-03T10:05:00.000Z');
  assert.equal(extractSummaryPublishedAt('Test title 본문에서 2025-08-05 20:00에 일어난 일을 설명합니다.', 'Test title', 'https://www.blockmedia.co.kr/archives/956628'), null);
  assert.equal(parsePublicationDate('2026.02.30 12:00'), null);
  assert.equal(parsePublicationDate('2026-09-11 00:58:00'), published);
  assert.equal(parsePublicationDate('Fri, 11 Sep 2026 00:58:00 +0900'), published);
  assert.equal(parsePublicationDate('2026-09-11T00:58:00+09:00'), published);
  const atom = parseXmlFeedContent(`<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><entry><id>atom-guid</id><title>Atom title</title><link href="https://example.test/article"/><published>2026-09-11T00:58:00+09:00</published><updated>${updated}</updated></entry></feed>`, 'https://example.test/atom');
  assert.equal(atom.articles[0].publishedAt, published, 'published must precede updated');
  const invalid = parseXmlFeedContent(`<rss><channel><title>RSS</title><item><pubDate>invalid</pubDate><published>2026-09-11T00:58:00+09:00</published></item></channel></rss>`, 'https://example.test/rss');
  assert.equal(invalid.articles[0].publishedAt, published, 'invalid first field must not mask a valid publication field');

  const database = new LocalD1Database(':memory:', 'migrations/0001_schema.sql');
  let maxParameters = 0;
  const db = {
    prepare(sql) {
      const statement = database.prepare(sql);
      return new Proxy(statement, { get(target, key) {
        if (key === 'bind') return (...values) => { maxParameters = Math.max(maxParameters, values.length); return target.bind(...values); };
        return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
      } });
    },
    batch: (statements) => database.batch(statements), exec: (sql) => database.exec(sql),
  };
  const env = { DB: db, ALLOW_QUICK_LOGIN: 'true' };
  const login = await app.request('/api/auth/google/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'dates@example.test' }) }, env);
  const { token, user } = await login.json();
  const parsed = rss();
  const legacy = { ...parsed, articles: parsed.articles.map((article) => ({ ...article, publishedAt: updated, originalPublishedAt: null, dateSource: 'feed' })) };
  const { feedId } = await upsertFeedAndArticles(db, legacy);
  const row = await db.prepare('SELECT * FROM articles WHERE feed_id = ?').bind(feedId).first();
  // 옛 시각이 created_at과 가깝지 않아서 예전 추정 방식은 이를 놓쳤다.
  await db.prepare('UPDATE articles SET created_at = ? WHERE id = ?').bind('2026-10-21T23:30:13.808Z', row.id).run();
  await db.prepare('INSERT INTO article_states(user_id,article_id,is_read,is_saved) VALUES(?,?,1,1)').bind(user.id, row.id).run();
  assert.equal((await upsertFeedAndArticles(db, parsed)).insertedCount, 0);
  assert.equal((await db.prepare('SELECT published_at FROM articles WHERE id = ?').bind(row.id).first()).published_at, published);
  assert.deepEqual({ ...await db.prepare('SELECT is_read,is_saved FROM article_states WHERE article_id = ?').bind(row.id).first() }, { is_read: 1, is_saved: 1 });
  // 생성기가 같은 시각을 되풀이해도 고친 원문 날짜를 뒤로 밀 수 없다.
  await upsertFeedAndArticles(db, legacy);
  assert.equal((await db.prepare('SELECT published_at FROM articles WHERE id = ?').bind(row.id).first()).published_at, published);
  const bulk = { ...parsed, articles: Array.from({ length: 8 }, (_, i) => ({ ...parsed.articles[0], guid: `bulk-${i}` })) };
  await upsertFeedAndArticles(db, bulk);
  assert.ok(maxParameters <= 100, `D1 bind limit exceeded: ${maxParameters}`);

  // 리더 보기는 datePublished를 골라 저장하고, 이미 열린 서랍에 돌려줘야 한다.
  // 수정 날짜만 긁어 왔을 때는 기존 날짜를 지켜야 한다.
  await db.prepare('UPDATE articles SET published_at = ?, content_html = NULL WHERE id = ?').bind(updated, row.id).run();
  await db.prepare('INSERT INTO subscriptions(id,user_id,feed_id,created_at) VALUES(?,?,?,?)').bind('reader-sub', user.id, feedId, updated).run();
  globalThis.fetch = async () => new Response(`<html><head><meta property="article:published_time" content="2026-09-11T00:58:00+09:00"><meta property="article:modified_time" content="${updated}"></head><body><article><p>${'Real article content. '.repeat(30)}</p></article></body></html>`);
  const read = async (body = {}) => app.request(`/api/articles/${row.id}/reader-view`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }, env);
  const response = await read();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).publishedAt, published);
  assert.equal((await db.prepare('SELECT published_at FROM articles WHERE id = ?').bind(row.id).first()).published_at, published);
  globalThis.fetch = async () => new Response(`<meta property="article:modified_time" content="${updated}"><article><p>${'Real article content. '.repeat(30)}</p></article>`);
  assert.equal((await (await read({ force: true })).json()).publishedAt, published);
  assert.equal((await (await read()).json()).publishedAt, published, 'cached reader responses must include the publication date');
  // 막힌 페이지는 지어낸 본문이 아니라 오류다. 캐시된 실제 본문은 그대로 남는다.
  globalThis.fetch = async () => new Response('<title>Vercel Security Checkpoint</title>', { status: 429 });
  assert.equal((await read({ force: true })).status, 502);
  assert.match((await db.prepare('SELECT full_content_html FROM articles WHERE id = ?').bind(row.id).first()).full_content_html, /Real article content/);
  await db.prepare("UPDATE articles SET full_content_html = '<div class=\"reader-fallback-content\">x</div>' WHERE id = ?").bind(row.id).run();
  assert.equal((await read()).status, 502, 'an old made-up body is not served from cache');
  assert.equal((await db.prepare('SELECT full_content_html FROM articles WHERE id = ?').bind(row.id).first()).full_content_html, null);
  await db.prepare('DELETE FROM subscriptions WHERE id = ?').bind('reader-sub').run();
  assert.equal((await read()).status, 404, 'Reader View only extracts articles from subscribed feeds');
  // 한국경제만이 아니라 모든 언론사를, 사용자가 리더 보기로 바꿀 때만이 아니라
  // 글을 열 때마다 확인한다.
  const other = { ...rss('', updated), xmlUrl: 'https://other.test/rss', articles: [{ ...rss('', updated).articles[0], guid: 'other-story', url: 'https://other.test/post', dateSource: 'updated' }] };
  const otherFeed = await upsertFeedAndArticles(db, other);
  await db.prepare('INSERT INTO subscriptions(id,user_id,feed_id,created_at) VALUES(?,?,?,?)').bind('date-sub', user.id, otherFeed.feedId, updated).run();
  const otherRow = await db.prepare('SELECT * FROM articles WHERE feed_id=?').bind(otherFeed.feedId).first();
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; return new Response(`<script type="application/ld+json">{"@type":"BlogPosting","url":"https://other.test/post","datePublished":"2026-09-11T00:58:00+09:00","dateModified":"${updated}"}</script>`); };
  const dateRequest = () => app.request(`/api/articles/${otherRow.id}/publication-date`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }, env);
  const verified = await (await dateRequest()).json();
  assert.equal(verified.publishedAt, published);
  assert.equal(verified.dateSource, 'original');
  await dateRequest();
  assert.equal(fetched, 1, 'reopening must reuse the saved original date');
  assert.equal((await db.prepare('SELECT published_at FROM articles WHERE id=?').bind(otherRow.id).first()).published_at, published);
  // 나중에 피드를 새로고침해도(빠진 이미지 보충 포함) 확인된 원문 날짜를 예전
  // 9시간 추정값으로 바꿀 수 없다.
  await upsertFeedAndArticles(db, { ...other, articles: other.articles.map((a) => ({ ...a, publishedAt: '2026-09-10T06:58:00.000Z', dateSource: 'feed', thumbnailUrl: 'https://other.test/photo.jpg' })) });
  assert.equal((await db.prepare('SELECT published_at FROM articles WHERE id=?').bind(otherRow.id).first()).published_at, published);
  assert.equal(formatArticleDate({ published_at: updated, date_source: 'updated' }), '발행일 미제공');
  assert.equal(formatArticleDate({ published_at: updated, date_source: 'collected' }), '발행일 미제공');
  assert.notEqual(formatArticleDate({ published_at: published, date_source: 'original' }), '발행일 미제공');
  const privateArticle = await app.request(`/api/articles/${row.id}/publication-date`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }, env);
  assert.equal(privateArticle.status, 404, 'unsubscribed articles must not be fetched through another account');
  // 예약 실행의 발행일 확인: 한 번에 조금씩, 하나씩 차례로, 실패해도 정기 실행은 끝까지 돈다.
  const { checkFeedPublicationDates, PUBLICATION_CHECK_FEEDS, PUBLICATION_CHECK_RECENT } = await vite.ssrLoadModule('/src/server/articlePublication.ts');
  const { default: worker } = await vite.ssrLoadModule('/src/worker.ts');
  const checkDb = new LocalD1Database(':memory:', 'migrations/0001_schema.sql');
  const feedOf = async (name, count = 1) => (await upsertFeedAndArticles(checkDb, parseXmlFeedContent(
    `<rss><channel><title>${name}</title><link>https://example.test/${name}</link>${Array.from({ length: count }, (_, index) => `<item><guid>${name}-${index}</guid><title>${name} ${index}</title><link>https://example.test/${name}/${index}</link><pubDate>${new Date(Date.UTC(2026, 0, 1) + index * 3600000).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`,
    `https://example.test/${name}.xml`,
  ))).feedId;
  const feedIds = [];
  for (let index = 0; index < PUBLICATION_CHECK_FEEDS * 2 + 10; index++) feedIds.push(await feedOf(`check-${index}`));
  assert.equal(new Set(feedIds).size, feedIds.length);
  const checkedCount = async () => (await checkDb.prepare('SELECT COUNT(*) AS n FROM article_date_checks').first()).n;
  // 저장할 때 남는 기록을 지워, 아직 확인 안 한 글로 만든다.
  await checkDb.prepare('DELETE FROM article_date_checks').run();
  let inFlight = 0, mostInFlight = 0;
  globalThis.fetch = async () => {
    mostInFlight = Math.max(mostInFlight, ++inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight--;
    return new Response('', { status: 404 });
  };
  await checkFeedPublicationDates(checkDb, feedIds);
  assert.equal(await checkedCount(), PUBLICATION_CHECK_FEEDS, 'one scheduled run checks a limited number of feeds');
  assert.equal(mostInFlight, 1, 'publication checks run one at a time');
  // 자리와 상관없이 모든 피드에 차례가 돌아온다.
  for (let run = 0; run < 60 && await checkedCount() < feedIds.length; run++) await checkFeedPublicationDates(checkDb, feedIds);
  assert.equal(await checkedCount(), feedIds.length, 'every feed eventually gets a turn');
  // 오래된 글까지 훑지 않도록 피드마다 최근 글만 본다.
  const bigFeed = await feedOf('big', PUBLICATION_CHECK_RECENT + 1);
  const bigRows = (await checkDb.prepare('SELECT id FROM articles WHERE feed_id=? ORDER BY published_at DESC,id DESC').bind(bigFeed).all()).results;
  assert.equal(bigRows.length, PUBLICATION_CHECK_RECENT + 1);
  await checkDb.prepare('DELETE FROM article_date_checks WHERE article_id IN (SELECT id FROM articles WHERE feed_id=?)').bind(bigFeed).run();
  for (const row of bigRows.slice(0, PUBLICATION_CHECK_RECENT - 1)) await checkDb.prepare("INSERT INTO article_date_checks(article_id,source,checked_at) VALUES(?,'original',?)").bind(row.id, new Date().toISOString()).run();
  const hasCheck = async (id) => Boolean(await checkDb.prepare('SELECT 1 AS found FROM article_date_checks WHERE article_id=?').bind(id).first());
  await checkFeedPublicationDates(checkDb, [bigFeed]);
  assert.equal(await hasCheck(bigRows[PUBLICATION_CHECK_RECENT - 1].id), true, 'the last recent article is still checked');
  await checkFeedPublicationDates(checkDb, [bigFeed]);
  assert.equal(await hasCheck(bigRows[PUBLICATION_CHECK_RECENT].id), false, 'articles past the recent window are left to the reader path');
  // 쿼리 통계는 새벽 한 번만 만든다.
  const { refreshQueryStats } = await vite.ssrLoadModule('/src/server/queryStats.ts');
  const STATS_TIME = Date.UTC(2026, 10, 4, 19, 0);
  const hasQueryStats = async () => Boolean(await checkDb.prepare("SELECT 1 AS found FROM sqlite_master WHERE name='sqlite_stat1'").first());
  for (const offset of [-15, 15, 60]) await refreshQueryStats(checkDb, STATS_TIME + offset * 60000);
  assert.equal(await hasQueryStats(), false, 'query statistics wait for their daily slot');
  const originalConsoleLog = console.log;
  console.log = () => {};
  try { await refreshQueryStats(checkDb, STATS_TIME); } finally { console.log = originalConsoleLog; }
  assert.ok((await checkDb.prepare("SELECT COUNT(*) AS n FROM sqlite_stat1 WHERE tbl='articles'").first()).n > 0, 'query statistics are collected');
  // 과부하면 그 회차는 바로 멈추고, 다른 오류는 그 피드만 건너뛴다.
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...values) => logged.push(values.join(' '));
  try {
    let selects = 0;
    const failingSelect = (message, failOn = () => true) => ({
      prepare(sql) {
        if (!sql.includes('recent JOIN articles')) return checkDb.prepare(sql);
        return { bind: (...values) => ({ first: async () => {
          selects++;
          if (failOn(selects)) throw new Error(message);
          return checkDb.prepare(sql).bind(...values).first();
        } }) };
      },
      batch: (statements) => checkDb.batch(statements),
    });
    await checkFeedPublicationDates(failingSelect('D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window'), feedIds);
    assert.equal(selects, 1, 'an overloaded database stops the run at once');
    selects = 0;
    await checkFeedPublicationDates(failingSelect('D1_ERROR: some other failure', (count) => count === 1), feedIds);
    assert.equal(selects, PUBLICATION_CHECK_FEEDS, 'any other failure only skips that feed');
    // 어느 단계가 실패해도 정기 실행은 오류로 끝나지 않고 뒤 단계까지 돈다.
    const scheduledAt = new Date().toISOString();
    await checkDb.prepare('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?)')
      .bind('scheduled-user', 'scheduled@example.test', 'Scheduled', scheduledAt).run();
    await checkDb.prepare('INSERT INTO subscriptions(id,user_id,feed_id,created_at) VALUES(?,?,?,?)')
      .bind('scheduled-sub', 'scheduled-user', bigFeed, scheduledAt).run();
    const attempted = [];
    const down = {
      prepare(sql) {
        if (sql.includes('rss_builders b')) return checkDb.prepare(sql);
        attempted.push(sql);
        throw new Error('D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window');
      },
      batch: () => { throw new Error('D1_ERROR: D1 DB is overloaded.'); },
    };
    logged.length = 0;
    await worker.scheduled({ scheduledTime: STATS_TIME }, { DB: down }, {});
    assert.equal(attempted[0], 'ANALYZE', 'query statistics come first in their daily run');
    assert.ok(logged.some((line) => line.includes('쿼리 통계')), 'a failed statistics step is logged');
    assert.ok(attempted.some((sql) => sql.includes('recent JOIN articles')), 'the publication step still runs after earlier failures');
    assert.ok(attempted.some((sql) => sql.includes('reader_sync')), 'the prune step still runs after earlier failures');
    assert.ok(logged.some((line) => line.includes('동기화 기록 정리')), 'a failed step is logged');
  } finally {
    console.error = originalConsoleError;
  }
  console.log('PASS: original publisher/card dates precede generator and modification times; KST and valid RSS/Atom dates preserved; unrelated/invalid dates rejected; existing IDs/read/bookmarks preserved; Reader View persists and returns original dates; D1 <=100 parameters.');
} finally {
  globalThis.fetch = originalFetch;
  await vite.close();
}
