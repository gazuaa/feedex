import assert from 'node:assert/strict';
import { createServer } from 'vite';
const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
const keys=['window','localStorage','webkit','navigator','Notification'];
const previous=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
try {
 const values=new Map(), messages=[];
 let status='default', requestStatus='granted', fail=false;
 const native={postMessage:async message=>{
  messages.push(message);
  if(message.action==='status')return {permission:status};
  if(message.action==='request'){status=requestStatus;return {permission:status};}
  if(message.action==='show'&&fail)throw new Error('notification delivery failed');
  return {};
 }};
 const window=new EventTarget();
 Object.defineProperties(globalThis,{
  window:{configurable:true,value:window},
  webkit:{configurable:true,writable:true,value:{messageHandlers:{feedex:{postMessage(){}},feedexNotifications:native}}},
  localStorage:{configurable:true,value:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}},
  navigator:{configurable:true,value:{userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',maxTouchPoints:0,serviceWorker:{getRegistration(){assert.fail('native notifications never use the browser service worker');}}}},
  Notification:{configurable:true,value:{permission:'denied',requestPermission(){assert.fail('the native app never asks for browser notification permission');}}}
 });
 const n=await vite.ssrLoadModule('/src/client/nativeNotifications.ts');
 const local=await vite.ssrLoadModule('/src/client/localNotifications.ts');
 const original=globalThis.webkit;
 globalThis.webkit={messageHandlers:{feedex:original.messageHandlers.feedex}};
 assert.match(await local.enableLocalNotifications('old-app'),/업데이트/,'old native apps get an actionable update message');
 assert.equal(local.localNotificationsEnabled('old-app'),false);
 globalThis.webkit=original;
 assert.equal(await n.refreshNativeNotificationPermission(),'default');
 assert.equal(await local.enableLocalNotifications('owner'),'');
 assert.equal(local.localNotificationsEnabled('owner'),true);
 assert.equal(local.localNotificationsEnabled('other'),false);
 const first={id:'article-1',feed_title:'CoinDesk',title:'New article'};
 await local.notifyNewArticles('owner',[first,first]);await local.notifyNewArticles('owner',[first]);
 const shown=messages.filter(m=>m.action==='show');
 assert.equal(shown.length,1,'device history deduplicates native notifications');
 assert.deepEqual(shown[0],{action:'show',title:'CoinDesk',body:'New article',account:'owner',articleId:'article-1'});
 await local.notifyNewArticles('owner',[{...first,id:'late'}],undefined,()=>false);
 assert.equal(messages.filter(m=>m.action==='show').length,1,'stale account sessions cannot notify');
 local.setLocalNotifications('owner',false);await local.notifyNewArticles('owner',[{...first,id:'off'}]);
 assert.equal(messages.filter(m=>m.action==='show').length,1,'turning the switch off stops notifications');
 local.setLocalNotifications('owner',true);fail=true;
 await local.notifyNewArticles('owner',[{...first,id:'retry'}]);fail=false;
 await local.notifyNewArticles('owner',[{...first,id:'retry'}]);
 assert.equal(messages.filter(m=>m.action==='show'&&m.articleId==='retry').length,2,'a failed delivery remains retryable');
 requestStatus='denied';assert.match(await local.enableLocalNotifications('denied'),/macOS 알림 설정/);
 assert.equal(local.localNotificationsEnabled('denied'),false);
 // 사용자가 시스템 설정에서 허용한 뒤 앱으로 돌아오면 스위치도 자동으로 켜진다.
 let changes=0;const unsubscribe=n.subscribeNativeNotificationPermission(()=>changes++);
 await n.refreshNativeNotificationPermission();status='granted';
 window.dispatchEvent(new Event('feedex-notification-permission'));await n.refreshNativeNotificationPermission();
 assert.equal(local.localNotificationsEnabled('denied'),true);assert.ok(changes>0);unsubscribe();
 await n.openNativeNotificationSettings();assert.equal(messages.at(-1).action,'settings');
 // 브라우저에서는 원래 서비스 워커 알림 경로를 유지한다.
 delete globalThis.webkit;
 assert.equal(local.localNotificationsEnabled('owner'),false,'browser permission is independent of native permission');
 console.log('PASS: macOS permission requests bypass browser APIs; old-app update guidance; account opt-in, local delivery/dedup/retry, disabled/stale guards, settings permission refresh and browser/native separation.');
} finally {
 for(const [key,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 await vite.close();
}
