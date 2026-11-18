import createDOMPurify from 'dompurify';
import { articleAllAttributes, articleAttribute, articleTags, articleYoutube } from '../shared/articleMarkup';
import { dropSiteClasses, X_THREAD_CLASSES } from '../shared/siteClasses';

let purifier: ReturnType<typeof createDOMPurify> | undefined;

/** 서버나 기기에 이전에 저장한 본문도 실제 브라우저에 붙이기 전에 다시 정리한다. */
export function sanitizeReaderMarkup(html: string, base: string, xThread = false): DocumentFragment | null {
  if (!html || typeof window === 'undefined') return null;
  const sanitize = purifier ??= createDOMPurify(window);
  if (!sanitize.isSupported) return null;
  const content = sanitize.sanitize(html, { ALLOWED_TAGS: articleTags, ALLOWED_ATTR: articleAllAttributes,
    ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false, RETURN_DOM_FRAGMENT: true });
  for (const node of content.querySelectorAll('*')) {
    if (node.namespaceURI !== 'http://www.w3.org/1999/xhtml') { node.remove(); continue; }
    const tag = node.localName;
    if (tag === 'iframe') {
      const input = Object.fromEntries(Array.from(node.attributes, attr => [attr.name, attr.value]));
      const safe = articleYoutube(input, base);
      if (!safe) { node.remove(); continue; }
      for (const { name } of Array.from(node.attributes)) node.removeAttribute(name);
      for (const [name, value] of Object.entries(safe)) node.setAttribute(name, value);
      continue;
    }
    for (const { name, value } of Array.from(node.attributes)) {
      const safe = articleAttribute(tag, name, value, base);
      if (safe === null) node.removeAttribute(name);
      else if (safe !== value) node.setAttribute(name, safe);
    }
    if (tag === 'a' && node.hasAttribute('href')) { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
    if (tag === 'audio' || tag === 'video') node.setAttribute('controls', '');
  }
  dropSiteClasses(content, xThread ? X_THREAD_CLASSES : undefined);
  return content;
}
