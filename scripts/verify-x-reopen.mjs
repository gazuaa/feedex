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
      const html = [
        '<article class="post before"><p>원글 작성자</p><p>원글 본문 번역</p><div class="quote"><a href="https://x.com/quoted/status/3">' + '원글에 달린 긴 인용글의 번역입니다. '.repeat(12) + '</a></div></article>',
        '<article class="post before"><p>중간 댓글 번역</p></article>',
        '<article class="post main"><p>선택한 댓글 번역</p></article>',
      ].join('');
      return Response.json({ title: '번역 제목', html, provider: 'deepl', bodySource: 'full' });
    };
    await act(async () => { window.document.querySelector('button[aria-label="번역"]').click(); });
    assert.deepEqual(submitted.xThread, { html: readyThread.html, proof: readyThread.translationProof });
    const translatedBody = window.document.querySelector('.feedex-article-content');
    assert.match(translatedBody.textContent, /^원글 작성자원글 본문 번역원글에 달린 긴 인용글[\s\S]*중간 댓글 번역선택한 댓글 번역/,
      '긴 인용글이 링크여도 원글을 삭제하지 않고 대화 순서대로 보여 준다.');
  } finally { globalThis.fetch = originalFetch; }
  const { XPostPanel } = await vite.ssrLoadModule('/src/components/XPostPanel.tsx');
  const quotedUrl = 'https://x.com/quoted/status/42';
  const quotedHtml = `<!doctype html><html><head>${X_THREAD_MARK}</head><body><main><article class="post main">引用原文</article></main></body></html>`;
  let quoteTranslations = 0, quoteSummaries = 0;
  try {
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('/x-post?')) return Response.json({ url: quotedUrl, html: quotedHtml, thread: true, translationProof: 'quote-proof' });
      if (url === `/api/articles/${reply.id}/summarize`) {
        quoteSummaries++;
        assert.deepEqual(JSON.parse(init.body), { xUrl: quotedUrl, xThread: { html: quotedHtml, proof: 'quote-proof' } });
        return Response.json({ aiSummary: '**핵심 요약**\n열린 인용글의 요약입니다.' });
      }
      assert.equal(url, `/api/articles/${reply.id}/translate`);
      quoteTranslations++;
      assert.deepEqual(JSON.parse(init.body), { source: 'full', xUrl: quotedUrl, xThread: { html: quotedHtml, proof: 'quote-proof' } });
      return Response.json({ html: '<article class="post main">인용글 본문 번역</article>', provider: 'deepl' });
    };
    await act(async () => { root.render(React.createElement(XPostPanel, { accountId: props.accountId, source: reply, target: { articleId: reply.id, url: quotedUrl }, onBack() {}, isDark: false })); });
    const doc = () => [...window.document.querySelectorAll('iframe')].map(frame => frame.getAttribute('srcdoc') ?? frame.getAttribute('srcDoc') ?? '').join('');
    assert.match(doc(), /引用原文/);
    await act(async () => { window.document.querySelector('button[aria-label="번역"]').click(); });
    assert.match(doc(), /인용글 본문 번역/);
    await act(async () => { window.document.querySelector('button[aria-label="원문 보기"]').click(); });
    assert.match(doc(), /引用原文/);
    await act(async () => { window.document.querySelector('button[aria-label="번역"]').click(); });
    assert.equal(quoteTranslations, 1, '같은 인용글은 원문으로 돌아갔다가 번역을 다시 켜도 재요청하지 않는다.');
    await act(async () => { window.document.querySelector('button[aria-label="요약"]').click(); });
    assert.match(window.document.querySelector('.feedex-web-summary').textContent, /열린 인용글의 요약/);
    assert.match(doc(), /인용글 본문 번역/);
    await act(async () => { window.document.querySelector('header button[aria-label="요약 닫기"]').click(); });
    assert.equal(window.document.querySelector('.feedex-web-summary'), null);
    await act(async () => { window.document.querySelector('button[aria-label="요약"]').click(); });
    assert.equal(quoteSummaries, 1, '같은 글의 요약을 다시 펼칠 때 이미 받은 내용을 쓴다.');
  } finally { globalThis.fetch = originalFetch; }
  console.log('PASS: real reader preview-to-ready frame replacement that keeps the same preview frame until the saved copy loads, cached A/B/A reopening and no duplicate copy requests.');
}finally{
  if(root)await act(async()=>root.unmount());
  for(const[key,descriptor]of originals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  await vite.close();
}
