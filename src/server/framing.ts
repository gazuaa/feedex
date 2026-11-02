// 웹 보기 지원: 원문 페이지를 SFeed 리더 영역 안에 보여 줘도 되는지 판단한다.
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
}

export async function checkEmbeddable(url: string, appOrigin: string): Promise<EmbedCheck> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SfeedReader/1.0)' },
      signal: AbortSignal.timeout(6000),
    });
    await res.body?.cancel();
    const finalUrl = res.url || url;
    // 봇 확인 화면은 페이지 자체 헤더를 가리고, 프레임 안에서는 서드파티 쿠키 없이
    // 끝낼 수 없다: 새 창에서 연다.
    if (res.headers.get('x-vercel-mitigated') === 'challenge' || res.headers.get('cf-mitigated') === 'challenge') {
      return { embeddable: false, url: finalUrl, reason: 'challenge' };
    }
    if (!res.ok) return { embeddable: false, url: finalUrl, reason: 'http' };
    // https 앱은 일반 http 페이지를 프레임에 넣을 수 없다 (혼합 콘텐츠).
    const secureEnough = finalUrl.startsWith('https:') || appOrigin.startsWith('http:');
    if (!secureEnough) return { embeddable: false, url: finalUrl, reason: 'mixed-content' };
    const blocked = framingBlocked(res.headers, appOrigin);
    return { embeddable: !blocked, url: finalUrl, ...(blocked ? { reason: 'framing' as const } : {}) };
  } catch {
    // 서버에서 닿지 않는다 (Cloudflare를 막는 사이트가 있다): 브라우저가 시도하게 둔다.
    return { embeddable: true, url: appOrigin.startsWith('https:') ? url.replace(/^http:/, 'https:') : url };
  }
}
