// 기사 페이지의 대표 이미지(og:image, twitter:image 또는 <link rel="image_src">).
// 자체 이미지가 없는 피드에 쓴다.

const PATTERNS = [
  /<meta[^>]+(?:property|name)=["']og:image(?::secure_url|:url)?["'][^>]*content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']og:image(?::secure_url|:url)?["']/i,
  /<meta[^>]+(?:property|name)=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["']/i,
  /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']twitter:image(?::src)?["']/i,
  /<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i,
];

export function extractPreviewImage(html: string, pageUrl: string): string | null {
  for (const pattern of PATTERNS) {
    const raw = html.match(pattern)?.[1]?.trim().replace(/&amp;/g, '&');
    if (!raw) continue;
    try {
      const url = new URL(raw, pageUrl);
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
    } catch {
      // 잘못된 주소: 다음 태그를 시도한다
    }
  }
  return null;
}

/**
 * 페이지에서 직접 이미지를 찾는다. 페이지가 답했지만 이미지가 없거나(또는 사라졌으면)
 * null을, 닿지 못했으면 undefined를 돌려줘서 호출하는 쪽이 확정 답만 기억하게 한다.
 */
export async function fetchPreviewImage(pageUrl: string): Promise<string | null | undefined> {
  try {
    const res = await fetch(pageUrl, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SfeedReader/1.0)' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      await res.body?.cancel();
      return res.status === 404 || res.status === 410 ? null : undefined;
    }
    if (res.headers.get('x-vercel-mitigated') === 'challenge' || res.headers.get('cf-mitigated') === 'challenge') { await res.body?.cancel(); return undefined; }
    // 태그는 <head>에 있으므로 페이지 앞부분만 보면 된다.
    const reader = res.body?.getReader(); if (!reader) return null;
    const decoder = new TextDecoder(); let html = '', bytes = 0;
    try {
      while (bytes < 300_000) {
        const chunk = await reader.read(); if (chunk.done) break;
        const part = chunk.value.subarray(0, 300_000 - bytes); bytes += part.byteLength;
        html += decoder.decode(part, { stream: true });
        if (/<\/head\s*>/i.test(html)) break;
      }
      html += decoder.decode();
    } finally { await reader.cancel().catch(() => {}); }
    if (/<title[^>]*>\s*(?:Vercel Security Checkpoint|Just a moment|Access Denied|Verify you are human)/i.test(html)) return undefined;
    return extractPreviewImage(html, res.url || pageUrl);
  } catch {
    return undefined;
  }
}
