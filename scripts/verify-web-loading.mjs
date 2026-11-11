import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DOMParser } from 'linkedom';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { createServer } from 'vite';
const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const originalFetch = globalThis.fetch, originals = new Map(['DOMParser','indexedDB','IDBKeyRange','localStorage'].map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
let parses = 0;
class CountingParser extends DOMParser { parseFromString(...args) { parses++; return super.parseFromString(...args); } }
const values = new Map();
for (const [key,value] of Object.entries({ DOMParser:CountingParser,indexedDB,IDBKeyRange,localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)} })) Object.defineProperty(globalThis,key,{configurable:true,value});
try {
  const { ArticleResources } = await vite.ssrLoadModule('/src/client/articleResources.ts');
  const { readContent, writeContent, maintainDeviceCache } = await vite.ssrLoadModule('/src/client/deviceContent.ts');
  const { ArticleDrawer, WebLoading } = await vite.ssrLoadModule('/src/components/ArticleDrawer.tsx');
  const { WebStatusBar, WebLabel } = await vite.ssrLoadModule('/src/components/WebStatusBar.tsx');
  const { X_THREAD_MARK } = await vite.ssrLoadModule('/src/shared/xThreadStyle.ts');
  const page = '<!doctype html><html><head><title>Public page</title></head><body><main><h1>Original web layout</h1><p>'+'Real article text. '.repeat(30)+'</p><img src="https://cdn.example.test/photo.jpg"></main></body></html>';
  const articles = Array.from({length:8},(_,n)=>({id:'fast-'+n,feed_id:'coindesk',url:`https://www.coindesk.com/tech/2026/11/02/public-article-${n}`,title:'Available article '+n,feed_title:'CoinDesk',content_html:'<p>Feed body already received.</p>',full_content_html:'<p>Prepared reader body.</p>',is_read:false,is_saved:false}));
  let calls = 0, active = 0, peak = 0, waiting = [], serverCalls = [];
  globalThis.fetch = async () => { calls++; active++; peak=Math.max(peak,active); await new Promise(resolve=>waiting.push(resolve)); active--; return new Response(page); };
  const request = async path => { serverCalls.push(path); if(path.endsWith('/reader-view')) return {fullContentHtml:'<p>Reader prepared.</p>'}; return {html:page,url:'https://ordinary.example.test/article'}; };
  const resources = new ArticleResources('fast-owner',()=>true,request);
  const prepared = resources.preload(articles,()=>true,()=> 'web');
  while(waiting.length<2) await new Promise(setImmediate);
  const opened = resources.web(articles[0]);
  const nearby = resources.preload([articles[1],articles[6]],()=>true,()=> 'web');
  await new Promise(setImmediate); assert.equal(calls,2,'a foreground open shares the prefetch already running');
  for(let i=0;i<6;i++){while(!waiting.length) await new Promise(setImmediate); waiting.shift()(); await new Promise(setImmediate);}
  await Promise.all([prepared,nearby]); assert.match((await opened).html,/Original web layout/);
  assert.equal(calls,6); assert.equal(peak,2,'overlapping list/viewport prefetch is capped at two requests'); assert.deepEqual(serverCalls,[],'public web mode never prepares the wrong server reader');
  const networkBefore=calls;
  const first=await resources.cachedWeb(articles[0]), parsedBefore=parses;
  assert.equal(await resources.cachedWeb(articles[0]),first); await resources.web(articles[0]);
  assert.equal(parses,parsedBefore,'reopening an unchanged cached copy does not parse its large HTML again'); assert.equal(calls,networkBefore,'prepared web copies open without another network request');
  await resources.preload(articles,()=>true,()=> 'feed'); assert.equal(calls,networkBefore,'RSS mode does not extract a reader or a website in the background');
  await resources.preload([articles[7]],()=>false,()=> 'web'); assert.equal(calls,networkBefore,'offscreen/cancelled rows do not start more requests');
  assert.equal(await readContent('other','web:fast-0'),undefined);

  const ordinary = {...articles[0],id:'ordinary',url:'https://ordinary.example.test/article'};
  await resources.preload([ordinary],()=>true,()=> 'web'); assert.deepEqual(serverCalls,[],'a normal live website is not forced into a script-free copy');
  await resources.web(ordinary); serverCalls=[];
  await resources.preload([{...ordinary,id:'ordinary-next',url:'https://ordinary.example.test/next'}],()=>true,()=> 'web');
  assert.deepEqual(serverCalls,['/api/articles/ordinary-next/web-copy'],'other sites requiring copies can prepare their next article too');

  calls=0; waiting=[];
  const cancelled = new ArticleResources('cancel-owner',()=>true,request);
  const warming=cancelled.preload(articles,()=>true,()=> 'web');
  while(waiting.length<2) await new Promise(setImmediate);
  await maintainDeviceCache('cancel-owner',true);
  for(const finish of waiting.splice(0)) finish(); await warming;
  assert.equal(calls,2,'clearing the device cache stops queued preparations'); assert.equal(await readContent('cancel-owner','web:fast-0'),undefined,'late prefetches do not refill a deleted cache');

  let readerActive=0,readerPeak=0,readerRequests=0,readerReleases=[];
  const readerResources=new ArticleResources('reader-owner',()=>true,async()=>{
    readerRequests++;readerActive++;readerPeak=Math.max(readerPeak,readerActive);
    await new Promise(resolve=>readerReleases.push(resolve));readerActive--;return {fullContentHtml:'<p>Prepared reader</p>'};
  });
  const readerRows=articles.slice(0,5).map(row=>({...row,full_content_html:null}));
  const readerJobs=[readerResources.preload(readerRows.slice(0,3),()=>true),readerResources.preload(readerRows.slice(3),()=>true)];
  for(let i=0;i<5;i++){while(!readerReleases.length)await new Promise(setImmediate);readerReleases.shift()();await new Promise(setImmediate);}
  await Promise.all(readerJobs);assert.equal(readerRequests,5);assert.equal(readerPeak,1,'overlapping viewport jobs keep server reader extraction serial');

  const props={article:articles[0],accountId:'fast-owner',viewMode:'web',isDark:false,onClose(){},onToggleRead(){},onToggleSaved(){},onUpdateArticleFields(){},onChangeViewMode(){},onNavigateRelative(){},hasPrev:false,hasNext:true};
  const initial=renderToStaticMarkup(React.createElement(ArticleDrawer,props));
  const initialDocument=new DOMParser().parseFromString(initial,'text/html');
  assert.match(initialDocument.querySelector('[role="radio"][aria-checked="true"]').textContent,/웹/);
  // 웹 보기는 피드 요약을 먼저 보여 주지 않고, 사이트를 다 불러온 뒤에 한 번에 보여 준다.
  assert.doesNotMatch(initial,/Prepared reader body/,'the web view does not show the feed text before the site is ready');
  assert.equal(initialDocument.querySelectorAll('[data-web-loading]').length,1,'the web view shows a loading cover until the site is ready');
  // 웹 보기에도 AI 요약이 있다. 저장된 요약이 있어도 사이트를 가리지 않게 누를 때만 위쪽 칸을 연다.
  assert.equal(initialDocument.querySelectorAll('button[aria-label="요약"]').length,1,'the web view offers the AI summary');
  const withSummary={...articles[0],ai_summary:'**핵심 요약**\n웹 보기 요약 한 줄'};
  const summarized=new DOMParser().parseFromString(renderToStaticMarkup(React.createElement(ArticleDrawer,{...props,article:withSummary})),'text/html');
  assert.equal(summarized.querySelector('.feedex-web-summary'),null,'a saved summary does not cover the site on its own');
  const readerSummary=new DOMParser().parseFromString(renderToStaticMarkup(React.createElement(ArticleDrawer,{...props,viewMode:'reader',article:withSummary})),'text/html');
  assert.match(readerSummary.querySelector('.feedex-reader-content').textContent,/웹 보기 요약 한 줄/,'the reader view still shows a saved summary above the body');
  assert.equal(readerSummary.querySelector('.feedex-reader-content strong')?.textContent,'핵심 요약','bold marks in the summary are shown as bold');
  const drawerCode=readFileSync('src/components/ArticleDrawer.tsx','utf8');
  assert.match(drawerCode,/className="feedex-web-summary">\s*<AiSummaryCard[^\n]*?onClose=\{toggleAiSummary\}/,'the summary over the site can be closed');
  const { app } = await vite.ssrLoadModule('/src/server/app.ts');
  const { LocalD1Database } = await vite.ssrLoadModule('/src/server/localD1.ts');
  const db = new LocalD1Database(':memory:', 'migrations/0001_schema.sql');
  const date = new Date().toISOString(), url = 'https://reader.example.test/story';
  let modelCalls = 0;
  const env = { DB: db, ALLOW_QUICK_LOGIN: 'true', AI: { async run(_model, input) {
    modelCalls++;
    const { article } = JSON.parse(input.messages[1].content);
    assert.match(article, /The final condition applies only until November 30/);
    assert.match(article, /38\.8억 달러/);
    if (modelCalls === 1) return { response: { overview: '새 제도의 규모는 3.88억 달러로 책정됐습니다.', points: [] } };
    return { choices: [{ message: { content: JSON.stringify({ overview: '새 제도는 11월 30일까지 적용되는 한시적 조치입니다.', points: ['이 조치는 다음 달에 다시 검토됩니다.'] }) } }] };
  } } };
  const login = await (await app.request('/api/auth/google/quick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'summary@example.test' }) }, env)).json();
  await db.prepare('INSERT INTO feeds(id,xml_url,title,created_at) VALUES(?,?,?,?)').bind('summary-feed', 'https://reader.example.test/rss', 'Reader', date).run();
  await db.prepare('INSERT INTO subscriptions(id,user_id,feed_id,created_at) VALUES(?,?,?,?)').bind('summary-sub', login.user.id, 'summary-feed', date).run();
  await db.prepare('INSERT INTO articles(id,feed_id,guid,title,url,content_html,ai_summary,published_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind('summary-story', 'summary-feed', 'story', 'News headline', url, '<p>Feed excerpt.</p>', '📌 **한줄 핵심 요약**\n오래된 요약', date, date).run();
  globalThis.fetch = async (target) => {
    assert.equal(target, url);
    return new Response('<article><p>The funds reached $3.88 billion.</p><p>' + 'Opening paragraphs with source details. '.repeat(500) + '</p><p>The final condition applies only until November 30.</p></article>');
  };
  const requestSummary = (force = false) => app.request('/api/articles/summary-story/summarize', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${login.token}` }, body: JSON.stringify({ force, phone: true }) }, env);
  const generated = await (await requestSummary()).json();
  assert.equal(generated.cached, false); assert.match(generated.aiSummary, /11월 30일/);
  assert.equal((await (await requestSummary()).json()).cached, true); assert.equal(modelCalls, 2);
  env.AI.run = async () => ({ response: 'unusable' });
  const failed = await requestSummary(true);
  assert.equal(failed.status, 502); assert.match((await failed.json()).error, /다시 시도/);
  assert.equal((await db.prepare('SELECT ai_summary FROM articles WHERE id=?').bind('summary-story').first()).ai_summary, generated.aiSummary);
  const cover=renderToStaticMarkup(React.createElement(WebLoading,{overlay:true}));
  assert.match(cover,/absolute inset-0/,'the cover hides a frame that is still loading');
  assert.doesNotMatch(cover,/role="status"/,'the cover does not add its own notice row');
  // 사이트를 넣은 프레임도 다 불러오거나 기다리는 상한이 지날 때까지 덮어 둔다.
  const drawerSource=readFileSync('src/components/ArticleDrawer.tsx','utf8');
  assert.match(drawerSource,/const frameLoading = webFrameShown && loadedFrame !== article\?\.id && slowFrame !== article\?\.id;/,'a site frame counts as loading until its load event or the wait limit');
  assert.match(drawerSource,/onLoad=\{\(\) => setLoadedFrame\(article\.id\)\}[\s\S]{0,200}\{frameLoading && <WebLoading overlay \/>\}/,'the loading cover sits over the site frame');
  // 웹 보기 상단은 어느 상태에서도 한 줄이다. 좁은 칸은 짧은 이름, 넓은 칸은 긴 이름을 쓰고 줄바꿈하지 않는다.
  assert.equal(initialDocument.querySelectorAll('.feedex-web-status').length,1,'the web view has one status bar');
  assert.equal(initialDocument.querySelectorAll('[role="status"]').length,1);
  assert.match(initialDocument.querySelector('.feedex-web-status').textContent,/불러오는 중/);
  assert.match(initialDocument.querySelector('.feedex-web-status').textContent,/원문에서 읽기·로그인/);
  const statusBar=(props)=>renderToStaticMarkup(React.createElement(WebStatusBar,{url:'https://example.test/a',isDark:false,hidden:false,canLogin:true,notice:'긴 안내 문구',shortNotice:'짧은 안내',...props},React.createElement('a',{href:'https://example.test/a'},React.createElement(WebLabel,{short:'새 창',long:'새 창에서 열기'}))));
  const shownBar=statusBar();
  for(const [short,long] of [['짧은 안내','긴 안내 문구'],['새 창','새 창에서 열기'],['원문','원문에서 읽기·로그인']]){
    assert.ok(shownBar.includes(`class="@3xl:hidden">${short}<`),`${short} is the narrow label`);
    assert.ok(shownBar.includes(`class="hidden @3xl:inline">${long}<`),`${long} is the wide label`);
  }
  assert.match(shownBar,/role="status" class="min-w-0 flex-1 truncate" title="긴 안내 문구"/,'a cut-off notice keeps its full text');
  assert.match(shownBar,/whitespace-nowrap/,'actions never wrap into a second row');
  assert.doesNotMatch(statusBar({canLogin:false}),/원문에서 읽기/,'X posts have no sign-in action');
  assert.match(statusBar({hidden:true}),/data-scroll-hidden="true"/,'the bar folds away with the other bars without moving the page');
  assert.doesNotMatch(statusBar({hidden:false}),/data-scroll-hidden/);
  assert.match(statusBar({busy:true}),/animate-spin/,'loading shows a spinner in the same row');
  assert.match(initial,/aria-label="기사 새로고침"/,'the article toolbar offers a refresh');

  // 기사 새로고침: 저장된 사본·본문을 건너뛰고 다시 받아 바꾼다. 피드 보기는 서버의 최신 정보를 받는다.
  const refreshCalls=[]; let copyVersion=1, readerVersion=1;
  const refreshRequest=async(path,options={})=>{
    refreshCalls.push(path+(options.body?' '+options.body:''));
    if(path.endsWith('/web-copy')) return {html:page.replace('Original web layout','Web copy v'+copyVersion),url:'https://ordinary.example.test/refresh'};
    if(path.endsWith('/reader-view')) return {fullContentHtml:'<p>Reader v'+readerVersion+'</p>'};
    if(path.startsWith('/api/articles?articleId=')) return {articles:[{...refreshArticle,title:'Updated title',content_html:'<p>Updated feed body</p>',full_content_html:null,is_read:false}]};
    throw new Error('unexpected '+path);
  };
  const refreshArticle={id:'refresh-1',feed_id:'ordinary',url:'https://ordinary.example.test/refresh',title:'Old title',feed_title:'Ordinary',content_html:'<p>Old feed body</p>',full_content_html:null,is_read:true,is_saved:false};
  const refreshing=new ArticleResources('refresh-owner',()=>true,refreshRequest);
  assert.match((await refreshing.web(refreshArticle)).html,/Web copy v1/);
  assert.match((await refreshing.web(refreshArticle)).html,/Web copy v1/); assert.equal(refreshCalls.length,1,'an ordinary open uses the saved copy');
  copyVersion=2;
  assert.match((await refreshing.refreshWeb(refreshArticle)).html,/Web copy v2/); assert.equal(refreshCalls.length,2,'refresh skips the saved copy');
  assert.match((await refreshing.web(refreshArticle)).html,/Web copy v2/); assert.equal(refreshCalls.length,2,'the refreshed copy replaces the saved one');
  assert.match((await refreshing.reader(refreshArticle)).full_content_html,/Reader v1/);
  assert.match((await refreshing.reader(refreshArticle)).full_content_html,/Reader v1/); assert.equal(refreshCalls.length,3,'the saved reader body is reused');
  readerVersion=2;
  assert.match((await refreshing.reader(refreshArticle,true)).full_content_html,/Reader v2/);
  assert.equal(refreshCalls.at(-1),'/api/articles/refresh-1/reader-view {"force":true}','refresh asks the server to extract again');
  assert.match((await refreshing.hydrate(refreshArticle)).full_content_html,/Reader v2/,'the new reader body is kept on the device');
  const latest=await refreshing.latest(refreshArticle);
  assert.equal(latest.title,'Updated title'); assert.match(latest.content_html,/Updated feed body/);
  assert.match(latest.full_content_html,/Reader v2/,'the separately extracted reader body survives a feed refresh');
  assert.match((await readContent('refresh-owner','article:refresh-1')).data.content_html,/Updated feed body/);
  await maintainDeviceCache('refresh-owner',true);

  // 사이트별 프레임 판단: 프레임 거부와 허용은 기억하고, 보안 확인·HTTP 오류처럼 잠깐인 결과는 기억하지 않는다.
  const frames=new ArticleResources('frame-owner',()=>true,async()=>({}));
  assert.equal(frames.knownFrame('https://decrypt.co/1/a'),undefined,'an unseen site is checked first');
  frames.rememberFrame('https://decrypt.co/1/a',{embeddable:false,reason:'framing'});
  assert.deepEqual(frames.knownFrame('https://decrypt.co/2/b'),{embeddable:false,url:'https://decrypt.co/2/b',reason:'framing'},'another article of a site that refuses frames goes straight to the copy');
  frames.rememberFrame('http://open.example.test/a',{embeddable:true});
  assert.deepEqual(frames.knownFrame('http://open.example.test/b'),{embeddable:true,url:'https://open.example.test/b'});
  for(const reason of ['challenge','http','mixed-content']) frames.rememberFrame('https://flaky.example.test/a',{embeddable:false,reason});
  assert.equal(frames.knownFrame('https://flaky.example.test/b'),undefined,'passing failures are asked again');
  // 고정 폭 사이트: 같은 사이트의 다음 글은 처음부터 칸에 맞춘다. 칸이 넓거나 휴대폰이면 줄이지 않는다.
  frames.rememberFrame('https://fixed.example.test/a',{embeddable:true,layoutWidth:1080});
  assert.deepEqual(frames.knownFrame('https://fixed.example.test/b'),{embeddable:true,url:'https://fixed.example.test/b',layoutWidth:1080});
  const { fixedLayoutFit } = await vite.ssrLoadModule('/src/components/ArticleDrawer.tsx');
  const desktop='Mozilla/5.0 (Macintosh) Chrome/130.0 Safari/537.36';
  assert.equal(fixedLayoutFit(1080,550,desktop),0.5,'a narrow pane scales the declared width, with room for a scrollbar');
  assert.equal(fixedLayoutFit(1080,1400,desktop),1,'a wide pane stays at full size');
  assert.equal(fixedLayoutFit(undefined,550,desktop),1,'sites that fit themselves are left alone');
  assert.equal(fixedLayoutFit(1080,0,desktop),1,'an unmeasured pane is left alone');
  assert.equal(fixedLayoutFit(1080,375,'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1'),1,'phones get the layout the site sends them');
  // X 글: 댓글 자리만 회색으로 남은 예전 사본은 버리고, 글과 댓글 사본은 저장해 다시 쓴다.
  const xArticle={...articles[0],id:'x-1',url:'https://x.com/nasa/status/2000000000000000001'};
  let xCalls=0;
  const xResources=new ArticleResources('x-owner',()=>true,async()=>{xCalls++;return {html:`<!doctype html><html><head>${X_THREAD_MARK}</head><body><main>Post and replies</main></body></html>`,url:xArticle.url,thread:true};});
  await writeContent('x-owner','web:x-1',{html:'<!doctype html><html><body><main>Old skeleton</main></body></html>',url:xArticle.url});
  assert.equal(await xResources.cachedWeb(xArticle),undefined,'an old X copy without replies is not shown again');
  await writeContent('x-owner','web:x-1',{html:'<!doctype html><html><body><main>Broken quote box</main></body></html>',url:xArticle.url,thread:true});
  assert.equal(await xResources.cachedWeb(xArticle),undefined,'a saved X copy from before the quote fix is fetched again');
  assert.match((await xResources.web(xArticle)).html,/Post and replies/); assert.equal(xCalls,1);
  assert.equal((await xResources.cachedWeb(xArticle)).thread,true); await xResources.web(xArticle);
  assert.equal(xCalls,1,'the X copy with replies is saved and reopened without another request');
  await maintainDeviceCache('x-owner',true);
  await maintainDeviceCache('fast-owner',true);
  await maintainDeviceCache('reader-owner',true);
  console.log('PASS: per-site frame decisions; old X copies replaced by saved post-and-replies copies; article refresh replacing saved web copies, reader bodies and feed details; view-aware prefetch, two web requests at once, shared foreground request, zero-network cached opening without repeated HTML parsing; live sites unchanged, other blocked origins prepared; cache-clear/account guards; web selected with a loading cover until the site is ready; AI summary in the web view above the site, after fetching the article body.');
} finally {
  globalThis.fetch=originalFetch;
  for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  await vite.close();
}
