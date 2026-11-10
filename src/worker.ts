import { app } from './server/app';
import { pruneReaderChanges } from './server/readerSync';
import type { Env } from './server/types';
import { generatedRss, refreshStoredFeeds, storedFeedColumns, type RefreshProgress, type StoredFeed } from './server/feedLoader';
import { pauseSupported } from './server/feedPause';
import { checkFeedPublicationDates } from './server/articlePublication';
import { backfillXFeeds } from './server/xBackfill';
import { refreshQueryStats } from './server/queryStats';
import { ARTICLE_IMAGE_PATH, serveArticleImage, servePageAsset } from './server/pageAssets';

const LEGACY_HOST = 'sfeed.jyk.workers.dev';
const PRIMARY_ORIGIN = 'https://feedex.jyk.workers.dev';

export default {
  async fetch(request: Request, env: Env, ctx: unknown): Promise<Response> {
    const url = new URL(request.url);

    const rssId = /^\/rss\/([a-zA-Z0-9_-]+)\.xml$/.exec(url.pathname)?.[1];
    if (rssId && request.method === 'GET') return generatedRss(env, rssId);
    // 페이지 사본 속 http 그림·스타일. 사본이 앱 밖 출처의 샌드박스에서 부르므로 로그인 없이 서명으로 확인한다.
    if (url.pathname.startsWith('/page-asset/')) return servePageAsset(request, env);
    if (url.pathname.startsWith(ARTICLE_IMAGE_PATH)) return serveArticleImage(request, env);
    if (url.hostname === LEGACY_HOST) {
      return Response.redirect(`${PRIMARY_ORIGIN}${url.pathname}${url.search}`, 308);
    }

    if (url.pathname.startsWith('/api/')) {
      return app.fetch(request, env, ctx as never);
    }

    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (url.pathname === '/' || url.pathname.endsWith('.html') || ['/sw.js', '/offline.js', '/manifest.webmanifest', '/downloads/appcast.xml'].includes(url.pathname)) {
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

    return new Response('FeedEx Worker API is running.', { status: 200 });
  },

  async scheduled(event: { scheduledTime?: number }, env: Env, _ctx: unknown): Promise<void> {
    if (!env.DB) return;
    // 한 단계가 실패해도 다음 예약 작업은 이어서 실행한다.
    const step = async <T>(name: string, work: () => Promise<T>) => {
      try { return await work(); }
      catch (error) { console.error(`예약 실행 ${name} 실패:`, error instanceof Error ? error.message : error); }
    };
    const now = Date.now();
    // 수집을 시작하고 응답을 받기까지 걸린 시간 때문에 다음 회차를 통째로 건너뛰지 않게 한다.
    const xFreshCutoff = new Date(now - 14 * 60_000).toISOString();
    const regular = event.scheduledTime === undefined || new Date(event.scheduledTime).getUTCMinutes() % 15 === 0;
    if (regular) await step('쿼리 통계', () => refreshQueryStats(env.DB, event.scheduledTime));
    const paused = await step('구독 상태 조회', () => pauseSupported(env.DB));
    const select = (x: boolean) => env.DB.prepare(
      `SELECT ${storedFeedColumns} FROM feeds f LEFT JOIN rss_builders b ON b.feed_id=f.id
       LEFT JOIN feed_refresh_state r ON r.feed_id=f.id
       WHERE EXISTS(SELECT 1 FROM subscriptions s WHERE s.feed_id=f.id ${paused ? 'AND s.paused_at IS NULL' : ''})
         AND COALESCE(r.retry_at,0)<=? AND COALESCE(r.lease_until,0)<=?
         AND f.xml_url ${x ? 'LIKE' : 'NOT LIKE'} 'https://x.com/%'
         ${x ? 'AND (f.last_fetched_at IS NULL OR f.last_fetched_at<=?)' : ''}
       ORDER BY COALESCE(r.attempted_at,f.last_fetched_at) ASC, f.id LIMIT ${x ? 24 : 100}`
    ).bind(now, now, ...(x ? [xFreshCutoff] : [])).all<StoredFeed>();
    const rss = regular ? await step('RSS 피드 조회', () => select(false)) : undefined;
    const x = await step('X 피드 조회', () => select(true));
    const feeds = [...(rss?.results || []), ...(x?.results || [])];
    const progress: RefreshProgress = { done: 0, inserted: 0 };
    const refreshed = await step('피드 새로고침', () => refreshStoredFeeds(env, feeds, progress));
    // 최신 글 수집이 끝난 뒤에만 과거 글을 조금씩 채운다.
    if (regular && x && refreshed !== undefined && !progress.xRateLimited) await step('X 예전 글 채우기', () => backfillXFeeds(env.DB, 2));
    if (regular) {
      await step('발행일 확인', () => checkFeedPublicationDates(env.DB, feeds.map((feed) => feed.id)));
      await step('동기화 기록 정리', () => pruneReaderChanges(env.DB));
    }
  },
};
