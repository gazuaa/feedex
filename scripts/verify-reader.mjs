import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const originalFetch = globalThis.fetch;
try {
  const { extractReaderContent, scrapeFullArticle } = await vite.ssrLoadModule('/src/server/readerScraper.ts');
  const { checkEmbeddable, declaredLayoutWidth } = await vite.ssrLoadModule('/src/server/framing.ts');
  const { app } = await vite.ssrLoadModule('/src/server/app.ts');
  const { LocalD1Database } = await vite.ssrLoadModule('/src/server/localD1.ts');
  const { upsertFeedAndArticles } = await vite.ssrLoadModule('/src/server/seedService.ts');
  const url = 'https://reader.example.test/post';
  const body = '<p>A public article with meaningful text and a source link. '.repeat(8) + '<a href="/reference">Reference</a></p>';
  const html = `<html><head><title>Public article</title><meta property="article:published_time" content="2026-10-21T10:00:00+09:00"><meta property="og:image" content="https://reader.example.test/cover.jpg"></head><body><nav>Navigation</nav><main><article><section>${body}<img src="/inline.jpg" onerror=alert(1)><a href="javascript:alert(1)">Unsafe</a><script>alert(1)</script><iframe src="https://other.example.test"></iframe><div hidden>Hidden content</div></section></article></main><footer>Footer links</footer></body></html>`;
  const result = extractReaderContent(html, url, null);
  assert.equal(result.originalPublishedAt, '2026-10-21T01:00:00.000Z');
  assert.equal(result.leadImageUrl, 'https://reader.example.test/cover.jpg');
  assert.match(result.fullContentHtml, /https:\/\/reader.example.test\/reference/);
  assert.match(result.fullContentHtml, /https:\/\/reader.example.test\/inline.jpg/);
  assert.doesNotMatch(result.fullContentHtml, /onerror|javascript:|<script|<iframe|Navigation|Footer links|Hidden content/i);
  assert.equal(extractReaderContent('<title>Vercel Security Checkpoint</title><main>' + body + '</main>', url, null), null);
  assert.equal(extractReaderContent('<title>Sign in</title><main>' + body + '</main>', url, null), null);
  assert.equal(extractReaderContent('<title>Premium</title><script type="application/ld+json">{"isAccessibleForFree":false}</script><article>' + body + '</article>', url, null), null);
  assert.equal(extractReaderContent('<html><body><div id="app"></div></body></html>', url, null), null);
  // 리더가 제목·출처·날짜를 직접 보여 주므로, 페이지 자체 머리글은 그 버튼들과 다른 기사들과 함께 뺀다 (The Block).
  const headed = extractReaderContent(`<html><head><title>Utah charges Kalshi over gambling | The Block</title><meta property="og:title" content="Utah charges Kalshi over gambling"></head><body><article><div><h1>Utah charges Kalshi over gambling</h1><p>The short summary under the title stays.</p></div><div><span>By </span><a href="/authors/timmy-shen">Timmy Shen</a><span> • Edited by Brian Danga</span></div><div><a href="/news/business">Business</a><span>•</span><span>October 29, 2026, 2:40AM EDT</span></div><a href="https://www.google.com/preferences/source?q=theblock.co"><img src="/google.png" alt="Google">Make us preferred</a><button><div>Share</div></button><p>By the numbers, a short line stays.</p><figure><img src="/court.png"><figcaption>Court photo, October 29, 2026</figcaption></figure>${body}<h2>Background</h2>${body}<h3>Related articles</h3><div><article><a href="/other-1">Another story about prediction markets</a><time>Oct 26, 2026</time></article><article><a href="/other-2">Yet another story</a></article></div></article></body></html>`, url, null).fullContentHtml;
  assert.doesNotMatch(headed, /<h1|Timmy Shen|Edited by|2:40AM|preferences\/source|Make us preferred|Share|Another story|Related articles/, 'the page title, byline, date, badges, buttons and story cards go');
  assert.match(headed, /short summary under the title/); assert.match(headed, /By the numbers/); assert.match(headed, /Court photo, October 29, 2026/); assert.match(headed, /<h2>Background<\/h2>/);
  // Tailwind 사이트의 클래스가 앱의 유틸리티 클래스를 집어 와 본문을 옆으로 늘린다.
  const classed = extractReaderContent(`<article><div class="flex flex-col md:flex-row"><div class="grow shrink-0 basis-full min-w-0">${body}<p class="hidden md:block">Desktop duplicate</p><span class="sr-only">Screen reader note</span></div></div></article>`, url, null).fullContentHtml;
  assert.ok(!/\sclass=/.test(classed) && classed.includes('<div><div>'), 'site classes are dropped and the structure kept');
  assert.ok(!classed.includes('Desktop duplicate') && !classed.includes('Screen reader note'), 'what the site hid on phones stays hidden');

  // Decenter식 지연 이미지: 사진 크기에 맞춘 1×1 대체 이미지가 있고 진짜 이미지는 data-src에 있다.
  const lazyPage = `<html><head><title>Lazy</title></head><body><article>${body}<figure><img loading="lazy" data-src="/photo_P1.webp" src="https://static.example.test/img/1X1.png" width="649" height="392"></figure><img src="/spacer.gif" width="600" height="300"><img data-lazy-src="/wide.jpg" data-srcset="/wide-800.jpg 800w, /wide-1600.jpg 1600w" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><img src="/loading-dock.jpg"><img data-src="/lazy.png" src="/blank.gif"><p>${'More body text. '.repeat(10)}</p></article></body></html>`;
  const lazy = extractReaderContent(lazyPage, url, null).fullContentHtml;
  assert.match(lazy, /src="https:\/\/reader.example.test\/photo_P1.webp"/, 'the real photo replaces its stand-in, so no blank gap remains');
  assert.doesNotMatch(lazy, /1X1\.png|spacer\.gif|data:image\/gif/, 'a bare stand-in with no real image is dropped');
  assert.match(lazy, /src="https:\/\/reader.example.test\/wide.jpg"/);
  assert.match(lazy, /srcset="https:\/\/reader.example.test\/wide-800.jpg 800w, https:\/\/reader.example.test\/wide-1600.jpg 1600w"/, 'lazy srcsets resolve against the article, not the app');
  assert.match(lazy, /loading-dock\.jpg/, 'an ordinary photo whose name merely starts with a placeholder word stays');
  assert.match(lazy, /src="https:\/\/reader.example.test\/lazy.png"/, 'the lazy loader\'s own address is the real image, whatever it is called');
  const { webCopy, pickerSnapshot } = await vite.ssrLoadModule('/src/server/rssBuilder.ts');
  const lazyCopy = webCopy(lazyPage, url);
  assert.match(lazyCopy, /src="\/photo_P1.webp"/, 'the web copy shows the real photo too');
  assert.doesNotMatch(lazyCopy, /1X1\.png|spacer\.gif/);

  const { bodyShowsImage } = await vite.ssrLoadModule('/src/client/articleImages.ts');
  const lead = 'https://wimg.sedaily.com/news/cms/2026/10/28/news-p.v1.20261028.998e09ea2f92490cba5940754a0bad19_T1.jpg';
  assert.equal(bodyShowsImage(`<img src="${lead.replace('_T1', '_P1')}">`, lead), true, 'the lead image is not shown again when the body has it in another size');
  assert.equal(bodyShowsImage('<img src="https://cdn.example.test/uploads/harbor-sunrise-1024x683.jpg">', 'https://cdn.example.test/uploads/harbor-sunrise.jpg'), true);
  assert.equal(bodyShowsImage('<img src="https://cdn.example.test/uploads/harbor-sunset.jpg">', 'https://cdn.example.test/uploads/harbor-sunrise.jpg'), false);
  assert.equal(bodyShowsImage('<img src="https://cdn.example.test/a/img_1.jpg">', 'https://cdn.example.test/b/img_2.jpg'), false, 'short generic names are never treated as the same picture');

  // 사진으로 시작하고 같은 사진을 캡션 달린 figure로 되풀이하는 피드(보안뉴스)는 한 번만 보여 준다.
  const { dropRepeatedImages } = await vite.ssrLoadModule('/src/client/articleImages.ts');
  const { parseHTML } = await import('linkedom');
  const photo = 'https://cdn.example.test/news/photo/202610/146842_129483_520.jpg';
  const { document: repeated } = parseHTML(`<div id="body"><img src="${photo}" class="type:primaryImage"><p>Lead paragraph.</p><div style="text-align:center"><figure><img src="${photo}"><figcaption>Caption</figcaption></figure></div><p><img src="https://cdn.example.test/news/photo/202610/146842_129484_100.jpg"></p><p><a href="/x"><img src="https://cdn.example.test/news/photo/202610/146842_129484_100.jpg"></a></p></div>`);
  dropRepeatedImages(repeated.getElementById('body'));
  const kept = repeated.getElementById('body').innerHTML;
  assert.equal((kept.match(/129483_520/g) || []).length, 1, 'the repeated lead photo shows once');
  assert.match(kept, /<figure><img[^>]+129483_520[^>]*><figcaption>Caption/, 'the captioned copy is the one kept');
  assert.equal((kept.match(/129484_100/g) || []).length, 1);
  assert.ok(!kept.includes('<a href="/x"></a>') && !kept.includes('<p></p>'), 'emptied wrappers go with the duplicate');

  // 광고 칸은 사본에서 더는 돌지 않는 스크립트를 위해 높이를 잡아 둔다 (Decrypt).
  const slots = webCopy(`<html><head><title>Article</title></head><body><article><p>${'Paragraph text. '.repeat(10)}</p><div class="my-8 flex"><div style="min-width:300px;min-height:250px"></div></div><p>Next paragraph.</p><div style="height:280px"><img src="/chart.png"></div><div aria-hidden="true" style="background-image:radial-gradient(#fff 1px, transparent 0);height:1440px"></div><div style="position:fixed;top:16px;bottom:16px"></div><div style="min-height:20px"></div></article></body></html>`, url);
  assert.ok(!slots.includes('min-height:250px') && !slots.includes('class="my-8 flex"'), 'an empty ad slot and its emptied wrapper go');
  assert.ok(slots.includes('/chart.png') && slots.includes('radial-gradient') && slots.includes('position:fixed') && slots.includes('min-height:20px'), 'slots with content, painted or positioned boxes and small spacers stay');
  // 샌드박스 사본에는 출처가 없고, 그 사이트에만 응답하는 CDN은 사본의 CORS 요청을 거절한다 (Cointelegraph).
  const styled = webCopy(`<html><head><title>Article</title><link rel="stylesheet" href="https://cdn.example.test/site.css" crossorigin integrity="sha384-x"></head><body><article><p>${'Paragraph text. '.repeat(10)}</p></article></body></html>`, url);
  assert.ok(styled.includes('href="https://cdn.example.test/site.css"') && !/<link(?=[^>]*stylesheet)[^>]*(?:crossorigin|integrity)/.test(styled), 'stylesheets load as plain requests');
  // 기사 옆의 다른 기사 목록 열은 빼고(Cointelegraph, TechCrunch), 본문 안의 글 상자와 곁글은 둔다.
  const column = webCopy(`<html><head><title>Article</title></head><body><div class="flex"><div class="post"><h1>Title</h1><aside class="takeaways"><p>Key points of the story, in a sentence or two of plain prose.</p></aside><div class="body"><p>${'Paragraph text. '.repeat(10)}</p><aside class="quote">A pulled quote</aside><p>${'More text. '.repeat(10)}</p></div></div><aside class="w-[340px]"><h2>Editor's choice</h2><a href="/a">First other story headline</a><a href="/b">Second other story headline</a></aside><div class="article-sidebar"><div style="min-width:300px"></div></div><div class="sidebar-toggle"><a href="/menu">Menu</a></div></div></body></html>`, url);
  assert.ok(!column.includes("Editor's choice") && !column.includes('article-sidebar'), 'link columns and blank sidebars beside the article go');
  assert.ok(column.includes('Key points') && column.includes('A pulled quote') && column.includes('sidebar-toggle'), 'prose boxes, asides in the text and other names stay');
  // 렌더링된 페이지에는 스크립트가 띄운 쿠키 창이 남아 있을 수 있는데, 사본은 그 창을 실행하지도 닫지도 못한다 (The Block).
  const consent = webCopy(`<html><head><title>Article</title></head><body><article><p>${'Paragraph text. '.repeat(10)}</p><div role="dialog" aria-label="Share">Share this story</div></article><div id="onetrust-consent-sdk"><div id="onetrust-banner-sdk"><p>We and our partners store cookies</p><button>Accept All Cookies</button></div></div><div role="dialog" aria-modal="true"><p>We use cookies to improve your experience.</p><button>Accept</button><button>Reject</button></div></body></html>`, url);
  assert.ok(!/onetrust|our partners store|We use cookies|Accept All/.test(consent), 'consent managers and cookie dialogs go');
  assert.ok(consent.includes('Share this story') && consent.includes('Paragraph text.'), 'other dialogs and the article stay');
  assert.ok(pickerSnapshot(`<html><body><div class="body"><p>${'Paragraph text. '.repeat(20)}</p></div><aside>${Array.from({ length: 12 }, (_, i) => `<a href="/s${i}">Story ${i}</a>`).join('')}</aside></body></html>`, url)?.includes('Story 11'), 'the RSS picker keeps side columns, whose links can be picked');
  // 리드머식 기사: #contents 본문 안의 공개 YouTube 임베드는 리더 보기에서 표준 iframe으로 보존하고, 웹 사본에서는 제자리 재생 카드로 바꾼다.
  const rhythmerHtml = `<html><head><title>Playlist</title></head><body><div class="contents" id="contents"><p>${'Rhythmer hip-hop playlist review body. '.repeat(8)}</p><iframe width="560" height="315" src="https://www.youtube.com/embed/Bk6YI1qcGiQ?origin=https%3A%2F%2Fwww.rhythmer.net&amp;widget_referrer=https%3A%2F%2Fwww.rhythmer.net" title="Track 1"></iframe><iframe width="560" height="315" src="https://www.youtube.com/embed/8m5b9c0d1e2?start=42" title="Track 2"></iframe><iframe src="https://evil.example.test/embed"></iframe></div></body></html>`;
  const rhythmerReader = extractReaderContent(rhythmerHtml, 'http://board.rhythmer.net/src/go.php?n=21637&m=view&s=news', null).fullContentHtml;
  assert.match(rhythmerReader, /<iframe src="https:\/\/www\.youtube\.com\/embed\/Bk6YI1qcGiQ\?rel=0"[^>]*title="Track 1"/);
  assert.match(rhythmerReader, /<iframe src="https:\/\/www\.youtube\.com\/embed\/8m5b9c0d1e2\?start=42&amp;rel=0"[^>]*title="Track 2"/);
  assert.doesNotMatch(rhythmerReader, /evil\.example\.test|widget_referrer/);
  const rhythmerCopy = webCopy(rhythmerHtml, 'http://board.rhythmer.net/src/go.php?n=21637&m=view&s=news');
  assert.ok(rhythmerCopy.includes('class="sfeed-yt-embed"') && rhythmerCopy.includes('data-yt-id="Bk6YI1qcGiQ"'));
  assert.ok(rhythmerCopy.includes('data-yt-id="8m5b9c0d1e2"') && rhythmerCopy.includes('data-yt-start="42"'));
  assert.doesNotMatch(rhythmerCopy, /<iframe/i);
  const { document: ytThumbs } = parseHTML(`<div id="yt"><p><img src="https://i.ytimg.com/vi/Bk6YI1qcGiQ/hqdefault.jpg"></p><p><img src="https://i.ytimg.com/vi/8m5b9c0d1e2/hqdefault.jpg"></p></div>`);
  dropRepeatedImages(ytThumbs.getElementById('yt'));
  assert.equal(ytThumbs.querySelectorAll('img').length, 2, 'distinct YouTube video thumbnails named hqdefault.jpg are never treated as duplicates');
  globalThis.fetch = async () => new Response('challenge', { status: 429, headers: { 'x-vercel-mitigated': 'challenge' } });
  assert.equal((await checkEmbeddable(url, 'https://sfeed.example.test')).reason, 'challenge');
  assert.equal((await scrapeFullArticle(url, '<p>Short feed preview</p>', 'Title')).fullContentHtml, null);
  globalThis.fetch = async () => new Response(html, { headers: { 'x-frame-options': 'DENY' } });
  assert.equal((await checkEmbeddable(url, 'https://sfeed.example.test')).reason, 'framing');
  // 사이트가 viewport로 밝힌 고정 폭을 읽는다. 스스로 맞추는 사이트에는 없다.
  assert.equal(declaredLayoutWidth('<meta charset="utf-8"><META content="width=1080" name="viewport">'), 1080);
  assert.equal(declaredLayoutWidth('<meta name="viewport" content="initial-scale=1, width=1200">'), 1200);
  for (const page of ['<meta name="viewport" content="width=device-width, initial-scale=1">', '<meta name="viewport" content="width=320">', '<meta name="description" content="width=1080">', '<p>none</p>']) assert.equal(declaredLayoutWidth(page), undefined, page);
  globalThis.fetch = async () => new Response('<html><head><meta name="viewport" content="width=1080"></head><body>x</body></html>');
  assert.deepEqual(await checkEmbeddable(url, 'https://sfeed.example.test'), { embeddable: true, url, layoutWidth: 1080 });
  globalThis.fetch = async () => new Response('<html><head><meta name="viewport" content="width=device-width"></head></html>');
  assert.deepEqual(await checkEmbeddable(url, 'https://sfeed.example.test'), { embeddable: true, url });
  globalThis.fetch = async () => new Response(html, { headers: { 'x-frame-options': 'DENY' } });
  assert.ok((await scrapeFullArticle(url, null, 'Title')).fullContentHtml, 'framing restrictions must not prevent ordinary public reader extraction');
  globalThis.fetch = async () => new Response('Gone', { status: 404 });
  assert.equal((await checkEmbeddable(url, 'https://sfeed.example.test')).reason, 'http');

  const db = new LocalD1Database(':memory:', 'migrations/0001_schema.sql');
  const env = { DB: db, ALLOW_QUICK_LOGIN: 'true' };
  const { token, user } = await (await app.request('/api/auth/google/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'reader@example.test' }) }, env)).json();
  const feed = await upsertFeedAndArticles(db, { title: 'Reader fixture', xmlUrl: 'https://reader.example.test/feed', htmlUrl: url, description: null, faviconUrl: null, articles: [{ guid: url, title: 'Public article', url, author: null, summary: null, contentHtml: null, thumbnailUrl: null, publishedAt: new Date().toISOString(), dateSource: 'collected' }] });
  await db.prepare('INSERT INTO subscriptions(id,user_id,feed_id,created_at) VALUES(?,?,?,?)').bind('reader-sub', user.id, feed.feedId, new Date().toISOString()).run();
  const row = await db.prepare('SELECT * FROM articles WHERE feed_id=?').bind(feed.feedId).first();
  await db.prepare('INSERT INTO article_states(user_id,article_id,is_read,is_saved) VALUES(?,?,0,1)').bind(user.id, row.id).run();
  const request = (body = {}) => app.request(`/api/articles/${row.id}/reader-view`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }, env);
  assert.equal((await app.request(`/api/articles/${row.id}/reader-view`, { method: 'POST', body: '{}' }, env)).status, 401);
  globalThis.fetch = async () => new Response('<title>Vercel Security Checkpoint</title>' + body, { headers: { 'x-vercel-mitigated': 'challenge' } });
  assert.equal((await request()).status, 502);
  assert.equal((await db.prepare('SELECT full_content_html FROM articles WHERE id=?').bind(row.id).first()).full_content_html, null, 'a challenge must never be saved as an article body');
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; return new Response(html); };
  const recovered = await request();
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).publishedAt, '2026-10-21T01:00:00.000Z');
  assert.equal((await (await request()).json()).cached, true);
  assert.equal(fetches, 1, 'reopening should reuse the real cached body');
  globalThis.fetch = async () => new Response('Unavailable', { status: 503 });
  assert.equal((await request({ force: true })).status, 502);
  assert.ok((await db.prepare('SELECT full_content_html FROM articles WHERE id=?').bind(row.id).first()).full_content_html, 'a failed refresh must retain a previously read body');
  assert.deepEqual({ ...await db.prepare('SELECT is_read,is_saved FROM article_states WHERE article_id=?').bind(row.id).first() }, { is_read: 0, is_saved: 1 });
  // 프레임을 거부하는 사이트의 웹 보기 대체: 구독자에게만 주는 스크립트 없는 사본이며,
  // 링크는 새 탭에서 열린다.
  const stranger = await (await app.request('/api/auth/google/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'stranger@example.test' }) }, env)).json();
  const copyRequest = (auth = token) => app.request(`/api/articles/${row.id}/web-copy`, { headers: { authorization: `Bearer ${auth}` } }, env);
  globalThis.fetch = async () => new Response(html, { headers: { 'x-frame-options': 'DENY' } });
  const copy = await (await copyRequest()).json();
  const baseTag = copy.html.match(/<base [^>]*>/)?.[0] || '';
  assert.ok(baseTag.includes('href="https://reader.example.test/post"') && baseTag.includes('target="_blank"'), baseTag);
  assert.match(copy.html, /meaningful text/);
  assert.doesNotMatch(copy.html, /<script|onerror|javascript:|<iframe/i);
  assert.equal((await copyRequest(stranger.token)).status, 404, 'only subscribers get a copy');
  globalThis.fetch = async () => new Response('challenge', { status: 429, headers: { 'x-vercel-mitigated': 'challenge' } });
  assert.equal((await copyRequest()).status, 502);
  console.log('PASS: public body extraction, relative assets, original date, safe markup, framing/challenge/HTTP distinction, no fake challenge or paywall body, authenticated reader cache/retry, preserved saved/read state and a script-free web copy for subscribers; lazy images revealed, blank stand-ins dropped and the lead image shown once.');
} finally { globalThis.fetch = originalFetch; await vite.close(); }
