import { youtubeEmbedSrc, youtubeStartSeconds, youtubeVideoId } from './youtubeEmbed';
import { t } from './i18n';

const common = ['class', 'title', 'lang', 'dir'];
const lazySrc = ['data-src', 'data-lazy-src', 'data-original', 'data-original-src', 'data-actualsrc', 'data-lazy'];
const lazySet = ['data-srcset', 'data-lazy-srcset'];
const attrs: Record<string, string[]> = {
  a: ['href'], img: ['src', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading', ...lazySrc, ...lazySet],
  source: ['src', 'srcset', 'sizes', 'media', 'type', ...lazySet],
  video: ['src', 'width', 'height', 'poster', 'controls', 'preload', 'playsinline', 'muted', 'loop'],
  audio: ['src', 'controls', 'preload', 'muted', 'loop'],
  iframe: ['src', 'data-src', 'data-lazy-src', 'width', 'height'],
  td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan', 'scope'], time: ['datetime'], ol: ['start', 'reversed'], li: ['value'],
};

export const articleTags = ['a', 'abbr', 'article', 'aside', 'audio', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'dd',
  'del', 'details', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
  'i', 'iframe', 'img', 'kbd', 'li', 'mark', 'ol', 'p', 'picture', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp',
  'section', 'small', 'source', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'time', 'tr', 'u', 'ul', 'var', 'video', 'wbr'];

export const articleInputAttributes = { '*': common, ...attrs };
export const articleAllAttributes = [...new Set(Object.values(articleInputAttributes).flat())];

function safeUrl(value: string, base?: string, link = false) {
  if (!value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value, base);
    if (link && url.protocol === 'mailto:') return url.href;
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

export function articleAttribute(tag: string, name: string, value: string, base?: string): string | null {
  if (!common.includes(name) && !attrs[tag]?.includes(name)) return null;
  if (name === 'href') return safeUrl(value, base, true);
  if (['src', 'poster', ...lazySrc].includes(name)) {
    // YouTube 이외의 iframe에는 주소를 남기지 않는다.
    if (tag === 'iframe') {
      const id = youtubeVideoId(value, base);
      return id ? youtubeEmbedSrc(id, youtubeStartSeconds(value, base)) : null;
    }
    return safeUrl(value, base);
  }
  if (name === 'srcset' || lazySet.includes(name)) {
    const choices = value.split(',').flatMap(choice => {
      const [raw, descriptor, ...rest] = choice.trim().split(/\s+/);
      const url = safeUrl(raw, base);
      if (!url || rest.length || (descriptor && !/^(?:\d+w|\d+(?:\.\d+)?x)$/.test(descriptor))) return [];
      return [descriptor ? `${url} ${descriptor}` : url];
    });
    return choices.length ? choices.join(', ') : null;
  }
  if (['width', 'height', 'rowspan', 'colspan'].includes(name)) return /^\d{1,5}$/.test(value) ? value : null;
  return value;
}

export function articleYoutube(input: Record<string, string>, base?: string) {
  const src = input.src || input['data-src'] || input['data-lazy-src'];
  const url = src && articleAttribute('iframe', 'src', src, base);
  return url ? { src: url, title: input.title || t('YouTube 동영상', 'YouTube video'), width: '560', height: '315', loading: 'lazy',
    referrerpolicy: 'strict-origin-when-cross-origin', allow: 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture', allowfullscreen: '' } : null;
}
