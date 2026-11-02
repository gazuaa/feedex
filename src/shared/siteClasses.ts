const HIDDEN = new Set(['hidden', 'sr-only', 'screen-reader-text', 'visually-hidden']);

/**
 * 사이트 클래스 이름은 앱의 유틸리티 스타일(flex, grid, 폭)을 집어 와 배치를 깨므로
 * 기사 본문에는 하나도 남기지 않는다. 사이트가 휴대폰에서 숨겼거나 화면 낭독기용으로만
 * 둔 것은 드러내지 않고 뺀다.
 */
export function dropSiteClasses(root: ParentNode) {
  for (const node of Array.from(root.querySelectorAll('[class]'))) {
    if ((node.getAttribute('class') || '').split(/\s+/).some((name) => HIDDEN.has(name))) node.remove();
    else node.removeAttribute('class');
  }
}
