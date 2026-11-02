// Only public article pages of publishers that turn server requests away (CoinDesk's
// Vercel check, The Block's Cloudflare check) can use the device-side HTML renderer.
// Never send account URLs, credentials, query tokens or browser cookies to it.
const DEVICE_SITES = [
  { host: 'www.coindesk.com', hosts: ['www.coindesk.com', 'coindesk.com'], path: /^\/(?:markets|business|tech|technology|policy|opinion|finance|consensus-magazine|coindesk-indices|daybook-us|learn|research)\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9][a-z0-9-]*\/?$/i },
  // /news/business/2026-10-29-utah-criminal-charges-kalshi-432104, and older /post/123456/slug.
  { host: 'www.theblock.co', hosts: ['www.theblock.co', 'theblock.co'], path: /^\/(?:news\/[a-z0-9-]+\/\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*|post\/\d+(?:\/[a-z0-9][a-z0-9-]*)?)\/?$/i },
];
function publicArticle(value: string, sites = DEVICE_SITES): string | null {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.port || !/^https?:$/.test(url.protocol)) return null;
    const site = sites.find((item) => item.hosts.includes(url.hostname) && item.path.test(url.pathname));
    return site ? `https://${site.host}${url.pathname}` : null;
  } catch { return null; }
}
/** A public article on one of the sites whose pages the device prepares. */
export const publicDeviceArticle = (value: string) => publicArticle(value);
export const publicCoinDeskArticle = (value: string) => publicArticle(value, DEVICE_SITES.slice(0, 1));
export interface PublicPage { html: string; url: string }
const MAX_HTML_BYTES = 2_000_000;
export async function fetchPublicWebPage(value: string, options: { fresh?: boolean } = {}): Promise<PublicPage | null> {
  const url = publicDeviceArticle(value); if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      redirect: 'manual', credentials: 'omit', signal: controller.signal,
      // The renderer can report an intermediate 302 even after rendering the
      // complete article. Validate the returned HTML instead of asserting 200.
      headers: { Accept: 'text/plain', 'X-Return-Format': 'html', 'X-Timeout': '15', ...(options.fresh ? { 'X-No-Cache': 'true' } : {}) },
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
    const html = new TextDecoder().decode(bytes);
    if (!/^\s*(?:<!doctype\s+html[^>]*>\s*)?<html[\s>]/i.test(html)) throw new Error('원본 HTML 형식이 아닙니다.');
    return { html, url };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('웹 사본 응답이 늦어지고 있습니다. 다시 시도해 주세요.');
    if (error instanceof TypeError) throw new Error('웹 사본에 연결하지 못했습니다. 연결 상태를 확인해 주세요.');
    throw error;
  } finally { clearTimeout(timer); }
}
