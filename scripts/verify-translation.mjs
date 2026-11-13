import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DOMParser } from 'linkedom';
import { createServer } from 'vite';

// 글 번역: DeepL 키가 있으면 DeepL로 HTML을 통째로, 없거나 막히면 Workers AI로 문단마다 번역하고, 번역은 글마다 저장한다.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const originalFetch = globalThis.fetch;
const previousParser = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser');
try {
  const translator = await vite.ssrLoadModule('/src/server/translator.ts');
  const { validDeepLKey, deeplBase, htmlChunks, mostlyKorean, parseTranslations, translateArticle, TranslationError, DEEPL_REQUEST, AI_TRANSLATION_MODELS } = translator;
  const freeKey = '12345678-90ab-cdef-1234-567890abcdef:fx';
  assert.equal(validDeepLKey(freeKey), true); assert.equal(validDeepLKey('12345678-90ab-cdef-1234-567890abcdef'), true);
  assert.equal(validDeepLKey('bad key with spaces'), false); assert.equal(validDeepLKey(`${freeKey}\n`), false);
  assert.equal(deeplBase(freeKey), 'https://api-free.deepl.com', 'free keys use the free endpoint');
  assert.equal(deeplBase('12345678-90ab-cdef-1234-567890abcdef'), 'https://api.deepl.com');
  assert.equal(mostlyKorean('이미 한국어로 된 문장입니다'), true); assert.equal(mostlyKorean('An English sentence'), false);
  assert.deepEqual(parseTranslations('```json\n["가","나"]\n```', 2), ['가', '나'], 'code fences around the array are ignored');
  assert.equal(parseTranslations('["가"]', 2), null, 'a wrong count is refused');
  assert.equal(parseTranslations('번역할 수 없습니다', 1), null);
  const paragraphs = Array.from({ length: 200 }, (_, index) => `<p>Paragraph ${index} ${'word '.repeat(80)}</p>`).join('');
  const chunks = htmlChunks(paragraphs);
  assert.ok(chunks.length > 1, 'a long article is split');
  assert.ok(chunks.every((chunk) => chunk.length <= 20_000), 'each part stays under the limit');
  assert.equal(chunks.join(''), paragraphs, 'the parts join back into the same article');

  // DeepL: 무료 키 주소, 인증 머리글, HTML 태그 처리, 한국어 대상, 제목은 이스케이프했다가 되돌린다.
  const calls = [];
  const deeplFetch = (status = 200) => async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
    if (status !== 200) return new Response('{}', { status });
    if (url.endsWith('/v2/usage')) return Response.json({ character_count: 1234, character_limit: 500000 });
    const body = JSON.parse(init.body);
    return Response.json({ translations: body.text.map((text) => ({ detected_source_language: 'EN', text: `번역:${text}` })) });
  };
  const keyEnv = { DEEPL_API_KEY: freeKey };
  const result = await translateArticle(keyEnv, { title: 'A & B <C>', html: '<p>Hello <a href="https://a.test/">world</a></p>' }, deeplFetch());
  assert.equal(calls[0].url, 'https://api-free.deepl.com/v2/translate');
  assert.equal(calls[0].init.headers.Authorization, `DeepL-Auth-Key ${freeKey}`);
  assert.equal(calls[0].body.target_lang, 'KO'); assert.equal(calls[0].body.tag_handling, 'html');
  assert.equal(calls[0].body.text[0], 'A &amp; B &lt;C&gt;', 'the title is escaped for HTML handling');
  assert.equal(result.title, '번역:A & B <C>', 'and unescaped afterwards');
  assert.equal(result.html, '번역:<p>Hello <a href="https://a.test/">world</a></p>', 'links stay in the DeepL result');
  assert.equal(result.provider, 'deepl');
  calls.length = 0;
  const long = await translateArticle(keyEnv, { title: 'Long', html: paragraphs }, deeplFetch());
  assert.ok(calls.length > 1, 'a long article takes several requests');
  assert.ok(calls.every((call) => call.body.text.reduce((sum, text) => sum + text.length, 0) <= DEEPL_REQUEST), 'each request stays under the size limit');
  assert.equal(long.html, chunks.map((chunk) => `번역:${chunk}`).join(''), 'parts come back in order');

  // Workers AI: 안쪽 블록만 문단마다 번역하고, 코드와 이미 한국어인 문단은 그대로 둔다. 실패한 모델 다음 모델을 쓴다.
  const aiCalls = [];
  const fakeAI = (failFirst = false) => ({
    async run(model, inputs) {
      aiCalls.push(model);
      if (failFirst && model === AI_TRANSLATION_MODELS[0]) throw new Error('unavailable');
      const texts = JSON.parse(inputs.messages[1].content);
      return { response: `여기 번역입니다:\n${JSON.stringify(texts.map((text) => `[KO] ${text}`))}` };
    },
  });
  const html = '<p>Hello <a href="https://a.test/">world</a></p><ul><li>One</li><li><p>Nested</p></li></ul><pre><p>code()</p></pre><p>이미 한국어 문단입니다</p>';
  const ai = await translateArticle({ AI: fakeAI(true) }, { title: 'Title', html });
  assert.equal(ai.provider, 'workers-ai'); assert.equal(ai.model, AI_TRANSLATION_MODELS[1], 'a failing model falls through to the next one');
  assert.equal(ai.title, '[KO] Title');
  const document = new DOMParser().parseFromString(`<div>${ai.html}</div>`, 'text/html');
  assert.equal(document.querySelector('p').textContent, '[KO] Hello world');
  assert.equal(document.querySelectorAll('li')[0].textContent, '[KO] One');
  assert.equal(document.querySelector('li p').textContent, '[KO] Nested', 'only the innermost block is translated');
  assert.equal(document.querySelector('pre').textContent, 'code()', 'code is left alone');
  assert.match(ai.html, /이미 한국어 문단입니다/, 'Korean paragraphs are left alone');
  const structured = await translateArticle({ AI: { async run(_model, input) {
    const texts = JSON.parse(input.messages[1].content);
    return { response: { translations: texts.length > 1 ? ['누락된 결과'] : texts.map((text) => `번역 ${text}`) } };
  } } }, { title: 'Headline', html: '<p>First paragraph</p><p>Second paragraph</p>' });
  assert.equal(structured.title, '번역 Headline');
  assert.equal(structured.html, '<p>번역 First paragraph</p><p>번역 Second paragraph</p>', 'a malformed batch is retried in smaller groups without dropping paragraphs');

  // DeepL이 막히면 Workers AI로 번역하고 이유를 알린다. 둘 다 없으면 번역할 수 없다고 알린다.
  const quota = await translateArticle({ ...keyEnv, AI: fakeAI() }, { title: 'Title', html: '<p>Hello</p>' }, deeplFetch(456));
  assert.equal(quota.provider, 'workers-ai'); assert.match(quota.notice, /한도/); assert.match(quota.notice, /Workers AI로 번역했어요/);
  await assert.rejects(translateArticle({}, { title: 'Title', html: '<p>Hello</p>' }), (error) => error instanceof TranslationError && error.status === 503);
  aiCalls.length = 0; calls.length = 0;
  const korean = await translateArticle({ ...keyEnv, AI: fakeAI() }, { title: '한국어 제목', html: '<p>한국어 본문입니다.</p>' }, deeplFetch());
  assert.equal(korean.alreadyKorean, true); assert.equal(calls.length + aiCalls.length, 0, 'Korean articles cost nothing');

  // 서버: 구독한 글만, 같은 원문이면 저장해 둔 번역을 쓴다. 키 설정은 운영자만 하고 키는 암호화해 둔다.
  const { app } = await vite.ssrLoadModule('/src/server/app.ts');
  const { LocalD1Database } = await vite.ssrLoadModule('/src/server/localD1.ts');
  const db = new LocalD1Database(':memory:', 'migrations/0001_schema.sql');
  const env = { DB: db, ALLOW_QUICK_LOGIN: 'true', OWNER_EMAIL: 'owner@example.test', X_SETTINGS_SECRET: 's'.repeat(40) };
  const call = (path, { token, method = 'GET', body } = {}) => app.request(path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  const login = async (email) => (await call('/api/auth/google/quick', { method: 'POST', body: { email } })).json();
  const owner = await login('owner@example.test'), other = await login('reader@example.test');
  const stamp = new Date().toISOString();
  await db.prepare('INSERT INTO feeds(id,xml_url,title,created_at) VALUES(?,?,?,?)').bind('feed', 'https://example.test/feed', 'Feed', stamp).run();
  await db.prepare('INSERT INTO subscriptions(id,user_id,feed_id,created_at) VALUES(?,?,?,?)').bind('sub', owner.user.id, 'feed', stamp).run();
  const fullBody = '<p>Full text</p><p>Another paragraph</p>';
  await db.prepare('INSERT INTO articles(id,feed_id,guid,title,url,content_html,full_content_html,published_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind('art', 'feed', 'art', 'Hello title', 'https://example.test/a', '<p>Feed text</p>', fullBody, stamp, stamp).run();

  assert.deepEqual(await (await call('/api/translation/config', { token: other.token })).json(), { canManage: false }, 'only the operator sees translation settings');
  assert.equal((await call('/api/translation/deepl', { token: other.token, method: 'PUT', body: { key: freeKey } })).status, 403);
  const before = await (await call('/api/translation/config', { token: owner.token })).json();
  assert.equal(before.provider, 'workers-ai'); assert.equal(before.storage, true);
  assert.equal((await call('/api/translation/deepl', { token: owner.token, method: 'PUT', body: { key: 'not a key' } })).status, 400);
  globalThis.fetch = deeplFetch(403);
  const rejected = await call('/api/translation/deepl', { token: owner.token, method: 'PUT', body: { key: freeKey } });
  assert.equal(rejected.status, 400); assert.match((await rejected.json()).error, /키를 확인/, 'a key DeepL refuses is not saved');
  calls.length = 0;
  globalThis.fetch = deeplFetch();
  const saved = await (await call('/api/translation/deepl', { token: owner.token, method: 'PUT', body: { key: freeKey } })).json();
  assert.equal(saved.provider, 'deepl'); assert.deepEqual(saved.usage, { used: 1234, limit: 500000 });
  assert.ok(!JSON.stringify(saved).includes(freeKey), 'the key is never sent back');
  const stored = await db.prepare("SELECT encrypted_value FROM integration_settings WHERE name='deepl_api_key'").first();
  assert.ok(stored && !stored.encrypted_value.includes(freeKey) && !stored.encrypted_value.includes('12345678'), 'the key is stored encrypted');

  calls.length = 0;
  assert.equal((await call('/api/articles/art/translate', { token: other.token, method: 'POST', body: { source: 'full' } })).status, 404, 'only subscribed articles are translated');
  const first = await (await call('/api/articles/art/translate', { token: owner.token, method: 'POST', body: { source: 'full' } })).json();
  assert.equal(first.provider, 'deepl'); assert.equal(first.html, `번역:${fullBody}`, 'the reader body is translated'); assert.equal(first.title, '번역:Hello title'); assert.equal(first.cached, false);
  assert.equal(calls.filter((entry) => entry.url.endsWith('/v2/translate')).length, 1);
  assert.equal(calls.find((entry) => entry.url.endsWith('/v2/translate')).init.headers.Authorization, `DeepL-Auth-Key ${freeKey}`, 'the saved key is used');
  const again = await (await call('/api/articles/art/translate', { token: owner.token, method: 'POST', body: { source: 'full' } })).json();
  assert.equal(again.cached, true); assert.equal(again.html, first.html);
  assert.equal(calls.filter((entry) => entry.url.endsWith('/v2/translate')).length, 1, 'a saved translation costs no DeepL characters');
  const feed = await (await call('/api/articles/art/translate', { token: owner.token, method: 'POST', body: { source: 'feed' } })).json();
  assert.equal(feed.html, '번역:<p>Feed text</p>', 'the feed view translates the feed body');
  await db.prepare('INSERT INTO articles(id,feed_id,guid,title,url,content_html,full_content_html,published_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind('web', 'feed', 'web', 'Web headline', 'https://reader.example.test/public', '<p>Feed excerpt</p>', '<p>Previously cached preview</p>', stamp, stamp).run();
  globalThis.fetch = (url, init) => String(url) === 'https://reader.example.test/public'
    ? Promise.resolve(new Response(`<main><article><p>${'Unrelated recommendation card. '.repeat(18)}</p></article><div class="post-content"><p>${'A public article paragraph. '.repeat(8)}</p><p>Article final paragraph.</p></div></main>`)) : deeplFetch()(url, init);
  const web = await (await call('/api/articles/web/translate', { token: owner.token, method: 'POST', body: { source: 'full', phone: true } })).json();
  assert.equal(web.bodySource, 'full'); assert.match(web.html, /Article final paragraph/);
  assert.doesNotMatch(web.html, /Unrelated recommendation|Previously cached preview|Feed excerpt/);
  const cachedWeb = await (await call('/api/articles/web/translate', { token: owner.token, method: 'POST', body: { source: 'full' } })).json();
  assert.equal(cachedWeb.cached, true);
  await db.prepare("UPDATE articles SET full_content_html=NULL WHERE id='web'").run();
  globalThis.fetch = (url, init) => String(url) === 'https://reader.example.test/public'
    ? Promise.resolve(new Response('', { status: 403 })) : deeplFetch()(url, init);
  const unavailable = await call('/api/articles/web/translate', { token: owner.token, method: 'POST', body: { source: 'full' } });
  assert.equal(unavailable.status, 422);
  assert.match((await unavailable.json()).error, /전체 본문/);
  const excerpt = await (await call('/api/articles/web/translate', { token: owner.token, method: 'POST', body: { source: 'feed' } })).json();
  assert.equal(excerpt.bodySource, 'feed'); assert.equal(excerpt.html, '번역:<p>Feed excerpt</p>');

  const xUrl = 'https://x.com/cz/status/123';
  await db.prepare('INSERT INTO articles(id,feed_id,guid,title,url,content_html,published_at,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .bind('x-reply', 'feed', 'x-reply', 'R to @parent: Selected reply', xUrl, '<p>Only the RSS reply</p>', stamp, stamp).run();
  const xPost = (handle, text, extra = '') => `<div class="timeline-item"><div class="tweet-header"><span class="fullname">${handle}</span><span class="username">@${handle}</span></div><div class="tweet-content">${text}</div>${extra}</div>`;
  const xMain = xPost('cz', 'Selected reply', '<div class="replying-to">Replying to @parent</div>');
  const xBefore = xPost('parent', 'Original parent message', '<div class="quote"><a class="quote-link" href="/quote/status/42"></a><div class="quote-text">Quoted original</div></div>');
  const xAfter = xPost('cz', 'Continuation of the same conversation');
  let xAvailable = true, mirrorCalls = 0;
  globalThis.fetch = (url, init) => {
    if (!String(url).includes('/cz/status/123')) return deeplFetch()(url, init);
    mirrorCalls++;
    return Promise.resolve(new Response(`<div class="main-thread">${xAvailable ? `<div class="before-tweet">${xBefore}</div>` : ''}<div class="main-tweet">${xMain}</div><div class="after-tweet">${xAfter}</div></div><div class="replies"><div class="reply">${xPost('other', 'Visible follow-up')}</div></div>`));
  };
  const thread = await (await call('/api/articles/x-reply/web-copy', { token: owner.token })).json();
  assert.match(thread.translationProof, /^[\w-]{43}$/);
  xAvailable = false;
  const xTranslate = body => call('/api/articles/x-reply/translate', { token: owner.token, method: 'POST', body });
  const snapshot = { html: thread.html, proof: thread.translationProof };
  const xFull = await (await xTranslate({ source: 'full', xThread: snapshot })).json();
  assert.equal(xFull.bodySource, 'full');
  assert.match(xFull.html, /Original parent message[\s\S]*Quoted original[\s\S]*Selected reply[\s\S]*Visible follow-up/);
  assert.doesNotMatch(xFull.html, /Only the RSS reply|<style>|<base/);
  assert.equal(mirrorCalls, 1, '번역은 이미 표시한 사본을 쓰고 미러에 다시 묻지 않는다.');
  const tampered = await xTranslate({ source: 'full', xThread: { ...snapshot, html: snapshot.html.replace('Original parent message', 'Forged text') } });
  assert.equal(tampered.status, 422, '검증에 실패하고 원글도 없으면 댓글만 번역하지 않는다.');
  const xFeed = await (await xTranslate({ source: 'feed' })).json();
  assert.equal(xFeed.html, '번역:<p>Only the RSS reply</p>');

  const linkedUrl = 'https://x.com/quote/status/42';
  globalThis.fetch = (url, init) => String(url).endsWith('/quote/status/42')
    ? Promise.resolve(new Response(`<div class="main-thread"><div class="before-tweet">${xBefore}</div><div class="main-tweet">${xPost('quote', 'Opened quote text explains why the policy changed.', '<div class="quote"><div class="quote-text">Policy announcement from the original author</div></div>')}</div></div><div class="replies"><div class="reply">${xPost('follower', 'Quote follow-up')}</div></div>`))
    : deeplFetch()(url, init);
  const linked = await (await call(`/api/articles/x-reply/x-post?url=${encodeURIComponent(linkedUrl)}`, { token: owner.token })).json();
  assert.match(linked.translationProof, /^[\w-]{43}$/);
  globalThis.fetch = deeplFetch();
  const linkedRequest = { source: 'full', xUrl: linkedUrl, xThread: { html: linked.html, proof: linked.translationProof } };
  const linkedTranslation = await (await xTranslate(linkedRequest)).json();
  assert.match(linkedTranslation.html, /Opened quote text[\s\S]*Quote follow-up/);
  assert.doesNotMatch(linkedTranslation.html, /Selected reply|Only the RSS reply/);
  assert.equal((await (await xTranslate(linkedRequest)).json()).cached, true);
  assert.equal((await (await xTranslate({ source: 'full', xThread: snapshot })).json()).cached, true, '인용글 번역이 처음 글의 번역을 덮어쓰지 않는다.');
  assert.equal((await xTranslate({ ...linkedRequest, xUrl: 'https://example.test/quote/status/42' })).status, 400);

  const quoteSummary = (token = owner.token, body = linkedRequest) => call('/api/articles/x-reply/summarize', { token, method: 'POST', body });
  env.AI = { async run(_model, input) {
    const { title, article } = JSON.parse(input.messages[1].content);
    assert.equal(title, 'X 대화 (@quote)');
    assert.match(article, /Original parent message[\s\S]*선택한 게시물 \(@quote\):\nOpened quote text[\s\S]*인용된 게시물:\nPolicy announcement/);
    assert.doesNotMatch(article, /Quote follow-up|Selected reply/);
    assert.ok(input.response_format.json_schema.required.includes('reply'));
    return { response: { overview: '이 게시물은 정책이 변경된 이유를 설명합니다.', points: [], reply: '인용한 글에서 정책 변경 이유를 설명했습니다.' } };
  } };
  assert.equal((await quoteSummary(other.token)).status, 404);
  assert.equal((await quoteSummary(owner.token, { ...linkedRequest, xUrl: 'https://example.test/quote/status/42' })).status, 400);
  assert.match((await (await quoteSummary()).json()).aiSummary, /정책이 변경된 이유/);
  assert.equal((await db.prepare('SELECT ai_summary FROM articles WHERE id=?').bind('x-reply').first()).ai_summary, null, '인용글 요약은 처음 글에 저장하지 않는다.');

  await db.prepare('UPDATE articles SET ai_summary=? WHERE id=?').bind('**핵심 요약 · 피드 본문 기준**\n이전 답글 요약', 'x-reply').run();
  let conversationCalls = 0;
  env.AI = { async run(_model, input) {
    const { title, article } = JSON.parse(input.messages[1].content);
    assert.equal(title, 'X 대화 (@cz)');
    assert.match(article, /Original parent message[\s\S]*Quoted original[\s\S]*Selected reply[\s\S]*Continuation of the same conversation/);
    assert.doesNotMatch(article, /Only the RSS reply|Visible follow-up/);
    if (++conversationCalls === 1) return { response: { overview: '원글의 설명에 후속 게시물이 이어집니다.', points: [] } };
    return { response: { overview: '원글의 설명에 답글과 후속 게시물이 이어집니다.', points: [], reply: '선택한 글의 답변을 덧붙였습니다.' } };
  } };
  const conversation = await (await quoteSummary(owner.token, { xThread: snapshot })).json();
  assert.match(conversation.aiSummary, /X 대화 요약[\s\S]*선택한 답글[\s\S]*선택한 글의 답변/);
  assert.equal(conversation.cached, false);
  assert.equal(conversationCalls, 2, '첫 모델이 선택한 답글을 빠뜨리면 다음 모델이 다시 요약한다.');
  assert.equal((await (await quoteSummary(owner.token, {})).json()).cached, true);
  assert.equal((await quoteSummary(owner.token, { force: true })).status, 422, '원글을 불러올 수 없으면 답글만 요약하지 않는다.');
  delete env.AI;

  globalThis.fetch = deeplFetch();
  const changedBody = fullBody.replace('Full text', 'Changed text');
  await db.prepare("UPDATE articles SET full_content_html=? WHERE id='art'").bind(changedBody).run();
  const changed = await (await call('/api/articles/art/translate', { token: owner.token, method: 'POST', body: { source: 'full' } })).json();
  assert.equal(changed.cached, false); assert.equal(changed.html, `번역:${changedBody}`, 'a changed article is translated again');
  const forced = await (await call('/api/articles/art/translate', { token: owner.token, method: 'POST', body: { source: 'full', force: true } })).json();
  assert.equal(forced.cached, false);
  const cleared = await (await call('/api/translation/deepl', { token: owner.token, method: 'DELETE' })).json();
  assert.equal(cleared.provider, 'workers-ai');
  const managedEnv = { ...env, DEEPL_API_KEY: freeKey };
  const managed = await app.request('/api/translation/deepl', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${owner.token}` }, body: JSON.stringify({ key: freeKey }) }, managedEnv);
  assert.equal(managed.status, 400, 'a key managed by the server is not replaced from the screen');

  // 화면: 모든 보기에 번역 버튼이 있고, 운영자 설정에는 엔진과 사용량이 보인다.
  Object.defineProperty(globalThis, 'DOMParser', { value: DOMParser, configurable: true });
  const { ArticleDrawer } = await vite.ssrLoadModule('/src/components/ArticleDrawer.tsx');
  const article = { id: 'art', feed_id: 'feed', feed_title: 'Feed', title: 'Hello title', url: 'https://example.test/a', published_at: stamp, is_read: false, is_saved: false, content_html: '<p>Feed text</p>', summary: 'Feed text' };
  for (const viewMode of ['feed', 'reader', 'web']) {
    const markup = renderToStaticMarkup(React.createElement(ArticleDrawer, { article, accountId: 'owner', viewMode, isDark: false, onClose() {}, onToggleRead() {}, onToggleSaved() {}, onUpdateArticleFields() {}, onChangeViewMode() {}, onNavigateRelative() {}, onCopyLink() {}, onNotice() {}, hasPrev: false, hasNext: false }));
    assert.match(markup, /aria-label="번역"/, `the ${viewMode} view offers translation`);
  }
  const drawer = (await import('node:fs')).readFileSync('src/components/ArticleDrawer.tsx', 'utf8');
  assert.match(drawer, /const siteShown = mode === 'web' && !showTranslation;/);
  assert.match(drawer, /const nativeWeb = siteShown &&/, 'the Mac and Windows original view steps aside while a translation is shown');
  // X 대화 번역: 원글을 큰 제목으로 한 번 더 쓰지 않고, 우리가 만든 대화 구조(글·작성자 줄·인용 상자·사진)를 남겨 X처럼 그린다.
  assert.match(drawer, /\{!showingXTranslation && <h1/, 'an X conversation translation does not repeat the post as a heading');
  assert.match(drawer, /article\.thumbnail_url && !showingXTranslation &&/, 'nor shows the profile photo as a large picture');
  assert.match(drawer, /xThread=\{showingXTranslation\}/); assert.match(drawer, /showingXTranslation \? 'feedex-x-translation ' : ''/);
  {
    const { dropSiteClasses, X_THREAD_CLASSES } = await vite.ssrLoadModule('/src/shared/siteClasses.ts');
    const markup = '<article class="post main flex"><p class="who">CZ</p><div class="quote"><a class="quote-post w-full">quoted</a></div><span class="sr-only">hidden</span><div class="grid">site</div></article>';
    const site = new DOMParser().parseFromString(`<html><body>${markup}</body></html>`, 'text/html');
    dropSiteClasses(site.body);
    assert.equal(site.body.querySelectorAll('[class]').length, 0, 'ordinary article bodies keep no class names');
    const thread = new DOMParser().parseFromString(`<html><body>${markup}</body></html>`, 'text/html');
    dropSiteClasses(thread.body, X_THREAD_CLASSES);
    assert.equal(thread.body.querySelector('article').getAttribute('class'), 'post main', 'only the conversation structure names stay');
    assert.equal(thread.body.querySelector('a').getAttribute('class'), 'quote-post');
    assert.equal(thread.body.querySelector('.grid, [class*="flex"], [class*="w-full"]'), null, 'site utility names are still dropped');
    assert.equal(thread.body.textContent.includes('hidden'), false, 'screen-reader-only parts are still removed');
  }
  const styles = (await import('node:fs')).readFileSync('src/index.css', 'utf8');
  assert.match(styles, /html \.feedex-article-content\.feedex-x-translation \.quote \{[^}]*border: 1px solid/, 'a quoted post is a box, not green link text');
  assert.match(styles, /html \.feedex-article-content\.feedex-x-translation \.quote-post \{[^}]*text-decoration: none/);
  assert.match(styles, /\.feedex-translation-bar \{[^}]*width: fit-content/, 'the translation notice is a small pill, not a full-width box');
  const { TranslationSetting } = await vite.ssrLoadModule('/src/components/TranslationSetting.tsx');
  const deeplSetting = renderToStaticMarkup(React.createElement(TranslationSetting, { initial: { canManage: true, provider: 'deepl', managed: false, usage: { used: 1234, limit: 500000 }, storage: true } }));
  assert.match(deeplSetting, /DeepL/); assert.match(deeplSetting, /이번 달 1,234 \/ 500,000자 사용/); assert.match(deeplSetting, /키 지우기/);
  const aiSetting = renderToStaticMarkup(React.createElement(TranslationSetting, { initial: { canManage: true, provider: 'workers-ai', managed: false, usage: null, storage: true } }));
  assert.match(aiSetting, /type="password"[^>]*aria-label="DeepL API 키"/); assert.match(aiSetting, /DeepL 앱 구독과는 별개/);
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(TranslationSetting, { initial: { canManage: false } })), /번역/, 'other people see nothing');
  // DeepL API 없이: 사용자의 DeepL 웹 번역기를 글이 채워진 채로 연다. auto는 글이 채워지지 않아 원문 언어를 짐작한다.
  const { guessSourceLanguage, htmlToText, deeplTranslatorUrl, DEEPL_LINK_LIMIT } = await vite.ssrLoadModule('/src/client/deeplWeb.ts');
  assert.equal(guessSourceLanguage('Bitcoin rises again'), 'en'); assert.equal(guessSourceLanguage('ビットコインが上昇'), 'ja');
  assert.equal(guessSourceLanguage('比特币再次上涨'), 'zh'); assert.equal(guessSourceLanguage('Биткоин снова растет'), 'ru');
  assert.equal(htmlToText('<h2>Title</h2><p>One <a href="#">link</a></p><script>x()</script><ul><li>A</li><li>B</li></ul>', new DOMParser()), 'Title\n\nOne link\n\nA\n\nB');
  assert.equal(deeplTranslatorUrl('Hello / world\n\nNext'), 'https://www.deepl.com/translator#en/ko/Hello%20%2F%20world%0A%0ANext', 'slashes and paragraph breaks are encoded');
  const longText = Array.from({ length: 400 }, (_, index) => `Paragraph ${index} with some words.`).join('\n\n');
  const link = deeplTranslatorUrl(longText);
  assert.ok(link.length <= DEEPL_LINK_LIMIT, 'long articles fit the app hand-off limit'); assert.match(decodeURIComponent(link), /Paragraph 0 with some words\.\n\nParagraph 1/);
  assert.doesNotMatch(link, /%0A%0A$/, 'cut at a paragraph boundary');
  const appSource = (await import('node:fs')).readFileSync('src/App.tsx', 'utf8');
  assert.match(appSource, /id: 'deepl-selection', label: '선택한 글 DeepL로 번역', run: \(\) => openInDeepL\(target\.selection!\)/, 'selected text can go to DeepL from the right-click menu');
  assert.match(appSource, /id: 'deepl-article', label: '이 글 DeepL로 번역'/, 'a whole article can go to DeepL from the right-click menu');
  assert.match((await import('node:fs')).readFileSync('src/client/deeplWeb.ts', 'utf8'), /bridge\.postMessage\(\{ type: 'openExternal', url \}\)/, 'the Mac and Windows apps open DeepL in the default browser');

  console.log('PASS: DeepL endpoint, auth header, HTML handling, escaped titles, size-limited parts in order; Workers AI paragraph translation with model fallback, code and Korean left alone; DeepL quota falls back to Workers AI; Korean articles cost nothing; subscribed-only translations saved per source and redone when the article changes; operator-only encrypted DeepL key that is checked before saving and never returned; translate button in every view and the operator setting; X conversation translations without a repeated heading and with boxed quotes; DeepL web hand-off for selections and whole articles without the API.');
} finally {
  globalThis.fetch = originalFetch;
  if (previousParser) Object.defineProperty(globalThis, 'DOMParser', previousParser); else delete globalThis.DOMParser;
  await vite.close();
}
