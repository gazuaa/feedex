import { app } from './server/app';
import { pruneReaderChanges } from './server/readerSync';
import type { Env } from './server/types';
import { generatedRss, refreshStoredFeeds, storedFeedColumns, type StoredFeed } from './server/feedLoader';
import { checkFeedPublicationDates } from './server/articlePublication';
import { backfillXFeeds } from './server/xBackfill';
import { servePageAsset } from './server/pageAssets';

export default {
  async fetch(request: Request, env: Env, ctx: unknown): Promise<Response> {
    const url = new URL(request.url);

    const rssId = /^\/rss\/([a-zA-Z0-9_-]+)\.xml$/.exec(url.pathname)?.[1];
    if (rssId && request.method === 'GET') return generatedRss(env, rssId);
    // 페이지 사본 속 http 그림·스타일. 사본이 앱 밖 출처의 샌드박스에서 부르므로 로그인 없이 서명으로 확인한다.
    if (url.pathname.startsWith('/page-asset/')) return servePageAsset(request, env);

    if (url.pathname.startsWith('/api/')) {
      return app.fetch(request, env, ctx as never);
    }

    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (url.pathname === '/' || url.pathname.endsWith('.html') || ['/sw.js', '/offline.js', '/manifest.webmanifest'].includes(url.pathname)) {
        const headers = new Headers(assetResponse.headers);
        headers.set('Cache-Control', 'no-store');
        headers.set('X-Content-Type-Options', 'nosniff');
        if (url.pathname === '/sw.js') headers.set('Service-Worker-Allowed', '/');
        return new Response(assetResponse.body, {
          status: assetResponse.status,
          statusText: assetResponse.statusText,
          headers,
        });
      }
      // Vite는 이 파일 이름에 내용 해시를 넣는다. 앱을 다시 켜도 기기에 남겨 두고,
      // 새 HTML이 다음 배포 버전을 고른다.
      if (/^\/assets\/[^/]+-[\w-]{8,}\.(?:js|css)$/.test(url.pathname) && assetResponse.ok && /javascript|^text\/css/i.test(assetResponse.headers.get('Content-Type') || '')) {
        const headers = new Headers(assetResponse.headers);
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        return new Response(assetResponse.body, { status: assetResponse.status, statusText: assetResponse.statusText, headers });
      }
      return assetResponse;
    }

    return new Response('SFeed Worker API is running.', { status: 200 });
  },

  async scheduled(_event: unknown, env: Env, _ctx: unknown): Promise<void> {
    if (!env.DB) return;
    const res = await env.DB.prepare(
      `SELECT ${storedFeedColumns} FROM feeds f LEFT JOIN rss_builders b ON b.feed_id=f.id
       WHERE b.id IS NULL OR EXISTS(SELECT 1 FROM subscriptions s WHERE s.feed_id=f.id)
       ORDER BY f.last_fetched_at ASC LIMIT 100`
    ).all<StoredFeed>();

    const feeds = res.results || [];
    await refreshStoredFeeds(env, feeds);
    // X 계정의 예전 글은 새로고침이 끝난 뒤 몇 쪽씩 채운다.
    await backfillXFeeds(env.DB).catch(() => 0);
    await checkFeedPublicationDates(env.DB, feeds.map((feed) => feed.id));
    await pruneReaderChanges(env.DB);
  },
};
