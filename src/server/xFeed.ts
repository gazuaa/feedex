import type { ParsedArticle, ParsedFeed } from './rssParser';
import { xProfile } from '../shared/xFeed';
import { retryAfterMs } from './retryAfter';
import type { D1DatabaseLike } from './types';

export const providers = ['https://nitter.mie.foundation', 'https://nitter.mizuki.st'];
const cache = new Map<string, { expires: number; feed: ParsedFeed; bytes: number }>();
let cachedBytes = 0;
const flights = new Map<string, Promise<ParsedFeed>>();
const limited = new Map<string, number>();
let turn = 0;
// 한도를 알린 경로는 그 시간까지 쉬게 한다. 글 피드와 글 페이지 요청이 같은 기록을 쓴다.
export async function restingUntil(provider: string, db?: D1DatabaseLike): Promise<number> {
  const now = Date.now(), local = limited.get(provider) || 0;
  if (local > now) return local;
  const shared = await db?.prepare('SELECT retry_at FROM x_provider_cooldowns WHERE provider=? AND retry_at>?')
    .bind(provider, now).first<number>('retry_at').catch(() => null);
  if (shared) limited.set(provider, shared);
  return shared || 0;
}
export async function restProvider(provider: string, retryAfter: string | null, db?: D1DatabaseLike): Promise<number> {
  const now = Date.now();
  // 경로가 정해 준 대기 시간을 다음 워커 실행과 수동 요청에도 적용한다.
  const resume = Math.max(limited.get(provider) || 0, now + Math.max(30_000, retryAfterMs(retryAfter, now)));
  limited.set(provider, resume);
  await db?.prepare(`INSERT INTO x_provider_cooldowns(provider,retry_at) VALUES(?,?)
    ON CONFLICT(provider) DO UPDATE SET retry_at=MAX(retry_at,excluded.retry_at)`)
    .bind(provider, resume).run().catch(() => {});
  return resume;
}
const LIMIT_MESSAGE = 'X 게시물 제공 경로의 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.';
export class XFeedError extends Error {
  // retryAfter는 한도에 걸린 제공 경로 중 가장 먼저 다시 열리는 시점까지 남은 초다.
  constructor(message: string, readonly retryAfter?: number, readonly allProvidersLimited = false) { super(message); this.name = 'XFeedError'; }
}

