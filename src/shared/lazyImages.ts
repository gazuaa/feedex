interface ImageNode {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  remove(): void;
}
interface ImageRoot { querySelectorAll(selector: string): Iterable<ImageNode> }

const LAZY_SOURCES = ['data-src', 'data-lazy-src', 'data-original', 'data-original-src', 'data-actualsrc', 'data-lazy'];
const LAZY_SETS = ['data-srcset', 'data-lazy-srcset'];
// 스크립트가 진짜 이미지로 바꿔 넣기 전까지 자리만 잡아 두는 대체 이미지.
const PLACEHOLDER_FILE = /\/(?:img[-_])?(?:1x1|blank|spacer|pixel|transparent|placeholder|lazy|lazyload|loading|empty|clear|grey|gray)(?:[-_]?(?:\d+x\d+|\d+|img|image))?\.(?:gif|png|svg|webp)(?:[?#]|$)/i;
export const isPlaceholderImage = (src: string) => /^data:/i.test(src) ? src.length < 256 : PLACEHOLDER_FILE.test(src);

function resolve(value: string, base?: string) {
  if (!base) return value;
  try { return new URL(value, base).href; } catch { return value; }
}
const resolveSet = (set: string, base?: string) => set.split(',').map((candidate) => {
  const [url, ...descriptor] = candidate.trim().split(/\s+/);
  return [resolve(url, base), ...descriptor].join(' ');
}).join(', ');

const first = (node: ImageNode, names: string[], usable: (value: string) => boolean) =>
  names.map((name) => node.getAttribute(name)?.trim() ?? '').find((value) => value && usable(value));

/**
 * 스크립트 없이 복사한 페이지는 지연 로더를 돌리지 않아서, 이미지가 실제 사진 크기의
 * 1×1 대체 이미지로 남아 빈 틈으로 보인다. 진짜 주소를 제자리에 넣고,
 * 대체 이미지만 남은 이미지는 뺀다.
 */
export function revealLazyImages(root: ImageRoot, base?: string) {
  for (const source of root.querySelectorAll('source')) {
    const set = first(source, LAZY_SETS, () => true);
    if (set) source.setAttribute('srcset', resolveSet(set, base));
  }
  for (const img of root.querySelectorAll('img')) {
    const lazy = first(img, LAZY_SOURCES, (value) => !/^data:/i.test(value) && !/\s/.test(value));
    if (lazy) img.setAttribute('src', resolve(lazy, base));
    const set = first(img, LAZY_SETS, () => true);
    if (set) img.setAttribute('srcset', resolveSet(set, base));
    // 지연 로더가 썼을 주소는 이름이 무엇이든 진짜 이미지다.
    const src = img.getAttribute('src')?.trim() ?? '';
    if (!lazy && !img.getAttribute('srcset') && (!src || isPlaceholderImage(src))) img.remove();
  }
}
