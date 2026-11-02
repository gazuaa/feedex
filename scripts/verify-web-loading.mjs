import assert from 'node:assert/strict';
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
  const { readContent, maintainDeviceCache } = await vite.ssrLoadModule('/src/client/deviceContent.ts');
  const { ArticleDrawer, WebLoadingPreview } = await vite.ssrLoadModule('/src/components/ArticleDrawer.tsx');
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
  assert.match(initial,/Available article 0/); assert.match(initial,/Prepared reader body/); assert.match(initial,/웹 보기 미리보기/);
  const ready=renderToStaticMarkup(React.createElement(WebLoadingPreview,{article:articles[0],isDark:false,ready:true,onReady(){},onReading(){}}));
  assert.match(ready,/웹 페이지 보기/); assert.match(ready,/Prepared reader body/,'a person reading the preview can keep their position when the website becomes ready');
  await maintainDeviceCache('fast-owner',true);
  await maintainDeviceCache('reader-owner',true);
  console.log('PASS: view-aware prefetch, two web requests at once, shared foreground request, zero-network cached opening without repeated HTML parsing; live sites unchanged, other blocked origins prepared; cache-clear/account guards; immediate saved content with web still selected and explicit transition after scrolling.');
} finally {
  globalThis.fetch=originalFetch;
  for(const [key,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  await vite.close();
}
