import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const originalFetch = globalThis.fetch;
try {
  const { analyseBuilderHtml, publicPageUrl, pickerSnapshot, parseListedDate } = await vite.ssrLoadModule('/src/server/rssBuilder.ts');
  const { pickerRuntime, extractPicked, encodePick, decodePick } = await vite.ssrLoadModule('/src/shared/rssPicker.ts');
  const { parseHTML } = await import('linkedom');
  const { parseXmlFeedContent } = await vite.ssrLoadModule('/src/server/rssParser.ts');
  const { LocalD1Database } = await vite.ssrLoadModule('/src/server/localD1.ts');
  const { app } = await vite.ssrLoadModule('/src/server/app.ts');
  const { default: worker } = await vite.ssrLoadModule('/src/worker.ts');
  const source = 'https://builder.example.test/ko/research';
  let count = 2;
  let unavailable = false;
  const html = () => `<html><head><title>Research &amp; reports</title></head><body>
    <nav><a href="/ko/research/not-an-article">Navigation link</a></nav>
    ${Array.from({ length: count }, (_, i) => `<div class="group flex flex-col"><a href="/ko/research/post-${i}"> <img src="/image-${i}.png" alt="Report number ${i}"> </a><a href="/ko/research/post-${i}?utm_source=test"><h3>Report number ${i}</h3></a><a href="/ko/researchers/author">Author profile</a>${i ? '' : '<time dateTime="2026-10-21T15:00:00+09:00">2026.10.21</time>'}</div>`).join('')}
    <section><a href="/other/first">Other section first</a><a href="/other/second">Other section second</a></section>
    <footer><a href="/ko/research/not-a-post">Footer link</a></footer></body></html>`;
  const parsed = analyseBuilderHtml(html(), source);
  assert.equal(parsed.title, 'Research & reports');
  assert.equal(parsed.groups.length, 2);
  const group = parsed.groups[0];
  assert.equal(group.articles.length, 2, 'image and heading links must be deduplicated');
  assert.equal(group.articles[0].title, 'Report number 0');
  assert.equal(group.articles[0].publishedAt, '2026-10-21T06:00:00.000Z');
  assert.equal(group.articles[0].thumbnailUrl, 'https://builder.example.test/image-0.png');
  assert.equal(group.articles[1].dateSource, 'collected');
  assert.equal(analyseBuilderHtml(html(), source, group.selector).groups.length, 1);
  assert.throws(() => analyseBuilderHtml(html(), source, 'a['), /선택/);
  assert.throws(() => analyseBuilderHtml('<title>Vercel Security Checkpoint</title>', source), /차단/);
  for (const url of ['http://localhost/page', 'http://127.0.0.1/page', 'http://[::1]/page', 'file:///etc/passwd', 'https://user:pass@example.com', 'https://metadata.internal/page']) assert.throws(() => publicPageUrl(url));
  const noImage = analyseBuilderHtml('<a href="/post/1"><img>First real article</a><a href="/post/2">Second real article</a>', source);
  assert.equal(noImage.groups[0].articles[0].thumbnailUrl, null);

  // 클릭으로 고르기용 페이지 사본에는 동작하는 콘텐츠가 없다.
  const unsafe = pickerSnapshot(`<html><head><script>steal()</script><meta http-equiv="refresh" content="0;url=https://evil.example.test"></head><body onload="steal()"><a href="javascript:steal()">Bad link</a>${Array.from({ length: 5 }, (_, i) => `<a href="/p/${i}" onclick="steal()">Post ${i}</a>`).join('')}<img data-src="/lazy.png" src="data:image/gif;base64,AAAA"><iframe src="https://evil.example.test"></iframe></body></html>`, source);
  assert.ok(!/<script|onload|onclick|javascript:|http-equiv|<iframe/i.test(unsafe), 'page copy keeps no active content');
  assert.match(unsafe, /<base href="https:\/\/builder\.example\.test\/ko\/research">/);
  assert.match(unsafe, /src="\/lazy\.png"/);
  assert.equal(pickerSnapshot('<a href="/one">One</a>', source), undefined, 'a page without links has nothing to pick');

  // 목록 아래 쪽 번호 링크에서 다음 쪽 주소를 찾는다. 분류 번호처럼 숫자만 다른 링크와 구분한다.
  const { nextListPages, builderListPageArticles } = await vite.ssrLoadModule('/src/server/rssBuilder.ts');
  const pager = (links) => `<html><body>${links.map((href) => `<a href="${href}">x</a>`).join('')}</body></html>`;
  assert.deepEqual(nextListPages(pager(['/news_kr?page=2', '/news_kr?page=3', '/news_kr?page=915', '/news_kr/123']), 'https://list.example.test/news_kr', 2), ['https://list.example.test/news_kr?page=2', 'https://list.example.test/news_kr?page=3']);
  assert.deepEqual(nextListPages(pager(['/src/go.php?c=19&amp;s=news', '/src/go.php?c=20&amp;s=news', '/src/go.php?n=21614&amp;m=view&amp;s=news', '?s=news&amp;p=2', '?s=news&amp;p=3']), 'http://old.example.test/src/go.php?s=news', 2), ['http://old.example.test/src/go.php?s=news&p=2', 'http://old.example.test/src/go.php?s=news&p=3'], 'category numbers are not page numbers');
  assert.deepEqual(nextListPages(pager(['/blog/page/4/', '/blog/page/5/']), 'https://wp.example.test/blog/page/3/', 2), ['https://wp.example.test/blog/page/4/', 'https://wp.example.test/blog/page/5/']);
  assert.deepEqual(nextListPages(pager(['/news?cat=2', '/news?cat=7']), 'https://list.example.test/news', 2), [], 'an unknown name needs the next two pages');
  assert.deepEqual(nextListPages(pager(['/news/1', '/news/2']), 'https://list.example.test/news', 2), []);
  // 게시판은 2쪽부터 글 링크에 목록의 쪽 번호를 붙인다. 떼어서 같은 글은 같은 주소가 되게 한다.
  const secondPage = '<html><body><main>' + [1, 2, 3].map((n) => `<article><h3><a href="/board/${n}?page=2">Second page post ${n}</a></h3></article>`).join('') + '</main></body></html>';
  const secondGroups = analyseBuilderHtml(secondPage, 'https://list.example.test/board?page=2').groups;
  assert.deepEqual(secondGroups[0].articles.map((article) => article.url), [1, 2, 3].map((n) => `https://list.example.test/board/${n}`), 'carried page numbers are dropped and the posts stay one list');
  assert.deepEqual(extractPicked(parseHTML(secondPage).document, { item: 'article', title: 'h3' }, 'https://list.example.test/board?page=2').map((item) => item.url), [1, 2, 3].map((n) => `https://list.example.test/board/${n}`));
  assert.equal(analyseBuilderHtml('<main>' + [1, 2].map((n) => `<article><h3><a href="/view?id=${n}&amp;s=news">Kept query post ${n}</a></h3></article>`).join('') + '</main>', 'https://list.example.test/list?s=news&p=2').groups[0].articles[0].url, 'https://list.example.test/view?id=1&s=news', 'other shared query values stay');

  // 다음 쪽 글을 더 받는다. 이미 받은 글만 나오면 멈추고, 날짜 없는 글은 앞 쪽 글보다 아래에 놓인다.
  const listed = (ids) => `<html><head><title>List</title></head><body><main>${ids.map((id) => `<article><h2><a href="/post/${id}">Post number ${id} headline</a></h2><p>Summary ${id}</p></article>`).join('')}</main></body></html>`;
  const listPages = { 'https://list.example.test/news?page=2': listed([6, 7, 8, 9, 10]), 'https://list.example.test/news?page=3': listed([11, 12, 13, 14, 15]), 'https://list.example.test/news?page=4': listed([11, 12, 13, 14, 15]) };
  const first = analyseBuilderHtml(listed([1, 2, 3, 4, 5]), 'https://list.example.test/news');
  const groupSelector = first.groups[0].selector;
  const pageFetch = globalThis.fetch, asked = [];
  globalThis.fetch = async (input) => { const url = String(input); asked.push(url); return listPages[url] ? new Response(listPages[url], { headers: { 'content-type': 'text/html' } }) : new Response('', { status: 404 }); };
  try {
    const current = first.groups[0].articles.map((article) => ({ ...article, guid: article.url }));
    const more = await builderListPageArticles(Object.keys(listPages), groupSelector, current);
    assert.deepEqual(more.map((article) => article.url.split('/').at(-1)), ['6', '7', '8', '9', '10', '11', '12', '13', '14', '15']);
    assert.equal(asked.length, 3, 'a page with only known posts ends the walk');
    const oldestFirst = Math.min(...current.map((article) => Date.parse(article.publishedAt)));
    assert.ok(more.every((article, index) => Date.parse(article.publishedAt) < oldestFirst && (!index || Date.parse(article.publishedAt) < Date.parse(more[index - 1].publishedAt))), 'undated older pages sort below the first page');
  } finally { globalThis.fetch = pageFetch; }

  // https 앱 안에서 막히는 http 그림·스타일은 서명한 앱 주소로 바꾸고, 서명이 맞는 것만 대신 받는다.
  const { pageAssetProxy, servePageAsset } = await vite.ssrLoadModule('/src/server/pageAssets.ts');
  const secretEnv = { X_SETTINGS_SECRET: 'page-asset-test-secret-0123456789abcdef' };
  assert.equal(pageAssetProxy({}, 'https://app.example.test'), undefined, 'no secret, no proxy');
  assert.equal(pageAssetProxy(secretEnv, 'http://127.0.0.1:5173'), undefined, 'a plain http app has no mixed content to fix');
  const proxy = pageAssetProxy(secretEnv, 'https://app.example.test');
  const httpPage = 'http://old.example.test/src/go.php?s=news';
  const proxied = pickerSnapshot(`<html><head><link rel="stylesheet" href="http://img.example.test/css/a.css"><link rel="stylesheet" href="https://cdn.example.test/b.css"><style>.x{background:url(../bg.gif)}</style></head><body><table><tr><td background="/td.gif">${Array.from({ length: 5 }, (_, i) => `<a href="/p/${i}"><img src="http://img.example.test/t${i}.gif"></a>`).join('')}<img srcset="/s1.png 1x, https://cdn.example.test/s2.png 2x"><div style="background-image:url('/inline.png')"></div><img src="http://127.0.0.1/private.png"></td></tr></table></body></html>`, httpPage, proxy);
  const asset = (url) => proxy(url).replace(/&/g, '&amp;');
  for (const url of ['http://img.example.test/css/a.css', 'http://old.example.test/bg.gif', 'http://old.example.test/td.gif', 'http://img.example.test/t0.gif', 'http://old.example.test/s1.png', 'http://old.example.test/inline.png']) assert.ok(proxied.includes(asset(url)) || proxied.includes(proxy(url)), url);
  for (const kept of ['href="https://cdn.example.test/b.css"', 'https://cdn.example.test/s2.png 2x', 'src="http://127.0.0.1/private.png"']) assert.ok(proxied.includes(kept), `${kept} stays as it is`);
  assert.match(proxy('http://img.example.test/t0.gif'), /^https:\/\/app\.example\.test\/page-asset\/[\w-]{22}\?u=http%3A%2F%2Fimg\.example\.test%2Ft0\.gif$/);
  const served = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input); served.push(url);
    assert.equal(init.redirect, 'manual');
    if (url.endsWith('/moved.gif')) return new Response(null, { status: 301, headers: { location: 'http://127.0.0.1/secret.gif' } });
    if (url.endsWith('.css')) return new Response('.a{background:url(../img/b.gif)}@import "c.css";', { headers: { 'content-type': 'text/css' } });
    if (url.endsWith('.html')) return new Response('<script>x</script>', { headers: { 'content-type': 'text/html' } });
    if (url.endsWith('.svg')) return new Response('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>', { headers: { 'content-type': 'image/svg+xml' } });
    return new Response(new Uint8Array([71, 73, 70]), { headers: { 'content-type': 'image/gif' } });
  };
  try {
    const get = (url, path = proxy(url)) => servePageAsset(new Request(path), secretEnv);
    const gif = await get('http://img.example.test/t0.gif');
    assert.equal(gif.status, 200); assert.equal(gif.headers.get('content-type'), 'image/gif'); assert.deepEqual([...new Uint8Array(await gif.arrayBuffer())], [71, 73, 70]);
    assert.equal(gif.headers.get('cross-origin-resource-policy'), 'cross-origin');
    const css = await (await get('http://img.example.test/css/a.css')).text();
    assert.ok(css.includes(proxy('http://img.example.test/img/b.gif')) && css.includes(proxy('http://img.example.test/css/c.css')), 'addresses inside a proxied stylesheet are proxied too');
    const svg = await get('http://img.example.test/x.svg');
    assert.match(svg.headers.get('content-security-policy'), /sandbox/, 'an SVG opened directly cannot run script in the app origin');
    assert.equal((await get('http://img.example.test/page.html')).status, 415, 'only images and stylesheets');
    assert.equal((await get('http://img.example.test/moved.gif')).status, 502, 'redirects to private hosts are refused');
    assert.ok(!served.some((url) => url.includes('127.0.0.1')));
    const before = served.length;
    assert.equal((await get('http://img.example.test/t0.gif', proxy('http://img.example.test/t0.gif').replace('t0.gif', 't1.gif'))).status, 403, 'a signature only fits its own address');
    assert.equal((await get('https://img.example.test/t0.gif', `https://app.example.test/page-asset/${'a'.repeat(22)}?u=${encodeURIComponent('http://img.example.test/t0.gif')}`)).status, 403);
    assert.equal(served.length, before, 'unsigned requests never reach the network');
  } finally { globalThis.fetch = realFetch; }
  const now = Date.parse('2026-10-22T12:00:00Z');
  assert.equal(parseListedDate('2026.10.21 14:05', now), '2026-10-21T05:05:00.000Z');
  assert.equal(parseListedDate('2026년 10월 21일 오후 2:05', now), '2026-10-21T05:05:00.000Z');
  assert.equal(parseListedDate('Oct 21, 2026', now), '2026-10-20T15:00:00.000Z');
  assert.equal(parseListedDate('3시간 전', now), '2026-10-22T09:00:00.000Z');
  assert.equal(parseListedDate('5 minutes ago', now), '2026-10-22T11:55:00.000Z');
  assert.equal(parseListedDate('Updated 2026', now), null);
  assert.equal(decodePick('pick:{"item":1,"title":""}'), null);
  assert.equal(decodePick('pick:not json'), null);

  const db = new LocalD1Database(':memory:', 'migrations/0001_schema.sql');
  const env = { DB: db, ALLOW_QUICK_LOGIN: 'true' };
  const login = async (email) => (await app.request('https://sfeed.example.test/api/auth/google/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) }, env)).json();
  const { token, user } = await login('builder@example.test');
  const other = await login('another-builder@example.test');
  const request = (path, body, auth = token) => app.request(`https://sfeed.example.test${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, env);
  let fetches = 0;
  const blocked = 'https://blocked.example.test/ko/research';
  const blockedFetches = [];
  let sitemapPosts = [['lombard-s-grand-roadmap', '2026-10-16T04:16:51.007Z'], ['monthly-eip-sep-2026', '2026-10-15T07:30:37.614Z'], ...['old-a', 'old-b', 'old-c'].map((slug) => [slug, '2026-04-21T07:28:58.513Z'])];
  const urlset = (entries) => `<?xml version="1.0"?><urlset>${entries.map(([loc, lastmod]) => `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`).join('')}</urlset>`;
  globalThis.fetch = async (input) => {
    fetches++;
    const url = String(input);
    if (url.startsWith('https://blocked.example.test/') || url.startsWith('https://elsewhere.example.test/')) {
      blockedFetches.push(url);
      if (url === 'https://blocked.example.test/robots.txt') return new Response('User-Agent: *\nSitemap: https://blocked.example.test/sitemap-index.xml\nSitemap: https://elsewhere.example.test/sitemap.xml\n');
      if (url.endsWith('/sitemap-index.xml')) return new Response('<sitemapindex><sitemap><loc>https://blocked.example.test/pages.xml</loc></sitemap><sitemap><loc>https://blocked.example.test/research.xml</loc></sitemap></sitemapindex>');
      if (url.endsWith('/pages.xml')) return new Response(urlset([['https://blocked.example.test/about']]));
      if (url.endsWith('/research.xml')) return new Response(urlset([
        ['https://blocked.example.test/ko/research/crypto'],
        ...sitemapPosts.map(([slug, lastmod]) => [`https://blocked.example.test/ko/research/${slug}`, lastmod]),
        ['https://blocked.example.test/en/research/lombard-s-grand-roadmap', '2026-10-16T04:16:51.007Z'],
      ]));
      return new Response('<title>Vercel Security Checkpoint</title>', { status: 429, headers: { 'x-vercel-mitigated': 'challenge' } });
    }
    if (unavailable) return new Response('Unavailable', { status: 503 });
    if (url.startsWith(source)) return new Response(html(), { headers: { 'content-type': 'text/html' } });
    if (url.includes('/empty')) return new Response('<html><title>No posts</title></html>');
    return new Response('<html><title>Article</title></html>');
  };
  assert.equal((await app.request('/api/rss-builder/analyse', { method: 'POST', body: '{}' }, env)).status, 401);
  for (const url of ['bad value', 'http://127.0.0.1/', 'http://metadata.internal/']) assert.equal((await request('/api/rss-builder/analyse', { url })).status, 400);
  assert.equal(fetches, 0);
  assert.equal((await request('/api/rss-builder/analyse', { url: 'https://builder.example.test/empty' })).status, 422);
  const preview = await request('/api/rss-builder/analyse', { url: source });
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).groups[0].articles.length, 2);
  for (const table of ['feeds', 'articles', 'subscriptions', 'rss_builders', 'folders']) assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n, 0, `analysis must not create ${table}`);
  await db.prepare('INSERT INTO folders(id,user_id,name,color,sort_order,created_at) VALUES(?,?,?,?,?,?)').bind('other-folder', other.user.id, 'Private', '#fff', 0, new Date().toISOString()).run();
  assert.equal((await request('/api/rss-builder', { url: source, selector: group.selector, folderId: 'other-folder' })).status, 404);
  assert.equal((await request('/api/rss-builder', { url: source, selector: group.selector, folderId: {} })).status, 400);
  const body = { url: source, selector: group.selector, title: 'My research', folderName: 'Research' };
  const response = await request('/api/rss-builder', body);
  assert.equal(response.status, 200, await response.clone().text());
  const built = await response.json();
  assert.equal(built.insertedCount, 2);
  assert.match(built.rssUrl, /^https:\/\/sfeed.example.test\/rss\/rss_/);
  const duplicate = await (await request('/api/rss-builder', body)).json();
  assert.equal(duplicate.rssUrl, built.rssUrl);
  assert.equal(duplicate.insertedCount, 0);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM subscriptions').first()).n, 1);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM rss_builders').first()).n, 1);
  assert.equal((await db.prepare('SELECT name FROM folders WHERE user_id=?').bind(user.id).first()).name, 'Research');
  const row = await db.prepare('SELECT id FROM articles WHERE feed_id=? ORDER BY guid').bind(built.feedId).first();
  await db.prepare('INSERT INTO article_states(user_id,article_id,is_read,is_saved) VALUES(?,?,1,1)').bind(user.id, row.id).run();
  const rssResponse = await worker.fetch(new Request(built.rssUrl), env, {});
  assert.equal(rssResponse.status, 200);
  assert.match(rssResponse.headers.get('content-type'), /application\/rss\+xml/);
  const xml = await rssResponse.text();
  assert.equal((xml.match(/<pubDate>/g) || []).length, 1, 'undated posts must not claim a publication date');
  assert.equal(parseXmlFeedContent(xml, built.rssUrl).articles.length, 2);
  assert.ok(!xml.includes(user.email) && !xml.includes('is_read') && !xml.includes('is_saved'));
  assert.equal((await worker.fetch(new Request('https://sfeed.example.test/rss/unknown.xml'), env, {})).status, 404);
  assert.ok((await (await request('/api/opml/export')).text()).includes(built.rssUrl));
  count = 3;
  assert.equal((await (await request('/api/feeds/refresh', { feedId: built.feedId })).json()).newArticles, 1);
  count = 4;
  await worker.scheduled({}, env, {});
  assert.equal((await db.prepare('SELECT count(*) AS n FROM articles WHERE feed_id=?').bind(built.feedId).first()).n, 4, 'scheduled refresh must ingest new website posts');
  assert.deepEqual({ ...await db.prepare('SELECT is_read,is_saved FROM article_states WHERE article_id=?').bind(row.id).first() }, { is_read: 1, is_saved: 1 });
  count = 2;
  await request('/api/feeds/refresh', { feedId: built.feedId });
  assert.equal((await db.prepare('SELECT count(*) AS n FROM articles WHERE feed_id=?').bind(built.feedId).first()).n, 4, 'posts that leave the listing must remain readable');
  unavailable = true;
  await request('/api/feeds/refresh', { feedId: built.feedId });
  assert.match((await db.prepare('SELECT last_error FROM feeds WHERE id=?').bind(built.feedId).first()).last_error, /503/);
  assert.equal((await worker.fetch(new Request(built.rssUrl), env, {})).status, 200, 'stored RSS must remain available during upstream failure');
  unavailable = false;

  // 자동 방문을 막는 사이트: 사이트맵으로 목록을 만든다.
  const fromSitemap = await (await request('/api/rss-builder/analyse', { url: blocked })).json();
  assert.equal(fromSitemap.fromSitemap, true);
  assert.equal(fromSitemap.groups.length, 1);
  const sitemapGroup = fromSitemap.groups[0];
  assert.equal(sitemapGroup.selector, 'sitemap:/ko/research/');
  assert.deepEqual(sitemapGroup.articles.map((article) => article.title), ["Lombard's grand roadmap", 'Monthly eip sep 2026'], 'newest first; no category page, bulk-dated posts or other sections');
  assert.equal(sitemapGroup.articles[0].publishedAt, '2026-10-16T04:16:51.007Z');
  assert.equal(sitemapGroup.articles[0].dateSource, 'feed');
  assert.ok(!blockedFetches.some((url) => url.startsWith('https://elsewhere.example.test/')), 'sitemaps on other hosts are ignored');
  const sitemapBuilt = await (await request('/api/rss-builder', { url: blocked, selector: sitemapGroup.selector, title: '4Pillars' })).json();
  assert.equal(sitemapBuilt.insertedCount, 2);
  sitemapPosts = [['newest-report', '2026-10-21T01:00:00.000Z'], ...sitemapPosts];
  blockedFetches.length = 0;
  assert.equal((await (await request('/api/feeds/refresh', { feedId: sitemapBuilt.feedId })).json()).newArticles, 1);
  assert.ok(!blockedFetches.includes(blocked), 'a sitemap feed refreshes from the sitemap without retrying the blocked page');
  assert.equal((await db.prepare('SELECT title FROM articles WHERE feed_id=? ORDER BY published_at DESC').bind(sitemapBuilt.feedId).first()).title, 'Newest report');

  // 클릭으로 고르기: 처음 보기에 페이지 사본이 함께 오고, 그 위에서 돈 고르기 도구는 제안된
  // 기사의 목록을 고르며, 서버도 같은 것을 뽑아낸다.
  const firstLook = await (await request('/api/rss-builder/analyse', { url: source })).json();
  assert.match(firstLook.snapshot, /Report number 0/);
  assert.ok(!/<script/i.test(firstLook.snapshot));
  const pageCopy = parseHTML(firstLook.snapshot);
  const posted = [];
  const pageGlobals = { document: pageCopy.document, window: pageCopy.window, parent: { postMessage: (message) => posted.push(message) }, Element: pageCopy.window.Element };
  const savedGlobals = Object.fromEntries(Object.keys(pageGlobals).map((key) => [key, globalThis[key]]));
  Object.assign(globalThis, pageGlobals);
  try { pickerRuntime(extractPicked, firstLook.sourceUrl, firstLook.groups[0].articles[0].url); } finally { Object.assign(globalThis, savedGlobals); }
  const chosen = posted.find((message) => message.source === 'sfeed-picker' && message.type === 'selection');
  assert.ok(chosen, 'the suggested article selects its list');
  assert.deepEqual(chosen.selection, { item: 'div.group.flex.flex-col', title: 'h3', image: 'img', date: 'time' }, 'cards, not the byline link, repeat');
  assert.equal(chosen.count, 2);
  assert.equal(chosen.items[0].url, 'https://builder.example.test/ko/research/post-0', 'tracking parameters are dropped');
  const pickSelector = encodePick(chosen.selection, false);
  assert.equal(decodePick(pickSelector).item, chosen.selection.item);
  const pickedFeed = await (await request('/api/rss-builder', { url: source, selector: pickSelector, title: 'Picked' })).json();
  assert.equal(pickedFeed.insertedCount, 2);
  const pickedRows = (await db.prepare('SELECT title,url,thumbnail_url,published_at FROM articles WHERE feed_id=? ORDER BY url').bind(pickedFeed.feedId).all()).results;
  assert.deepEqual(pickedRows.map((row) => row.title), ['Report number 0', 'Report number 1']);
  assert.equal(pickedRows[0].thumbnail_url, 'https://builder.example.test/image-0.png');
  assert.equal(pickedRows[0].published_at, '2026-10-21T06:00:00.000Z');
  count = 3;
  assert.equal((await (await request('/api/feeds/refresh', { feedId: pickedFeed.feedId })).json()).newArticles, 1, 'a picked feed ingests new posts');
  assert.equal((await (await request('/api/rss-builder/site', { url: source })).json()).title, 'Research & reports');
  assert.equal((await (await request('/api/rss-builder/site', { url: blocked })).json()).title, 'blocked.example.test', 'a blocked site still gets a card');
  console.log('PASS: public URL validation, structured list discovery, deduplication, accurate/missing dates, read-only analysis, opt-in creation, folder ownership, stable RSS URL, public XML/OPML, idempotency, manual and scheduled new-post ingestion, retained history/read/save states, upstream failure recovery, sitemap fallback for sites that block automated visits, a script-free page copy, listed-date parsing and point-and-click selection shared by the picker and the server.');
} finally { globalThis.fetch = originalFetch; await vite.close(); }
