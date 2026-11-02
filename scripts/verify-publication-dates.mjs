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
  console.log('PASS: original publisher/card dates precede generator and modification times; KST and valid RSS/Atom dates preserved; unrelated/invalid dates rejected; existing IDs/read/bookmarks preserved; Reader View persists and returns original dates; D1 <=100 parameters.');
} finally {
  globalThis.fetch = originalFetch;
  await vite.close();
}