// 응답 전체를 메모리에 무제한으로 쌓지 않고, 공개 RSS·글 페이지만 읽는다.
export async function readFeed(response: Response, limit = 1_000_000): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new XFeedError('X 게시물 응답이 비어 있습니다.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) throw new XFeedError('X 게시물 응답이 너무 큽니다.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

export function originalUrl(value: string, provider: string, hosts: ReadonlySet<string>): string {
  try {
    const url = new URL(value, provider);
    if (!hosts.has(url.hostname)) return value;
    // 스트리밍 주소는 미러의 서명 경로 안에 들어 있다. 영상 데이터는 기기가 X 영상 서버에서 받는다.
    if (url.pathname.startsWith('/video/')) {
      const source = decodeURIComponent(url.pathname.split('/').slice(3).join('/'));
      if (/^https:\/\/video\.twimg\.com\//i.test(source)) return source;
    }
    // 이미지 프록시 주소를 원래 공개 이미지 주소로 돌려 혼합 콘텐츠와 불필요한 경유를 줄인다.
    if (url.pathname.startsWith('/pic/')) {
      const path = decodeURIComponent(url.pathname.slice(5));
      if (/^https:\/\/(?:pbs|abs|video)\.twimg\.com\//i.test(path)) return path;
      if (/^(?:pbs|abs|video)\.twimg\.com\//i.test(path)) return `https://${path}`;
      // 원본 크기 이미지(orig/), 프로필 사진, GIF 미리보기도 X 이미지 서버의 같은 경로다.
      const media = path.replace(/^orig\//, '');
      if (/^(?:media|card_img|ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb|profile_images|profile_banners)\//.test(media)) return `https://pbs.twimg.com/${media}`;
    }
    return `https://x.com${url.pathname}${url.search}`;
  } catch { return value; }
}

function profileImage(xml: string, provider: string, hosts: ReadonlySet<string>): string | null {
  const image = /<image>[\s\S]*?<url>\s*([^<\s]+)\s*<\/url>/i.exec(xml)?.[1];
  if (!image) return null;
  const url = originalUrl(image.replace(/&amp;/g, '&'), provider, hosts);
  return /^https:\/\/pbs\.twimg\.com\/profile_images\//.test(url) ? url : null;
}

type Parse = (xml: string, url: string) => ParsedFeed;
/** 미러가 알려 준 더 옛날 글 쪽. 미러마다 위치 값이 다를 수 있어 그 미러와 함께 기억한다. */
export interface XOlderPage { provider: string; cursor: string }
// 미러 RSS는 Min-Id 헤더로 다음 쪽(더 옛날 글)의 위치를 알려 준다.
const olderPage = (response: Response, provider: string): XOlderPage | undefined => {
  const cursor = response.headers.get('Min-Id');
  return cursor && /^[\w-]{8,500}$/.test(cursor) ? { provider, cursor } : undefined;
};

// 미러 RSS 한 쪽을 읽는다. 다른 계정이나 보안 확인 페이지면 null이다. 글 주소와 본문의 미러 주소는 X 주소로 바꾼다.
function readXPage(xml: string, provider: string, profile: { username: string; url: string }, parse: Parse) {
  if (!/<rss[\s>]/i.test(xml) || !/<channel[\s>]/i.test(xml)) return null;
  const parsed = parse(xml, `${provider}/${profile.username}/rss`);
  // 어떤 경로는 다른 공개 주소 이름으로 피드를 만든다. 피드가 채널 주소로 밝힌 호스트도 같은 경로로 본다.
  const hosts = new Set([new URL(provider).hostname]);
  try { if (parsed.htmlUrl) hosts.add(new URL(parsed.htmlUrl, provider).hostname); } catch { /* 채널 주소가 없으면 요청한 호스트만 쓴다. */ }
  // 다른 계정이나 보안 확인 페이지를 피드로 잘못 저장하지 않는다.
  const source = originalUrl(parsed.htmlUrl || '', provider, hosts);
  if (xProfile(source)?.url !== profile.url) return null;
  const articles: ParsedArticle[] = parsed.articles.flatMap((article) => {
    const url = originalUrl(article.url, provider, hosts);
    if (!/^https:\/\/x\.com\/[a-z\d_]{1,15}\/status\/\d+$/i.test(url)) return [];
    return [{ ...article, guid: `x:${url.split('/').at(-1)}`, url,
      thumbnailUrl: article.thumbnailUrl ? originalUrl(article.thumbnailUrl, provider, hosts) : null,
      contentHtml: article.contentHtml?.replace(/((?:href|src)=["'])([^"']+)(["'])/gi, (_all, before, value, after) => `${before}${originalUrl(value.replace(/&amp;/gi, '&'), provider, hosts).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')}${after}`)
        // 인용 글 링크처럼 글자로 적힌 미러 주소도 X 주소로 바꾼다.
        .replace(/https?:\/\/([a-z\d.-]+)(\/[^\s<>"']*)?/gi, (all, host) => hosts.has(host.toLowerCase()) ? originalUrl(all, provider, hosts).replace(/#m$/, '') : all) || null,
    }];
  });
  return { parsed, hosts, articles };
}

/**
 * 미러가 알려 준 다음 쪽(더 옛날 글 약 20개)을 받는다. `limited`는 미러가 쉬는 중이라 나중에 다시 받을 것,
 * `failed`는 이 쪽을 받지 못한 것이다. 다음 쪽이 없으면 `older`가 비어 있다.
 */
export async function fetchXOlderPage(profileUrl: string, page: XOlderPage, parse: Parse, db?: D1DatabaseLike): Promise<{ articles: ParsedArticle[]; older?: XOlderPage } | 'limited' | 'failed'> {
  const profile = xProfile(profileUrl);
  if (!profile || !providers.includes(page.provider)) return 'failed';
  if (await restingUntil(page.provider, db)) return 'limited';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${page.provider}/${profile.username}/rss?cursor=${encodeURIComponent(page.cursor)}`, {
      headers: { Accept: 'application/rss+xml, application/xml;q=0.9', 'User-Agent': 'FeedExRSS/1.0' },
      redirect: 'manual', credentials: 'omit', signal: controller.signal,
    });
    if (response.status === 429) { await response.body?.cancel(); await restProvider(page.provider, response.headers.get('Retry-After'), db); return 'limited'; }
    if (!response.ok) { await response.body?.cancel(); return 'failed'; }
    const read = readXPage(await readFeed(response), page.provider, profile, parse);
    if (!read) return 'failed';
    const older = olderPage(response, page.provider);
    // 글이 없는 쪽이나 같은 위치를 다시 알려 주면 끝까지 받은 것이다.
    return { articles: read.articles, older: read.articles.length && older?.cursor !== page.cursor ? older : undefined };
  } catch { return 'failed'; }
  finally { clearTimeout(timer); }
}

export async function fetchXFeed(input: string, parse: Parse, db?: D1DatabaseLike): Promise<ParsedFeed> {
  const profile = xProfile(input);
  if (!profile) throw new XFeedError('X 계정의 프로필 주소를 입력해 주세요.');
  const cached = cache.get(profile.url);
  if (cached && cached.expires > Date.now()) return cached.feed;
  const running = flights.get(profile.url); if (running) return running;
  const work = (async () => {
    const deadline = Date.now() + 10_000;
    // 한 경로에 요청이 몰리지 않게 시작 경로를 번갈아 고른다.
    const start = turn++ % providers.length;
    let limitedUntil = 0;
    let limitedProviders = 0;
    for (const provider of [...providers.slice(start), ...providers.slice(0, start)]) {
      if (Date.now() >= deadline) break;
      // 한도에 걸린 경로는 알려 준 시간까지 다시 부르지 않고, 아직 받을 수 있는 다른 경로를 쓴다.
      const until = await restingUntil(provider, db);
      if (until) {
        limitedProviders++;
        limitedUntil = limitedUntil ? Math.min(limitedUntil, until) : until;
        continue;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(5000, Math.max(1, deadline - Date.now())));
      try {
        const response = await fetch(`${provider}/${profile.username}/rss`, {
          headers: { Accept: 'application/rss+xml, application/xml;q=0.9', 'User-Agent': 'FeedExRSS/1.0' },
          redirect: 'manual', credentials: 'omit', signal: controller.signal,
        });
        if (response.status === 429) {
          await response.body?.cancel();
          const resume = await restProvider(provider, response.headers.get('Retry-After'), db);
          limitedProviders++;
          limitedUntil = limitedUntil ? Math.min(limitedUntil, resume) : resume;
          continue;
        }
        if (!response.ok) { await response.body?.cancel(); continue; }
        const xml = await readFeed(response);
        const read = readXPage(xml, provider, profile, parse);
        if (!read) continue;
        const { parsed, hosts } = read;
        const feed: ParsedFeed = {
          ...parsed, xmlUrl: profile.url, htmlUrl: profile.url,
          description: `@${profile.username}의 공개 X 게시물`,
          // 채널 이미지는 계정의 프로필 사진이다. 목록과 X 타임라인의 얼굴로 쓴다.
          faviconUrl: profileImage(xml, provider, hosts) || 'https://abs.twimg.com/favicons/twitter.3.ico',
          articles: read.articles,
          xOlder: olderPage(response, provider),
        };
        cachedBytes -= cache.get(profile.url)?.bytes || 0;
        cache.delete(profile.url);
        const bytes = JSON.stringify(feed).length * 2;
        cache.set(profile.url, { feed, bytes, expires: Date.now() + 300_000 }); cachedBytes += bytes;
        while (cache.size > 64 || cachedBytes > 4_000_000) {
          const oldest = cache.keys().next().value!;
          cachedBytes -= cache.get(oldest)!.bytes; cache.delete(oldest);
        }
        return feed;
      } catch (error) {
        if (error instanceof XFeedError) throw error;
      } finally { clearTimeout(timer); }
    }
    // 받을 수 있는 경로가 하나도 없었다면 가장 먼저 풀리는 시점을 알려, 다음 계정을 곧바로 실패시키지 않게 한다.
    if (limitedUntil) throw new XFeedError(
      LIMIT_MESSAGE,
      Math.max(1, Math.ceil((limitedUntil - Date.now()) / 1000)),
      limitedProviders === providers.length,
    );
    throw new XFeedError('X 공개 게시물을 가져오지 못했습니다. 비공개·삭제된 계정이거나 제공 경로가 일시 중단됐을 수 있습니다.');
  })().finally(() => flights.delete(profile.url));
  flights.set(profile.url, work); return work;
}
