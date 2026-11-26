const svgNamespace = 'http://www.w3.org/2000/svg';
const fontRule = /^\s*\{\s*font-family:\s*['"‘’]([\w\s-]{1,80})['"‘’]\s*;\s*font-weight:\s*(normal|bold|[1-9]00)\s*;\s*font-style:\s*(normal|italic)\s*;\s*src:\s*url\(data:font\/(woff2?);base64,([A-Za-z0-9+/]+={0,2})\)\s*format\(['"‘’]woff2?['"‘’]\)\s*;\s*\}\s*$/i;

/** 예전에 저장한 사본에서 브라우저가 도표를 중간에 닫게 하는 HTML을 찾는다. */
export function hasBrokenCopySvg(html: string): boolean {
  return /<svg[\s>]/i.test(html) && (/<defs\b[^>]*>\s*<span\b[^>]*\bdata-cites=["']font-face["']/i.test(html)
    || /<(?:text|tspan)\b[^>]*>[^<]*<em[\s>]/i.test(html));
}

/** 마크다운 변환 중 도표에 들어간 HTML을 브라우저로 보내기 전에 바로잡는다. */
export function repairCopySvg(document: Document) {
  for (const defs of document.querySelectorAll('svg defs')) {
    const rules: string[] = [];
    for (const cite of defs.querySelectorAll(':scope > span[data-cites="font-face"]')) {
      if (cite.textContent?.trim() !== '@font-face') continue;
      const source = cite.nextSibling;
      if (source?.nodeType === 3 && /^\s*\{\s*font-family:/i.test(source.nodeValue || '')) {
        const rule = fontRule.exec(source.nodeValue || '');
        // 정해진 형식의 내장 WOFF만 복원한다. 다른 CSS나 외부 주소는 옮기지 않는다.
        if (rule) {
          const [, family, weight, style, format, data] = rule;
          rules.push(`@font-face{font-family:'${family.replace(/\s+/g, ' ').trim()}';font-weight:${weight};font-style:${style};src:url(data:font/${format};base64,${data}) format('${format}');}`);
        }
        source.parentNode?.removeChild(source);
      }
      cite.remove();
    }
    if (rules.length) {
      const style = document.createElementNS(svgNamespace, 'style');
      style.textContent = rules.join('\n');
      defs.prepend(style);
    }
  }
  for (const emphasis of document.querySelectorAll('svg :is(text,tspan) > em')) {
    if (emphasis.namespaceURI !== svgNamespace) continue;
    const span = document.createElementNS(svgNamespace, 'tspan');
    span.setAttribute('font-style', 'italic');
    span.textContent = emphasis.textContent;
    emphasis.replaceWith(span);
  }
}
