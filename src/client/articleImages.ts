import { revealLazyImages } from '../shared/lazyImages';
import { dropEmptySlots } from '../shared/emptySlots';
import { plainCopyStyles } from '../shared/copyStyles';
import { dropSidebars } from '../shared/sidebars';
import { dropConsentBanners } from '../shared/consentBanners';
import { openPhotoViewer } from './xPostFrame';

// 크기 변형을 뺀 그림 이름. photo_T1.jpg와 photo_P1.jpg,
// photo-300x200.jpg와 photo.jpg는 같은 그림이다.
function imageStem(url: string) {
  try {
    const parsed = new URL(url, 'https://sfeed.invalid');
    const name = decodeURIComponent(parsed.pathname.split('/').pop() || '').toLowerCase();
    const stem = name.replace(/\.[a-z0-9]{2,5}$/, '').replace(/@\dx$/, '').replace(/(?:[-_](?:\d+x\d+|[a-z]\d{1,2}|thumb(?:nail)?|small|medium|large|scaled|cropped|resized))+$/, '');
    if (/^(?:hq|mq|sd|maxres)default$/.test(stem)) return parsed.pathname.toLowerCase();
    return stem;
  } catch { return ''; }
}

/** 본문이 대표 이미지를 이미 보여 주는지. 크기가 달라도 같은 그림이면 보여 주는 것으로 본다. */
export function bodyShowsImage(html: string, url: string) {
  if (html.includes(url)) return true;
  const stem = imageStem(url);
  if (stem.length < 8) return false;
  for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) {
    for (const [, value] of tag.matchAll(/\s(?:src|data-src|data-lazy-src|data-original)\s*=\s*["']([^"']+)["']/gi)) if (imageStem(value) === stem) return true;
  }
  return false;
}

/**
 * 어떤 피드는 기사 사진으로 시작하고 아래에서 캡션 달린 figure로 같은 사진을 되풀이한다.
 * 그림은 한 번만 보여 주고, 캡션이 있는 쪽을 남긴다.
 */
export function dropRepeatedImages(root: ParentNode) {
  const seen = new Map<string, Element>();
  const captioned = (img: Element) => Boolean(img.closest('figure'));
  const drop = (img: Element) => {
    let node: Element = img.closest('figure') || img;
    while (node.parentElement && /^(?:P|A|DIV|SPAN|PICTURE)$/.test(node.parentElement.tagName) && node.parentElement.children.length === 1 && !node.parentElement.textContent?.trim()) node = node.parentElement;
    node.remove();
  };
  for (const img of Array.from(root.querySelectorAll('img[src]'))) {
    const src = img.getAttribute('src') || '', stem = imageStem(src);
    const key = stem.length >= 8 ? stem : src;
    const earlier = seen.get(key);
    if (!earlier) { seen.set(key, img); continue; }
    if (!captioned(earlier) && captioned(img)) { drop(earlier); seen.set(key, img); } else drop(img);
  }
}

/**
 * 서버에서 지연 이미지를 드러내기 전에 저장된 본문에는 아직 빈 대체 이미지가 있어서,
 * 화면에 그린 본문에도 같은 보정을 한다. 불러오지 못했거나 1픽셀짜리로 밝혀진 이미지는
 * 빈자리로 두지 않고 숨긴다.
 */
export function bindArticleImages(container: HTMLElement, base: string) {
  revealLazyImages(container, base);
  dropRepeatedImages(container);
  const hide = (event: Event) => {
    const img = event.target;
    if (img instanceof HTMLImageElement && (event.type === 'error' || (img.naturalWidth <= 2 && img.naturalHeight <= 2))) img.style.display = 'none';
  };
  const isViewablePhoto = (img: HTMLImageElement) => {
    const src = img.currentSrc || img.src;
    if (!/^https?:\/\//i.test(src) || img.style.display === 'none') return false;
    const link = img.closest('a[href]') as HTMLAnchorElement | null;
    if (!link) return true;
    return /^https:\/\/pbs\.twimg\.com\/media\//i.test(link.href) || /\.(?:jpe?g|png|gif|webp|avif)(?:[?#]|$)/i.test(link.href);
  };
  const photoUrlOf = (img: HTMLImageElement) => {
    const link = img.closest('a[href]') as HTMLAnchorElement | null;
    if (link && (/^https:\/\/pbs\.twimg\.com\/media\//i.test(link.href) || /\.(?:jpe?g|png|gif|webp|avif)(?:[?#]|$)/i.test(link.href))) return link.href;
    return img.currentSrc || img.src;
  };
  let closePhoto: (() => void) | undefined;
  const onClick = (event: MouseEvent) => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target.closest('img') : null;
    if (!(target instanceof HTMLImageElement) || !isViewablePhoto(target)) return;
    event.preventDefault();
    event.stopPropagation();
    const all = Array.from(container.querySelectorAll('img')).filter(isViewablePhoto);
    closePhoto?.(); closePhoto = openPhotoViewer(all.map(photoUrlOf), Math.max(0, all.indexOf(target)));
  };
  container.addEventListener('error', hide, true);
  container.addEventListener('load', hide, true);
  container.addEventListener('click', onClick);
  return () => {
    container.removeEventListener('error', hide, true);
    container.removeEventListener('load', hide, true);
    container.removeEventListener('click', onClick);
    closePhoto?.();
  };
}

/** 저장된 웹 사본에도 같은 보정을 한다. 사본은 앱이 손댈 수 없는 샌드박스에서 그려진다. */
export function revealCopyImages(html: string) {
  if (typeof DOMParser === 'undefined' || !/<img|<source|height|crossorigin|integrity|<aside|complementary|sidebar|dialog|onetrust|consent|cookie/i.test(html)) return html;
  const document = new DOMParser().parseFromString(html, 'text/html');
  revealLazyImages(document);
  dropEmptySlots(document);
  dropConsentBanners(document);
  dropSidebars(document);
  plainCopyStyles(document);
  return '<!doctype html>' + document.documentElement.outerHTML;
}
