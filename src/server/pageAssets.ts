import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from './types';
import { publicPageUrl } from './rssBuilder';

// https인 앱 안의 페이지 사본(RSS 빌더 미리보기, 웹 사본)은 http로만 열리는 그림·스타일을 불러오지 못한다.
// 브라우저가 혼합 콘텐츠로 막거나 https로 바꿔 부르는데, https가 없는 사이트는 그대로 깨진다.
// 서버가 사본을 만들 때 그런 주소에 서명해 두고, 서명이 맞는 http 그림·스타일만 대신 받아 준다.
// 서명이 없으면 아무 주소나 대신 받는 통로가 되므로 받지 않는다.

/** http 주소를 앱이 대신 받는 주소로 바꾼다. 바꿀 필요가 없는 주소는 undefined. */
export type AssetProxy = (url: string) => string | undefined;

const ASSET_PATH = '/page-asset/';
const MAX_BYTES = 3_000_000;
const TYPES = /^(?:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)|text\/css)$/i;
const IMAGES = /^image\/(?:png|jpe?g|gif|webp|avif|bmp|svg\+xml)$/i;
export const ARTICLE_IMAGE_PATH = '/article-image/';

// 별도 비밀값을 따로 두지 않고, 서버 비밀값에서 이 용도의 키를 따로 뽑아 쓴다.
function assetKey(env: Pick<Env, 'X_SETTINGS_SECRET'>): Buffer | null {
  const secret = env.X_SETTINGS_SECRET;
  return secret && secret.length >= 32 ? createHmac('sha256', secret).update('sfeed-page-asset-v1').digest() : null;
}
const sign = (key: Buffer, url: string) => createHmac('sha256', key).update(url).digest('base64url').slice(0, 22);

