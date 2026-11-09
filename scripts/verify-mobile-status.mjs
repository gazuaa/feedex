import assert from 'node:assert/strict';
import { createServer } from 'vite';
const vite = await createServer({configFile:false,server:{middlewareMode:true,ws:false},appType:'custom',logLevel:'silent'});
const previous = new Map(['window','localStorage','fetch'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
try {
  const storage=new Map([['sfeed_session_token','account-a']]),events=[];
  const view=new EventTarget();view.addEventListener('feedex-sync-status',event=>events.push(event.detail));
  Object.defineProperties(globalThis,{window:{configurable:true,value:view},localStorage:{configurable:true,value:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}}});
  const {apiRequest,ApiError}=await vite.ssrLoadModule('/src/client/api.ts');
  let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json({changed:false});};
  await apiRequest('/api/sync',{method:'POST',body:'{}'});
  assert.equal(calls,1,'상태 표시 때문에 추가 요청을 보내지 않는다');
  assert.equal(events.length,1);assert.equal(events[0].ok,true);assert.equal(events[0].token,'account-a');assert.ok(events[0].at>0);
  await apiRequest('/api/articles?scope=all');assert.equal(events.length,1,'기사 미리 불러오기는 마지막 동기화 상태를 덮지 않는다');
  await apiRequest('/api/feeds/refresh',{method:'POST'});assert.equal(events.length,1,'새로고침 접수만으로 갱신 완료라고 표시하지 않는다');
  globalThis.fetch=async()=>Response.json({error:'잠시 후 다시 시도해 주세요.'},{status:503});
  await assert.rejects(apiRequest('/api/feeds/refresh',{method:'POST'}),ApiError);assert.equal(events.at(-1).ok,false);
  globalThis.fetch=async()=>{throw new TypeError('연결 실패');};
  await assert.rejects(apiRequest('/api/bootstrap'),TypeError);assert.equal(events.at(-1).ok,false);
  const count=events.length,controller=new AbortController();controller.abort();
  await assert.rejects(apiRequest('/api/bootstrap',{signal:controller.signal}),TypeError);assert.equal(events.length,count,'사용자가 취소한 요청은 연결 실패로 표시하지 않는다');
  let finish;globalThis.fetch=()=>new Promise(resolve=>finish=resolve);
  const old=apiRequest('/api/sync',{method:'POST'});storage.set('sfeed_session_token','account-b');finish(Response.json({changed:false}));await old;
  assert.equal(events.at(-1).token,'account-a','늦게 끝난 요청은 시작한 세션 정보를 유지한다');
  console.log('통과: 기존 요청만 사용, 실제 확인 완료·통신 실패·HTTP 오류 구분, 취소와 이전 세션 응답 처리.');
} finally {
  for(const[key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  await vite.close();
}
