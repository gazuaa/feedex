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
    const doc=frame=>frame.getAttribute('srcdoc')??frame.getAttribute('srcDoc')??'';
    const preview=window.document.querySelector('iframe');assert.ok(preview,'본문을 기다리는 동안 피드 미리보기를 표시한다.');
    const previewDoc=doc(preview);
    assert.ok(pending.length);
    await act(async()=>{pending.shift()();});
    const ready=[...window.document.querySelectorAll('iframe')].find(frame=>doc(frame).includes(`Saved ${article.id}`));
    assert.ok(ready,'the saved copy is drawn');
    assert.notEqual(ready,preview,'미리보기 탐색에 저장 문서를 덮어쓰지 않고 새 프레임으로 표시한다.');
    // 미리보기는 지웠다가 새 프레임에 다시 그리지 않는다. 그러면 같은 글을 한 번 더 불러오며 화면이 비어 깜빡인다.
    assert.ok(preview.isConnected,'the preview frame stays in place while the saved copy loads');
    assert.equal(doc(preview),previewDoc,'the preview document is not loaded again');
    assert.equal(window.document.querySelectorAll('iframe').length,2,'no extra frame is made to hold the preview');
    await act(async()=>{ready.dispatchEvent(new window.Event('load'));});
    assert.ok(!preview.isConnected,'the preview is removed once the saved copy has loaded');
    assert.deepEqual([...window.document.querySelectorAll('iframe')],[ready],'only the saved copy remains');
  };
  await show(rows[0]);await show(rows[1]);
  for(let n=0;n<4;n++)await show(rows[n%2]);
  assert.equal(requests,2,'다른 글을 읽고 돌아와도 저장된 사본을 다시 요청하지 않는다.');
  const reply = { ...rows[0], id: 'partial-reply', title: 'R to @parent: Reply preview' };
  let attempts = 0;
  const readyThread = { url: reply.url, thread: true, html: '<main>Original parent and reply</main>', translationProof: 'test-proof' };
  const retryResources = {
    async cachedWeb() {},
    async web() {
      attempts++;
      return attempts === 1 ? { url: reply.url, thread: true, partial: true, html: '<main>Only reply</main>' } : readyThread;
    },
  };
  await act(async () => { root.render(React.createElement(ArticleDrawer, { ...props, resources: retryResources, key: reply.id, article: reply })); });
  assert.equal(attempts, 1);
  assert.match(window.document.body.textContent, /다시 불러오는 중/);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1650)); });
  assert.equal(attempts, 2);
  assert.ok([...window.document.querySelectorAll('iframe')].some(frame => (frame.getAttribute('srcdoc') ?? frame.getAttribute('srcDoc') ?? '').includes('Original parent and reply')),
    '원글이 빠진 사본을 받으면 사용자가 다시 누르기 전에 원글을 다시 받는다.');
  const originalFetch = globalThis.fetch;
  let submitted;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, `/api/articles/${reply.id}/translate`);
      submitted = JSON.parse(init.body);
      return Response.json({ title: '번역 제목', html: '<p>원글과 댓글 번역</p>', provider: 'deepl', bodySource: 'full' });
    };
    await act(async () => { window.document.querySelector('button[aria-label="번역"]').click(); });
    assert.deepEqual(submitted.xThread, { html: readyThread.html, proof: readyThread.translationProof });
    assert.match(window.document.body.textContent, /원글과 댓글 번역/);
  } finally { globalThis.fetch = originalFetch; }
  console.log('PASS: real reader preview-to-ready frame replacement that keeps the same preview frame until the saved copy loads, cached A/B/A reopening and no duplicate copy requests.');
}finally{
  if(root)await act(async()=>root.unmount());
  for(const[key,descriptor]of originals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  await vite.close();
}
