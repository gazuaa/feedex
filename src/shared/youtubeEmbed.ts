const YOUTUBE_ID = /^[\w-]{11}$/;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** YouTube 임베드·공유 주소에서 11자리 영상 ID를 뽑는다. 허용된 YouTube 호스트가 아니면 null. */
export function youtubeVideoId(rawUrl: string | null | undefined, baseUrl = 'https://www.youtube.com'): string | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl.trim(), baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0] || '';
      return YOUTUBE_ID.test(id) ? id : null;
    }
    if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'youtube-nocookie.com') return null;
    const embedMatch = /^\/(?:embed|v|shorts)\/([\w-]{11})(?:\/|$)/.exec(url.pathname);
    if (embedMatch) return embedMatch[1];
    if (url.pathname === '/watch') {
      const v = url.searchParams.get('v') || '';
      return YOUTUBE_ID.test(v) ? v : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** YouTube 주소의 시작 시각(초)을 뽑는다. */
export function youtubeStartSeconds(rawUrl: string | null | undefined, baseUrl = 'https://www.youtube.com'): number {
  if (!rawUrl) return 0;
  try {
    const url = new URL(rawUrl.trim(), baseUrl);
    const raw = url.searchParams.get('start') || url.searchParams.get('t') || '';
    const match = /^(\d+)s?$/i.exec(raw.trim());
    const seconds = match ? Number(match[1]) : 0;
    return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : 0;
  } catch {
    return 0;
  }
}

/** 깨끗한 표준 YouTube 임베드 주소를 만든다. 원문 사이트의 origin/widget_referrer 제한 변수는 뺀다. */
export function youtubeEmbedSrc(id: string, start = 0, autoplay = false): string {
  const params = new URLSearchParams();
  if (autoplay) params.set('autoplay', '1');
  if (start > 0) params.set('start', String(start));
  params.set('rel', '0');
  const query = params.toString();
  return `https://www.youtube.com/embed/${encodeURIComponent(id)}${query ? `?${query}` : ''}`;
}

function iframeRawSrc(node: { getAttribute(name: string): string | null }): string | null {
  return node.getAttribute('src') || node.getAttribute('data-src') || node.getAttribute('data-lazy-src');
}

/**
 * 리더 보기용: 문서 안의 iframe 가운데 공개 YouTube 임베드만 표준 iframe으로 남기고
 * 나머지 iframe은 모두 지운다.
 */
export function preserveYouTubeIframes(
  root: { querySelectorAll(selector: string): Iterable<{ getAttribute(name: string): string | null; setAttribute(name: string, value: string): void; removeAttribute(name: string): void; attributes: ArrayLike<{ name: string }>; remove(): void }> },
  baseUrl = 'https://www.youtube.com'
): void {
  for (const node of [...root.querySelectorAll('iframe')]) {
    const raw = iframeRawSrc(node);
    const id = youtubeVideoId(raw, baseUrl);
    if (!id) {
      node.remove();
      continue;
    }
    const start = youtubeStartSeconds(raw, baseUrl);
    const title = (node.getAttribute('title') || '').trim() || 'YouTube 동영상';
    for (const { name } of Array.from(node.attributes)) node.removeAttribute(name);
    node.setAttribute('src', youtubeEmbedSrc(id, start));
    node.setAttribute('title', title);
    node.setAttribute('width', '560');
    node.setAttribute('height', '315');
    node.setAttribute('loading', 'lazy');
    node.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    node.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
    node.setAttribute('allowfullscreen', '');
  }
}

/**
 * 피드/리더 HTML 문자열 정리용: YouTube 임베드 iframe만 안전한 표준 마크업으로 남기고
 * 다른 모든 iframe은 제거한다.
 */
export function sanitizeYouTubeIframesInHtml(html: string, baseUrl = 'https://www.youtube.com'): string {
  if (!html) return '';
  return html.replace(/<iframe\b([^>]*)>[\s\S]*?<\/iframe>/gi, (_full, attrs: string) => {
    const attr = (name: string) => {
      const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
      return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').replace(/&amp;/gi, '&').trim();
    };
    const raw = attr('src') || attr('data-src') || attr('data-lazy-src');
    const id = youtubeVideoId(raw, baseUrl);
    if (!id) return '';
    const start = youtubeStartSeconds(raw, baseUrl);
    const title = escapeHtml(attr('title') || 'YouTube 동영상');
    return `<iframe src="${escapeHtml(youtubeEmbedSrc(id, start))}" title="${title}" width="560" height="315" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
  });
}

/**
 * 웹 보기 사본(srcDoc 샌드박스)용: allow-same-origin이 없는 샌드박스 안에서 중첩 iframe은
 * 출처가 null이 되어 YouTube 플레이어가 막히므로, 본문 제자리에는 썸네일과 재생 버튼 카드를 그리고
 * 누르면 상위 리더 프레임이 그 자리에서 바로 재생한다.
 */
export function replaceYouTubeIframesWithCards(
  document: { createElement(tag: string): { setAttribute(name: string, value: string): void; innerHTML: string }; querySelectorAll(selector: string): Iterable<{ getAttribute(name: string): string | null; replaceWith(node: unknown): void }> },
  baseUrl = 'https://www.youtube.com'
): void {
  for (const node of [...document.querySelectorAll('iframe')]) {
    const raw = iframeRawSrc(node);
    const id = youtubeVideoId(raw, baseUrl);
    if (!id) continue;
    const start = youtubeStartSeconds(raw, baseUrl);
    const title = (node.getAttribute('title') || '').trim() || 'YouTube 동영상';
    const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}${start > 0 ? `&t=${start}s` : ''}`;
    const card = document.createElement('a');
    card.setAttribute('class', 'sfeed-yt-embed');
    card.setAttribute('data-yt-id', id);
    if (start > 0) card.setAttribute('data-yt-start', String(start));
    card.setAttribute('href', watchUrl);
    card.setAttribute('target', '_blank');
    card.setAttribute('rel', 'noopener noreferrer');
    card.setAttribute('title', title);
    card.setAttribute(
      'style',
      'position:relative;display:block;width:100%;max-width:560px;aspect-ratio:16/9;margin:10px 0;border-radius:12px;overflow:hidden;background:#000;color:#fff;text-decoration:none;box-shadow:0 2px 10px rgba(0,0,0,.18)'
    );
    card.innerHTML =
      `<img src="https://i.ytimg.com/vi/${escapeHtml(id)}/hqdefault.jpg" alt="${escapeHtml(title)}" loading="lazy" style="width:100%!important;height:100%!important;max-width:none!important;object-fit:cover!important;display:block!important;margin:0!important;border:0!important">` +
      `<svg aria-hidden="true" viewBox="0 0 68 48" width="68" height="48" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:68px!important;height:48px!important;pointer-events:none;filter:drop-shadow(0 4px 10px rgba(0,0,0,.45))"><path d="M66.52 7.74c-.78-2.93-2.49-5.41-5.42-6.19C55.79.13 34 0 34 0S12.21.13 6.9 1.55c-2.93.78-4.63 3.26-5.42 6.19C.06 13.05 0 24 0 24s.06 10.95 1.48 16.26c.78 2.93 2.49 5.41 5.42 6.19C12.21 47.87 34 48 34 48s21.79-.13 27.1-1.55c2.93-.78 4.64-3.26 5.42-6.19C67.94 34.95 68 24 68 24s-.06-10.95-1.48-16.26z" fill="#ff0000"/><path d="M45 24 27 14v20" fill="#fff"/></svg>` +
      `<span style="position:absolute;left:10px;bottom:10px;padding:4px 10px;border-radius:999px;background:rgba(15,23,42,.82);color:#fff;font:600 12px/1.3 -apple-system,BlinkMacSystemFont,sans-serif;pointer-events:none">▶ YouTube 동영상 재생</span>`;
    node.replaceWith(card);
  }
}
