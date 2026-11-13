/** 본문 폭을 넘는 표는 표 안에서만 옆으로 밀 수 있게 한다. */
export function wrapArticleTables(root: ParentNode) {
  for (const table of root.querySelectorAll('table')) {
    if (table.closest('.feedex-table-scroll') || table.parentElement?.closest('table') || table.getAttribute('role') === 'presentation') continue;
    const wrapper = table.ownerDocument.createElement('div');
    wrapper.className = 'feedex-table-scroll';
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', '표 가로 스크롤');
    table.before(wrapper);
    wrapper.append(table);
  }
}

export const ARTICLE_TABLE_STYLE = `.feedex-table-scroll{display:block;width:100%;min-width:0;max-width:100%;overflow-x:auto;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch}.feedex-table-scroll>table{max-width:none!important}`;

// 원문 프레임에 접근할 수 없는 사이트는 표가 포함된 공개 사본을 먼저 확인한다.
export function prefersMobileTableCopy(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /^(?:www\.)?visualcapitalist\.com$/i.test(url.host);
  }
  catch { return false; }
}
