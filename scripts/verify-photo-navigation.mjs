import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {parseHTML} from 'linkedom';
const vite=await createServer({configFile:false,server:{middlewareMode:true,ws:false},appType:'custom',logLevel:'silent'});
const originals=new Map(['window','document'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
try{
  const {window,document}=parseHTML('<html><body><main id="list">목록</main></body></html>');
  const create=document.createElement.bind(document);
  document.createElement=(name)=>{
    const element=create(name);
    if(name==='dialog'){
      Object.defineProperty(element,'open',{get(){return this.hasAttribute('open');}});
      element.showModal=()=>element.setAttribute('open','');
      element.close=()=>{element.removeAttribute('open');element.dispatchEvent(new window.Event('close'));};
    }
    return element;
  };
  Object.defineProperties(globalThis,{window:{configurable:true,value:window},document:{configurable:true,value:document}});
  const {openPhotoViewer}=await vite.ssrLoadModule('/src/client/xPostFrame.ts');
  const photo='https://example.test/photo.jpg';
  openPhotoViewer([photo]);
  const first=document.querySelector('dialog[data-sfeed-photo-viewer]');assert.ok(first.open);
  first.close();assert.equal(document.querySelector('dialog[data-sfeed-photo-viewer]'),null,'기본 닫기로 닫힌 사진 레이어도 제거한다');
  openPhotoViewer([photo]);window.dispatchEvent(new window.Event('popstate'));
  assert.equal(document.querySelector('dialog[data-sfeed-photo-viewer]'),null,'뒤로가기 후 목록 위에 모달을 남기지 않는다');
  const stale=openPhotoViewer([photo]);openPhotoViewer([photo+'?new=1']);
  const newest=document.querySelector('dialog[data-sfeed-photo-viewer]');stale();assert.equal(document.querySelector('dialog[data-sfeed-photo-viewer]'),newest,'이전 사진의 정리는 새 뷰어를 닫지 않는다');
  window.dispatchEvent(new window.Event('pagehide'));assert.equal(document.querySelector('dialog[data-sfeed-photo-viewer]'),null,'화면을 떠날 때도 모달을 정리한다');
  openPhotoViewer([photo]);document.querySelector('[data-photo-close]').click();assert.equal(document.querySelector('dialog[data-sfeed-photo-viewer]'),null,'기존 닫기 버튼도 유지한다');
  assert.ok(document.querySelector('#list'),'목록 자체는 보존한다');
  console.log('통과: 사진 기본 닫기·뒤로가기·화면 종료·교체 후 모달 제거와 목록 보존.');
}finally{for(const[key,value]of originals){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}await vite.close();}
