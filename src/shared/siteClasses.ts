const HIDDEN = new Set(['hidden', 'sr-only', 'screen-reader-text', 'visually-hidden']);

/**
 * X 대화 번역 본문의 클래스. 우리 서버가 만든 X 대화 사본(xThread)의 구조라 사이트 클래스가 아니다.
 * 글·작성자 줄·인용 상자·사진을 구분해야 번역 화면에서 X처럼 그릴 수 있다(.feedex-x-translation 아래에서만 쓴다).
 */
export const X_THREAD_CLASSES: ReadonlySet<string> = new Set(['post', 'main', 'before', 'after', 'reply', 'body', 'who', 'text', 'quote', 'quote-post', 'media', 'photo', 'video', 'card', 'replies', 'thread', 'link', 'parent-missing']);

/**
 * 사이트 클래스 이름은 앱의 유틸리티 스타일(flex, grid, 폭)을 집어 와 배치를 깨므로
 * 기사 본문에는 하나도 남기지 않는다. 사이트가 휴대폰에서 숨겼거나 화면 낭독기용으로만
 * 둔 것은 드러내지 않고 뺀다. `keep`에 든 이름(우리가 만든 구조)만 남길 수 있다.
 */
export function dropSiteClasses(root: ParentNode, keep?: ReadonlySet<string>) {
  for (const node of Array.from(root.querySelectorAll('[class]'))) {
    const names = (node.getAttribute('class') || '').split(/\s+/).filter(Boolean);
    if (names.some((name) => HIDDEN.has(name))) { node.remove(); continue; }
    const kept = keep ? names.filter((name) => keep.has(name)) : [];
    if (kept.length) node.setAttribute('class', kept.join(' '));
    else node.removeAttribute('class');
  }
}
