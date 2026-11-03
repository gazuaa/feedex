const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** 공개 X 영상 서버의 MP4·HLS 주소만 재생한다. */
export function xVideoSource(value: string | null | undefined): string | null {
  try {
    const url = new URL(value || '');
    return url.protocol === 'https:' && url.hostname === 'video.twimg.com' && !url.username && !url.password && !url.port && /\.(mp4|m3u8)$/i.test(url.pathname) ? url.href : null;
  } catch { return null; }
}
export function xVideoHtml(source: string | null, poster: string | null, href: string, gif = false): string {
  const safe = xVideoSource(source), image = poster ? ` poster="${escape(poster)}"` : '';
  if (safe && /\.mp4(?:\?|$)/i.test(safe)) return `<video src="${escape(safe)}"${image} ${gif ? 'autoplay muted loop' : 'controls preload="none"'} playsinline></video>`;
  if (safe) return `<div class="video-player"><video data-hls-src="${escape(safe)}"${image} controls preload="none" playsinline></video><button type="button" class="video-play">▶ 동영상 재생</button><a class="video-fallback" data-x-external href="${escape(href)}">X에서 열기</a></div>`;
  return poster ? `<a class="photo video" href="${escape(href)}"><img src="${escape(poster)}" alt="" loading="lazy"><span>동영상 열기</span></a>` : '';
}
