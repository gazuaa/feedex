import type { ParsedFeed } from './rssParser';
import { xProfile } from '../shared/xFeed';

export const providers = ['https://nitter.mie.foundation', 'https://nitter.mizuki.st'];
const cache = new Map<string, { expires: number; feed: ParsedFeed; bytes: number }>();
let cachedBytes = 0;
const flights = new Map<string, Promise<ParsedFeed>>();
const limited = new Map<string, number>();
let turn = 0;
// 한도를 알린 경로는 그 시간까지 쉬게 한다. 글 피드와 글 페이지 요청이 같은 기록을 쓴다.
export function restingUntil(provider: string): number {
  const until = limited.get(provider) || 0;
  return until > Date.now() ? until : 0;
}
export function restProvider(provider: string, retryAfter: string | null): number {
  const wait = /^\d+$/.test(retryAfter || '') ? Number(retryAfter) * 1000 : Date.parse(retryAfter || '') - Date.now();
  // Nitter는 대개 대기 시간을 알려 주지 않는다. 그때는 30초 동안 이 경로만 쉬게 한다.
  const resume = Date.now() + Math.min(600_000, Math.max(30_000, Number.isFinite(wait) ? wait : 0));
  limited.set(provider, resume);
  return resume;
}
const LIMIT_MESSAGE = 'X 게시물 제공 경로의 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.';
export class XFeedError extends Error {
  // retryAfter는 모든 제공 경로가 한도에 걸렸을 때, 다시 시도해도 되는 시점까지 남은 초다.
  constructor(message: string, readonly retryAfter?: number) { super(message); this.name = 'XFeedError'; }
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

export async function fetchXFeed(input: string, parse: (xml: string, url: string) => ParsedFeed): Promise<ParsedFeed> {
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
    for (const provider of [...providers.slice(start), ...providers.slice(0, start)]) {
      if (Date.now() >= deadline) break;
      // 한도에 걸린 경로는 알려 준 시간까지 다시 부르지 않고, 아직 받을 수 있는 다른 경로를 쓴다.
      const until = restingUntil(provider);
      if (until) { limitedUntil = limitedUntil ? Math.min(limitedUntil, until) : until; continue; }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(5000, Math.max(1, deadline - Date.now())));
      try {
        const response = await fetch(`${provider}/${profile.username}/rss`, {
          headers: { Accept: 'application/rss+xml, application/xml;q=0.9', 'User-Agent': 'SFeedRSS/1.0' },
          redirect: 'manual', credentials: 'omit', signal: controller.signal,
        });
        if (response.status === 429) {
          const resume = restProvider(provider, response.headers.get('Retry-After'));
          limitedUntil = limitedUntil ? Math.min(limitedUntil, resume) : resume;
          await response.body?.cancel();
          continue;
        }
        if (!response.ok) { await response.body?.cancel(); continue; }
        const xml = await readFeed(response);
        if (!/<rss[\s>]/i.test(xml) || !/<channel[\s>]/i.test(xml)) continue;
        const parsed = parse(xml, `${provider}/${profile.username}/rss`);
        // 어떤 경로는 다른 공개 주소 이름으로 피드를 만든다. 피드가 채널 주소로 밝힌 호스트도 같은 경로로 본다.
        const hosts = new Set([new URL(provider).hostname]);
        try { if (parsed.htmlUrl) hosts.add(new URL(parsed.htmlUrl, provider).hostname); } catch { /* 채널 주소가 없으면 요청한 호스트만 쓴다. */ }
        // 다른 계정이나 보안 확인 페이지를 피드로 잘못 저장하지 않는다.
        const source = originalUrl(parsed.htmlUrl || '', provider, hosts);
        if (xProfile(source)?.url !== profile.url) continue;
        const feed: ParsedFeed = {
          ...parsed, xmlUrl: profile.url, htmlUrl: profile.url,
          description: `@${profile.username}의 공개 X 게시물`,
          faviconUrl: parsed.faviconUrl ? originalUrl(parsed.faviconUrl, provider, hosts) : 'https://abs.twimg.com/favicons/twitter.3.ico',
          articles: parsed.articles.flatMap((article) => {
            const url = originalUrl(article.url, provider, hosts);
            if (!/^https:\/\/x\.com\/[a-z\d_]{1,15}\/status\/\d+$/i.test(url)) return [];
            return [{ ...article, guid: `x:${url.split('/').at(-1)}`, url,
              thumbnailUrl: article.thumbnailUrl ? originalUrl(article.thumbnailUrl, provider, hosts) : null,
              contentHtml: article.contentHtml?.replace(/((?:href|src)=["'])([^"']+)(["'])/gi, (_all, before, value, after) => `${before}${originalUrl(value.replace(/&amp;/gi, '&'), provider, hosts).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')}${after}`) || null,
            }];
          }),
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
    if (limitedUntil) throw new XFeedError(LIMIT_MESSAGE, Math.max(1, Math.ceil((limitedUntil - Date.now()) / 1000)));
    throw new XFeedError('X 공개 게시물을 가져오지 못했습니다. 비공개·삭제된 계정이거나 제공 경로가 일시 중단됐을 수 있습니다.');
  })().finally(() => flights.delete(profile.url));
  flights.set(profile.url, work); return work;
}