/** `origin`은 앱 주소다. 사본에는 원래 사이트를 가리키는 <base>가 있으므로 절대 주소로 만든다. */
export function pageAssetProxy(env: Pick<Env, 'X_SETTINGS_SECRET'>, origin: string): AssetProxy | undefined {
  const key = assetKey(env);
  if (!key || !/^https:/.test(origin)) return undefined;
  return (url) => {
    if (!/^http:\/\//i.test(url)) return undefined;
    try { publicPageUrl(url); } catch { return undefined; }
    return `${origin}${ASSET_PATH}${sign(key, url)}?u=${encodeURIComponent(url)}`;
  };
}

const absolute = (value: string, base: string) => { try { return new URL(value.trim(), base).href; } catch { return null; } };

/** 스타일 안의 url(...)과 @import 주소를 바꾼다. 상대 주소는 그 스타일의 주소를 기준으로 푼다. */
export function proxyCssUrls(css: string, base: string, proxy: AssetProxy): string {
  const swap = (raw: string) => {
    const url = absolute(raw.replace(/^['"]|['"]$/g, ''), base);
    return url ? proxy(url) : undefined;
  };
  return css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (all, _quote, raw) => { const next = swap(raw); return next ? `url("${next}")` : all; })
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (all, _quote, raw) => { const next = swap(raw); return next ? `@import "${next}"` : all; });
}

type Node = { getAttribute(name: string): string | null; setAttribute(name: string, value: string): void; textContent: string | null };
type Root = { querySelectorAll(selector: string): Iterable<unknown> };
/** 사본 문서의 그림·스타일 주소 가운데 http 주소만 대신 받는 주소로 바꾼다. */
export function proxyPageAssets(document: Root, pageUrl: string, proxy: AssetProxy) {
  const nodes = (selector: string) => [...document.querySelectorAll(selector)] as Node[];
  const swap = (raw: string | null) => { const url = raw && absolute(raw, pageUrl); return url ? proxy(url) : undefined; };
  for (const [selector, name] of [['img[src]', 'src'], ['input[type="image"][src]', 'src'], ['link[rel~="stylesheet"][href]', 'href'], ['link[rel~="icon"][href]', 'href'], ['[background]', 'background'], ['video[poster]', 'poster']] as const) {
    for (const node of nodes(selector)) { const next = swap(node.getAttribute(name)); if (next) node.setAttribute(name, next); }
  }
  for (const node of nodes('img[srcset], source[srcset]')) {
    const value = node.getAttribute('srcset') || '';
    node.setAttribute('srcset', value.split(',').map((part) => { const [url, ...size] = part.trim().split(/\s+/); return [swap(url) || url, ...size].join(' '); }).join(', '));
  }
  for (const node of nodes('[style]')) { const style = node.getAttribute('style') || ''; if (/url\(/i.test(style)) node.setAttribute('style', proxyCssUrls(style, pageUrl, proxy)); }
  for (const node of nodes('style')) { if (/url\(|@import/i.test(node.textContent || '')) node.textContent = proxyCssUrls(node.textContent || '', pageUrl, proxy); }
}

/** /page-asset/<서명>?u=<http 주소>: 서명이 맞는 공개 http 그림·스타일만 받는다. */
export async function servePageAsset(request: Request, env: Pick<Env, 'X_SETTINGS_SECRET'>): Promise<Response> {
  const fail = (status: number) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'GET') return fail(405);
  const key = assetKey(env), url = new URL(request.url), target = url.searchParams.get('u') || '';
  const given = Buffer.from(url.pathname.slice(ASSET_PATH.length)), expected = key && Buffer.from(sign(key, target));
  if (!expected || given.length !== expected.length || !timingSafeEqual(given, expected) || !/^http:\/\//i.test(target)) return fail(403);
  return fetchHttpAsset(target, env, url.origin);
}

/** 공개 http 그림·스타일 하나를 받아 앱 출처에서 돌려준다. 스타일 안의 주소도 대신 받는 주소로 바꾼다. */
async function fetchHttpAsset(target: string, env: Pick<Env, 'X_SETTINGS_SECRET'>, origin: string, only = TYPES): Promise<Response> {
  const fail = (status: number) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
  let current = target;
  try {
    for (let hop = 0; hop < 4; hop++) {
      current = publicPageUrl(current);
      const response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FeedEx/1.0)', Accept: 'image/*,text/css;q=0.9,*/*;q=0.5' } });
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) { await response.body?.cancel(); current = new URL(location, current).href; continue; }
      const type = (response.headers.get('content-type') || '').split(';')[0].trim();
      if (!response.ok || !only.test(type) || Number(response.headers.get('content-length') || 0) > MAX_BYTES) { await response.body?.cancel(); return fail(response.ok ? 415 : 502); }
      const body = await readLimited(response);
      if (!body) return fail(413);
      const headers = {
        'Content-Type': type, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-origin',
        // 이 주소를 직접 열어도 SVG 안의 스크립트가 앱 출처에서 돌지 않는다.
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
      };
      if (/^text\/css$/i.test(type)) {
        const proxy = pageAssetProxy(env, origin);
        const css = new TextDecoder().decode(body);
        return new Response(proxy ? proxyCssUrls(css, current, proxy) : css, { headers: { ...headers, 'Content-Type': 'text/css; charset=utf-8' } });
      }
      return new Response(body, { headers });
    }
    return fail(508);
  } catch { return fail(502); }
}

/**
 * /article-image/<글 id>: 저장된 글 썸네일이 http 주소면 대신 받아 준다. https 앱의 글 목록은 http 그림을 막는다.
 * 주소는 저장된 값에서만 꺼내므로 서명이 필요 없고, 그림만 돌려준다.
 */
export async function serveArticleImage(request: Request, env: Pick<Env, 'X_SETTINGS_SECRET' | 'DB'>): Promise<Response> {
  const url = new URL(request.url), id = decodeURIComponent(url.pathname.slice(ARTICLE_IMAGE_PATH.length));
  if (request.method !== 'GET' || !/^[\w-]{1,80}$/.test(id)) return new Response(null, { status: 404 });
  const row = await env.DB.prepare('SELECT thumbnail_url FROM articles WHERE id=?').bind(id).first<{ thumbnail_url: string | null }>();
  if (!row?.thumbnail_url || !/^http:\/\//i.test(row.thumbnail_url)) return new Response(null, { status: 404 });
  return fetchHttpAsset(row.thumbnail_url, env, url.origin, IMAGES);
}

async function readLimited(response: Response): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
