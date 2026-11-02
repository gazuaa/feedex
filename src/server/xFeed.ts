import type { ParsedFeed } from './rssParser';
import { xProfile } from '../shared/xFeed';

const providers = ['https://nitter.mie.foundation', 'https://nitter.mizuki.st'];
const cache = new Map<string, { expires: number; feed: ParsedFeed; bytes: number }>();
let cachedBytes = 0;
const flights = new Map<string, Promise<ParsedFeed>>();
const limited = new Map<string, number>();
export class XFeedError extends Error { constructor(message: string) { super(message); this.name = 'XFeedError'; } }

// 응답 전체를 메모리에 무제한으로 쌓지 않고, 공개 RSS만 읽는다.
async function readFeed(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new XFeedError('X 게시물 응답이 비어 있습니다.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 1_000_000) throw new XFeedError('X 게시물 응답이 너무 큽니다.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

function originalUrl(value: string, provider: string): string {
  try {
    const url = new URL(value, provider);
    if (url.hostname !== new URL(provider).hostname) return value;
    // 이미지 프록시 주소를 원래 공개 이미지 주소로 돌려 혼합 콘텐츠와 불필요한 경유를 줄인다.
    if (url.pathname.startsWith('/pic/')) {
      const path = decodeURIComponent(url.pathname.slice(5));
      if (/^https:\/\/(?:pbs|abs)\.twimg\.com\//i.test(path)) return path;
      if (/^(?:media|card_img|ext_tw_video_thumb|amplify_video_thumb)\//.test(path)) return `https://pbs.twimg.com/${path}`;
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
    for (const provider of providers) {
      if ((limited.get(provider) || 0) > Date.now()) throw new XFeedError('X 게시물 제공 경로의 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(5000, Math.max(1, deadline - Date.now())));
      try {
        const response = await fetch(`${provider}/${profile.username}/rss`, {
          headers: { Accept: 'application/rss+xml, application/xml;q=0.9', 'User-Agent': 'SFeedRSS/1.0' },
          redirect: 'manual', credentials: 'omit', signal: controller.signal,
        });
        if (response.status === 429) {
          const retry = response.headers.get('Retry-After') || '';
          const wait = /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
          limited.set(provider, Date.now() + Math.max(60_000, Number.isFinite(wait) ? wait : 0));
          await response.body?.cancel();
          throw new XFeedError('X 게시물 제공 경로의 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.');
        }
        if (!response.ok) { await response.body?.cancel(); continue; }
        const xml = await readFeed(response);
        if (!/<rss[\s>]/i.test(xml) || !/<channel[\s>]/i.test(xml)) continue;
        const parsed = parse(xml, `${provider}/${profile.username}/rss`);
        // 다른 계정이나 보안 확인 페이지를 피드로 잘못 저장하지 않는다.
        const source = originalUrl(parsed.htmlUrl || '', provider);
        if (xProfile(source)?.url !== profile.url) continue;
        const feed: ParsedFeed = {
          ...parsed, xmlUrl: profile.url, htmlUrl: profile.url,
          description: `@${profile.username}의 공개 X 게시물`,
          faviconUrl: parsed.faviconUrl ? originalUrl(parsed.faviconUrl, provider) : 'https://abs.twimg.com/favicons/twitter.3.ico',
          articles: parsed.articles.flatMap((article) => {
            const url = originalUrl(article.url, provider);
            if (!/^https:\/\/x\.com\/[a-z\d_]{1,15}\/status\/\d+$/i.test(url)) return [];
            return [{ ...article, guid: `x:${url.split('/').at(-1)}`, url,
              thumbnailUrl: article.thumbnailUrl ? originalUrl(article.thumbnailUrl, provider) : null,
              contentHtml: article.contentHtml?.replace(/((?:href|src)=["'])([^"']+)(["'])/gi, (_all, before, value, after) => `${before}${originalUrl(value.replace(/&amp;/gi, '&'), provider).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')}${after}`) || null,
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
      if (Date.now() >= deadline) break;
    }
    throw new XFeedError('X 공개 게시물을 가져오지 못했습니다. 비공개·삭제된 계정이거나 제공 경로가 일시 중단됐을 수 있습니다.');
  })().finally(() => flights.delete(profile.url));
  flights.set(profile.url, work); return work;
}
