/**
 * 샌드박스 사본에는 출처가 없어서 CORS로 요청한 스타일시트가 "Origin: null"로 나가고,
 * 그 사이트에만 응답하는 CDN은 이를 거절한다. 그러면 사본이 스타일 없이 보인다.
 * 일반 요청이면 스타일시트가 적용된다. 무결성 검사는 CORS가 필요하므로 함께 뺀다.
 */
export function plainCopyStyles(root: ParentNode) {
  for (const link of Array.from(root.querySelectorAll('link[rel~="stylesheet"][crossorigin], link[rel~="stylesheet"][integrity]'))) {
    link.removeAttribute('crossorigin');
    link.removeAttribute('integrity');
  }
}
