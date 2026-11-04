// 웹 보기 지원: 원문 페이지를 FeedEx 리더 영역 안에 보여 줘도 되는지 판단한다.
// 사이트는 X-Frame-Options나 CSP frame-ancestors로 거부할 수 있고, 그러면 브라우저가
// 앱이 알아챌 수 없는 오류 페이지를 그린다. 그래서 헤더를 미리 확인하고 대신
// "새 창에서 열기"를 권한다.

export function framingBlocked(headers: Headers, appOrigin: string): boolean {
  const xfo = (headers.get('x-frame-options') || '').toLowerCase();
  if (xfo.includes('deny') || xfo.includes('sameorigin')) return true;

  const csp = (headers.get('content-security-policy') || '').toLowerCase();
  const match = /(?:^|;)\s*frame-ancestors\s+([^;]*)/.exec(csp);
  if (!match) return false;

  const app = new URL(appOrigin);
  return !match[1]
    .trim()
    .split(/\s+/)
    .some((source) => {
      if (source === '*' || source === `${app.protocol}`) return true;
      const host = source.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '');
      if (host === app.host) return true;
      return host.startsWith('*.') && app.host.endsWith(host.slice(1));
    });
}

export interface EmbedCheck {
  embeddable: boolean;
  url: string;
  reason?: 'challenge' | 'framing' | 'http' | 'mixed-content';
  /** 사이트가 viewport로 밝힌 고정 폭(px). 칸이 더 좁으면 기기가 그 폭으로 배치해 줄인다. */
  layoutWidth?: number;
}

/** `<meta name="viewport" content="width=1080">`처럼 숫자로 밝힌 폭. `device-width`면 스스로 맞추는 사이트라 없다. */
export function declaredLayoutWidth(html: string): number | undefined {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (!/\bname\s*=\s*["']?viewport\b/i.test(tag)) continue;
    const width = Number(/\bcontent\s*=\s*["'][^"']*\bwidth\s*=\s*(\d{3,4})\b/i.exec(tag)?.[1]);
    return width >= 480 && width <= 2560 ? width : undefined;
  }
  return undefined;
}

// 메타 태그는 문서 앞쪽에 있다. 본문 전체를 받지 않고 앞부분만 읽는다.
async function pageHead(res: Response, limit = 262_144): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '', size = 0;
  try {
    while (size < limit && !/<\/head\s*>/i.test(text)) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
  } catch { /* 앞부분을 못 읽어도 프레임 판단에는 영향이 없다. */ }
  await reader.cancel().catch(() => {});
  return text;
}

export async function checkEmbeddable(url: string, appOrigin: string): Promise<EmbedCheck> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FeedExReader/1.0)' },
      signal: AbortSignal.timeout(6000),
    });
    const finalUrl = res.url || url;
    // 봇 확인 화면은 페이지 자체 헤더를 가리고, 프레임 안에서는 서드파티 쿠키 없이
    // 끝낼 수 없다: 새 창에서 연다.
    if (res.headers.get('x-vercel-mitigated') === 'challenge' || res.headers.get('cf-mitigated') === 'challenge') {
      await res.body?.cancel();
      return { embeddable: false, url: finalUrl, reason: 'challenge' };
    }
    if (!res.ok) { await res.body?.cancel(); return { embeddable: false, url: finalUrl, reason: 'http' }; }
    // https 앱은 일반 http 페이지를 프레임에 넣을 수 없다 (혼합 콘텐츠).
    const secureEnough = finalUrl.startsWith('https:') || appOrigin.startsWith('http:');
    if (!secureEnough) { await res.body?.cancel(); return { embeddable: false, url: finalUrl, reason: 'mixed-content' }; }
    if (framingBlocked(res.headers, appOrigin)) { await res.body?.cancel(); return { embeddable: false, url: finalUrl, reason: 'framing' }; }
    const layoutWidth = declaredLayoutWidth(await pageHead(res));
    return { embeddable: true, url: finalUrl, ...(layoutWidth ? { layoutWidth } : {}) };
  } catch {
    // 서버에서 닿지 않는다 (Cloudflare를 막는 사이트가 있다): 브라우저가 시도하게 둔다.
    return { embeddable: true, url: appOrigin.startsWith('https:') ? url.replace(/^http:/, 'https:') : url };
  }
}
