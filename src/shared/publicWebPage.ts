// 서버 요청을 막는 언론사의 공개 기사 페이지만 기기 렌더러를 쓸 수 있다.
// 계정 주소, 토큰, 쿠키는 절대 넘기지 않는다.
const DEVICE_SITES = [
  // CoinDesk 글 주소는 모양이 여럿이다: /markets/2026/10/26/slug, /es/policy/2022/10/21/slug,
  // /layer2/privacyweek/2022/01/24/slug, /learn/slug, /podcasts/show/episode. 제목에는 밑줄도
  // 들어간다(op_return). 그래서 두 단계 이상인 공개 페이지는 모두 받고, 계정·로그인 쪽 주소만 뺀다.
  { host: 'www.coindesk.com', hosts: ['www.coindesk.com', 'coindesk.com'], path: /^(?!\/(?:auth|account|accounts|login|logout|signin|sign-in|signup|sign-up|register|profile|settings|subscribe|subscription|subscriptions|checkout|billing|api|arc|_next)(?:\/|$))(?:\/[a-z0-9][a-z0-9_-]*){2,8}\/?$/i },
  { host: 'www.theblock.co', hosts: ['www.theblock.co', 'theblock.co'], path: /^\/(?:news\/[a-z0-9-]+\/\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9_-]*|post\/\d+(?:\/[a-z0-9][a-z0-9_-]*)?)\/?$/i },
];
function publicArticle(value: string, sites = DEVICE_SITES): string | null {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.port || !/^https?:$/.test(url.protocol)) return null;
    // 피드가 주소를 이어 붙이다 생긴 겹친 슬래시(//2021/08/30/slug)는 하나로 정리한다.
    const path = url.pathname.replace(/\/{2,}/g, '/');
    const site = sites.find((item) => item.hosts.includes(url.hostname) && item.path.test(path));
    return site ? `https://${site.host}${path}` : null;
  } catch { return null; }
}
export const publicDeviceArticle = (value: string) => publicArticle(value);
export const publicCoinDeskArticle = (value: string) => publicArticle(value, DEVICE_SITES.slice(0, 1));
export interface PublicPage { html: string; url: string }
export interface PublicPageOptions { timeoutMs?: number }
const MAX_HTML_BYTES = 2_000_000;

async function fetchPublicResponse(value: string, options: PublicPageOptions, format: 'html' | 'content') {
  const url = publicDeviceArticle(value); if (!url) return null;
  if (options.timeoutMs !== undefined && options.timeoutMs <= 0) throw new Error('웹 사본 응답이 늦어지고 있습니다. 다시 시도해 주세요.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(options.timeoutMs ?? 20000, 20000));
  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      redirect: 'manual', credentials: 'omit', signal: controller.signal,
      // 캐시를 건너뛰는 요청(X-No-Cache)은 매번 원문 사이트에 새로 가서 요청 제한에 다시 걸리므로 보내지 않는다.
      headers: { Accept: 'application/json', ...(format === 'html' ? { 'X-Return-Format': 'html', 'X-Timeout': '15' } : {}) },
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`공개 웹 사본 응답 오류 (HTTP ${response.status})`); }
    const reader = response.body?.getReader(); if (!reader) throw new Error('공개 웹 사본이 비어 있습니다.');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value: chunk } = await reader.read(); if (done) break;
        size += chunk.byteLength;
        if (size > MAX_HTML_BYTES) throw new Error('공개 웹 사본이 너무 큽니다.');
        chunks.push(chunk);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { body: new TextDecoder().decode(bytes), url };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('웹 사본 응답이 늦어지고 있습니다. 다시 시도해 주세요.');
    if (error instanceof TypeError) throw new Error('웹 사본에 연결하지 못했습니다. 연결 상태를 확인해 주세요.');
    throw error;
  } finally { clearTimeout(timer); }
}

interface RenderedData { html?: string; content?: string; title?: string; url?: string; finalUrl?: string }
function renderedResponse(body: string, requested: string): { data: RenderedData; url: string } {
  let envelope: { code?: number; data?: RenderedData };
  try { envelope = JSON.parse(body); } catch { throw new Error('원본 HTML 형식이 아닙니다.'); }
  if (!envelope || !envelope.data || typeof envelope.data !== 'object') throw new Error('웹 사본 HTML이 비어 있습니다.');
  if (Number(envelope.code) >= 400) throw new Error(`공개 웹 사본 응답 오류 (HTTP ${envelope.code})`);
  const data = envelope.data;
  if (data.url && publicDeviceArticle(data.url)?.replace(/\/$/, '') !== requested.replace(/\/$/, '')) throw new Error('요청한 기사의 응답이 아닙니다.');
  const url = publicDeviceArticle(data.finalUrl || requested);
  if (!url || new URL(url).origin !== new URL(requested).origin) throw new Error('허용되지 않은 기사 이동 주소입니다.');
  return { data, url };
}

export async function fetchPublicWebPage(value: string, options: PublicPageOptions = {}): Promise<PublicPage | null> {
  const response = await fetchPublicResponse(value, options, 'html'); if (!response) return null;
  let html = response.body, url = response.url;
  if (html.trimStart().startsWith('{')) {
    const rendered = renderedResponse(html, url);
    if (typeof rendered.data.html !== 'string') throw new Error('웹 사본 HTML이 비어 있습니다.');
    html = rendered.data.html; url = rendered.url;
  }
  if (!/^\s*(?:<!doctype\s+html[^>]*>\s*)?<html[\s>]/i.test(html)) throw new Error('원본 HTML 형식이 아닙니다.');
  return { html, url };
}

export interface PublicContent { title: string; markdown: string; url: string }
/**
 * 본문 형식(마크다운). 리더 서비스는 이 요청을 실제 브라우저로 그려서, 원문 사이트가 HTML 요청을 잠시
 * 막을 때도 기사를 받는 경우가 많다. 그린 결과는 리더 서비스 캐시에 남아 뒤이은 HTML 요청에도 쓰인다.
 * 보안 확인·로그인 화면이거나 본문이 너무 짧으면 null.
 */
export async function preparePublicWebPage(value: string, options: PublicPageOptions = {}): Promise<PublicContent | null> {
  const response = await fetchPublicResponse(value, options, 'content'); if (!response) return null;
  const { data, url } = renderedResponse(response.body, response.url);
  if (typeof data.content !== 'string' || data.content.trim().length <= 200) return null;
  if (/security checkpoint|just a moment|verify you are human|access denied|sign in|log in/i.test(data.title || '')) return null;
  return { title: data.title || '', markdown: data.content, url };
}
