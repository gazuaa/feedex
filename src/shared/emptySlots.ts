const MEDIA = 'img,picture,video,audio,svg,canvas,iframe,object,embed';
const RESERVED = /(?:^|;)\s*(?:min-)?height\s*:\s*(\d+(?:\.\d+)?)px/i;

const empty = (node: Element) => !node.textContent?.trim() && !node.querySelector(MEDIA);

/**
 * 광고·위젯 칸은 인라인으로 높이를 잡아 두고 스크립트가 채운다. 스크립트 없는 사본에서는
 * 높고 빈 틈으로 보이므로, 빈 칸과 그 칸 때문에 비게 된 감싸는 요소를 뺀다.
 * 위치를 잡았거나 칠해진 상자는 틈을 만들지 않으므로 남긴다.
 */
export function dropEmptySlots(root: ParentNode) {
  for (const slot of Array.from(root.querySelectorAll('[style*="height"]'))) {
    const style = slot.getAttribute('style') || '';
    const reserved = RESERVED.exec(style);
    if (!reserved || Number(reserved[1]) < 50 || /position\s*:\s*(?:absolute|fixed)|background/i.test(style) || !empty(slot)) continue;
    let node: Element = slot;
    while (node.parentElement && /^(?:DIV|SECTION|ASIDE|FIGURE)$/.test(node.parentElement.tagName) && empty(node.parentElement)) node = node.parentElement;
    node.remove();
  }
}
