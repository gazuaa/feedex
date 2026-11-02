// Slap처럼 공개된 설치·오프라인 자원만 캐시한다. 계정 데이터와 앱 HTML은
// 항상 네트워크에서 받으므로, 계정을 바꿔도 이전 사용자의 피드가 드러나지 않고
// 배포 뒤에 예전 앱 껍데기가 남지 않는다.
const CACHE = 'sfeed-public-v4';
const OFFLINE = '/offline.html';
const PUBLIC_ASSETS = [OFFLINE, '/offline.js', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PUBLIC_ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('sfeed-public-') && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || /^\/(?:api|auth)(?:\/|$)/.test(url.pathname)) return;
  if (PUBLIC_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then((cache) => cache.match(url.pathname)).then((cached) => cached || fetch(request)));
  } else if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.open(CACHE)).match(OFFLINE).then((cached) => cached || new Response('인터넷에 연결한 뒤 다시 열어 주세요.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }))));
  }
});

// 이 알림은 실행 중인 클라이언트가 기기에서 새 글을 찾은 뒤 만든다.
// 서버 푸시 구독이나 푸시 처리기는 일부러 두지 않았다.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data;
  if (!data?.articleId || !data?.account) return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
    const client = windows.find((window) => new URL(window.url).origin === self.location.origin && new URL(window.url).pathname === '/');
    if (client) { client.postMessage({ type: 'sfeed-open-article', ...data }); return client.focus(); }
    const url = new URL('/', self.location.origin); url.searchParams.set('article_id', data.articleId); url.searchParams.set('account', data.account);
    return self.clients.openWindow(url.href);
  }));
});
