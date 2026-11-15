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
  const {clampPhotoOffset}=await vite.ssrLoadModule('/src/client/photoZoom.ts');
  assert.equal(clampPhotoOffset(500,195,359,3,0,390),343.5,'확대한 사진은 왼쪽 가장자리가 화면 안으로 들어오지 않는다');
  assert.equal(clampPhotoOffset(-500,195,359,3,0,390),-343.5,'오른쪽 가장자리도 화면 끝에서 멈춘다');
  assert.equal(clampPhotoOffset(80,195,100,2,0,390),0,'화면보다 작은 사진은 가운데에 둔다');
  const {photoTap,COPY_PHOTO_SCRIPT}=await vite.ssrLoadModule('/src/client/photoTap.ts');
  const page=parseHTML(`<main><img id="logo" src="https://e.test/logo.png" data-w="40" data-h="40"><img id="plain" src="https://e.test/a.jpg" data-w="358" data-h="200"><a href="https://e.test/big.jpg"><img id="file" src="https://e.test/b-thumb.jpg" data-w="180" data-h="120"></a><a href="https://e.test/story"><img id="hero" src="https://e.test/c.jpg" data-w="358" data-h="200"></a><a href="https://e.test/other"><img id="thumb" src="https://e.test/d.jpg" data-w="100" data-h="100"></a></main>`).document;
  for(const img of page.querySelectorAll('img'))img.getBoundingClientRect=()=>({width:+img.dataset.w,height:+img.dataset.h});
  const tap=id=>photoTap(page.getElementById(id),page,390);
  assert.equal(tap('logo'),null,'작은 로고·아이콘은 열지 않는다');
  assert.deepEqual(tap('plain'),{urls:['https://e.test/a.jpg','https://e.test/big.jpg','https://e.test/c.jpg'],index:0},'링크 없는 사진은 같은 글의 큰 사진들과 함께 연다');
  assert.equal(tap('file').urls[tap('file').index],'https://e.test/big.jpg','그림 파일 링크는 그 큰 그림을 연다');
  assert.equal(tap('hero').index,2,'다른 주소로 가는 링크라도 본문 폭의 큰 사진은 사진 보기로 연다');
  assert.equal(tap('thumb'),null,'다른 글로 가는 작은 썸네일은 링크를 따른다');
  const {framedCopy}=await vite.ssrLoadModule('/src/client/mobile.ts');const {X_THREAD_MARK}=await vite.ssrLoadModule('/src/shared/xThreadStyle.ts');
  assert.ok(framedCopy('<p>글</p>').includes(COPY_PHOTO_SCRIPT),'모든 웹 사본은 그림을 앱의 사진 보기로 연다');
  assert.ok(!framedCopy(X_THREAD_MARK+'<p>글</p>').includes(COPY_PHOTO_SCRIPT),'X 사본은 자기 사진 처리를 쓴다');
  console.log('통과: 사진 기본 닫기·뒤로가기·화면 종료·교체 후 모달 제거와 목록 보존, 확대한 사진의 이동 범위, 본문·웹 사본 공통 사진 열기 규칙.');
}finally{for(const[key,value]of originals){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}await vite.close();}
