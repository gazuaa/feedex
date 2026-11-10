import type { D1DatabaseLike } from './types';
import { fetchAndParseFeed } from './rssParser';
import { XFeedError } from './xFeed';

// X 계정의 프로필 사진 주소. 이미 받아 둔 X 피드에서 먼저 찾고, 없으면 그 계정의 공개 미러 RSS를 한 번 받아
// 채널 그림에서 찾는다. 미러는 요청 한도가 빡빡하므로 한 번에 몇 계정만 받고, 찾은 결과는 일주일 남긴다.
const HANDLE = /^[a-z\d_]{1,15}$/i;
const PROFILE_IMAGE = /^https:\/\/pbs\.twimg\.com\/profile_images\//;
/** 한 요청에서 미러로 새로 받는 계정 수. 나머지는 기기가 나중에 다시 묻는다. */
const MIRROR_LOOKUPS = 4;
const cacheKey = (handle: string) => `https://sfeed.internal/x-avatar/${handle}`;
const edgeCache = () => (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;

/**
 * 찾은 계정은 사진 주소나 null(사진 없음)을 돌려준다. 이번에 찾지 못한 계정은 빠진다.
 * `more`는 한 번에 받는 수를 넘겨 남겨 둔 계정이 있다는 뜻이다. 미러가 한도에 걸려 멈췄으면 false다.
 */
export async function resolveXAvatars(db: D1DatabaseLike, input: unknown): Promise<{ avatars: Record<string, string | null>; more: boolean }> {
  const handles = [...new Set((Array.isArray(input) ? input : []).filter((value): value is string => typeof value === 'string' && HANDLE.test(value)).map((value) => value.toLowerCase()))].slice(0, 20);
  const found: Record<string, string | null> = {};
  if (!handles.length) return { avatars: found, more: false };
  const cache = edgeCache();
  for (const handle of handles) {
    const hit = await cache?.match(cacheKey(handle)).catch(() => undefined);
    if (hit) found[handle] = ((await hit.json().catch(() => null)) as { url?: string | null } | null)?.url ?? null;
  }
  const missing = handles.filter((handle) => !(handle in found));
  if (missing.length) {
    const rows = await db.prepare(`SELECT xml_url,favicon_url FROM feeds WHERE xml_url IN (${missing.map(() => '?').join(',')})`).bind(...missing.map((handle) => `https://x.com/${handle}`)).all<{ xml_url: string; favicon_url: string | null }>();
    for (const row of rows.results || []) if (row.favicon_url && PROFILE_IMAGE.test(row.favicon_url)) found[row.xml_url.slice('https://x.com/'.length)] = row.favicon_url;
  }
  let lookups = 0, more = false;
  for (const handle of handles.filter((item) => !(item in found))) {
    if (lookups++ >= MIRROR_LOOKUPS) { more = true; break; }
    try {
      const feed = await fetchAndParseFeed(`https://x.com/${handle}`, db);
      found[handle] = feed.faviconUrl && PROFILE_IMAGE.test(feed.faviconUrl) ? feed.faviconUrl : null;
    } catch (error) {
      // 미러가 한도에 걸렸으면 이번에는 그만 묻는다. 그 밖에 받지 못한 계정도 기억하지 않고 나중에 다시 묻는다.
      if (error instanceof XFeedError && error.retryAfter) break;
    }
  }
  if (cache) await Promise.all(Object.entries(found).map(([handle, url]) => cache.put(cacheKey(handle), new Response(JSON.stringify({ url }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${url ? 7 * 86400 : 86400}` } })).catch(() => {})));
  return { avatars: found, more };
}
