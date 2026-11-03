import assert from 'node:assert/strict';
import React, {act} from 'react';
import {parseHTML} from 'linkedom';
import {createServer} from 'vite';

const vite=await createServer({configFile:false,server:{middlewareMode:true,ws:false},appType:'custom',logLevel:'silent'});
const {window}=parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
const values=new Map(), media={matches:false,addEventListener(){},removeEventListener(){}};
window.matchMedia=()=>media;
const globals={window,document:window.document,HTMLElement:window.HTMLElement,Element:window.Element,ResizeObserver:class{observe(){}disconnect(){}},localStorage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)},IS_REACT_ACT_ENVIRONMENT:true};
const originals=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
for(const [key,value]of Object.entries(globals))Object.defineProperty(globalThis,key,{configurable:true,value});
let root;
try{
  const {createRoot}=await import('react-dom/client');
  const {ArticleDrawer}=await vite.ssrLoadModule('/src/components/ArticleDrawer.tsx');
  const {X_THREAD_MARK}=await vite.ssrLoadModule('/src/shared/xThreadStyle.ts');
  const copies=new Map(), pending=[];let requests=0;
  const rows=[1,2].map(n=>({id:`reopen-${n}`,feed_id:'x',feed_title:'X test',url:`https://x.com/test/status/${n}`,title:`Post ${n}`,content_html:`<p>Preview ${n}</p>`,published_at:'2026-11-04T00:00:00Z',date_source:'original',is_read:true,is_saved:false}));
  const resources={
    cachedWeb(article){if(!copies.has(article.id))return Promise.resolve(undefined);return new Promise(resolve=>pending.push(()=>resolve(copies.get(article.id))));},
    web(article){requests++;return new Promise(resolve=>pending.push(()=>{const value={url:article.url,thread:true,html:`<!doctype html><html><head>${X_THREAD_MARK}</head><body><main>Saved ${article.id}</main></body></html>`};copies.set(article.id,value);resolve(value);}));},
  };
  const props={accountId:'reopen-test',resources,viewMode:'web',onClose(){},onToggleRead(){},onToggleSaved(){},onUpdateArticleFields(){},onChangeViewMode(){},onNavigateRelative(){},onCopyLink(){},onNotice(){},hasPrev:true,hasNext:true,isDark:false};
  root=createRoot(window.document.getElementById('root'));
  const show=async article=>{
    await act(async()=>{root.render(React.createElement(ArticleDrawer,{...props,key:article.id,article}));});
    const preview=window.document.querySelector('iframe');assert.ok(preview,'본문을 기다리는 동안 피드 미리보기를 표시한다.');
    assert.ok(pending.length);
    await act(async()=>{pending.shift()();});
    const ready=window.document.querySelector('iframe');
    assert.notEqual(ready,preview,'미리보기 탐색에 저장 문서를 덮어쓰지 않고 새 프레임으로 표시한다.');
    assert.ok(ready.getAttribute('srcDoc')?.includes(`Saved ${article.id}`)||ready.getAttribute('srcdoc')?.includes(`Saved ${article.id}`));
  };
  await show(rows[0]);await show(rows[1]);
  for(let n=0;n<4;n++)await show(rows[n%2]);
  assert.equal(requests,2,'다른 글을 읽고 돌아와도 저장된 사본을 다시 요청하지 않는다.');
  console.log('PASS: real reader preview-to-ready frame replacement, cached A/B/A reopening and no duplicate copy requests.');
}finally{
  if(root)await act(async()=>root.unmount());
  for(const[key,descriptor]of originals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  await vite.close();
}
