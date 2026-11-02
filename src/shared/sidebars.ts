const MEDIA = 'img,picture,video,audio,svg,canvas,iframe,object,embed';
const NAMED = /(?:^|[-_])sidebar$/i;

/** 독자가 보는 글. 위젯은 자기 style 블록을 갖고 있는 경우가 많다. */
function shownLength(node: Element) {
  const hidden = Array.from(node.querySelectorAll('style,script,noscript,template')).reduce((sum, part) => sum + (part.textContent?.length || 0), 0);
  return Math.max(0, (node.textContent?.replace(/\s+/g, ' ').length || 0) - hidden);
}

/** 기사 문단 글을 가장 많이 담은 블록. */
function articleText(root: ParentNode) {
  const sums = new Map<Element, number>();
  for (const p of Array.from(root.querySelectorAll('p'))) {
    if (p.parentElement) sums.set(p.parentElement, (sums.get(p.parentElement) || 0) + (p.textContent?.trim().length || 0));
  }
  let best: Element | null = null, most = 200;
  for (const [block, length] of sums) if (length > most) { best = block; most = length; }
  return best;
}

/**
 * 기사 옆 열(aside, complementary, *-sidebar)은 다른 기사와 광고를 늘어놓는다.
 * 사본은 기사만 보여 주므로, 본문 밖에 있으면서 대부분 링크이거나 비어 있는 열은 뺀다.
 * 핵심 정리 같은 글 상자와 본문 안에 있는 것은 남긴다.
 */
export function dropSidebars(root: ParentNode) {
  const text = articleText(root);
  if (!text) return;
  const candidates = Array.from(root.querySelectorAll('aside,[role="complementary"],[class*="idebar"],[id*="idebar"]')).filter((node) =>
    node.tagName === 'ASIDE' || node.getAttribute('role') === 'complementary'
    || (node.getAttribute('class') || '').split(/\s+/).some((name) => NAMED.test(name)) || NAMED.test(node.id));
  for (const node of candidates) {
    if (node.contains(text) || text.contains(node)) continue;
    const length = shownLength(node);
    const linked = Array.from(node.querySelectorAll('a')).reduce((sum, link) => sum + shownLength(link), 0);
    if (length > 20 ? linked / length >= 0.5 : !node.querySelector(MEDIA)) node.remove();
  }
}
