import sanitizeHtml from 'sanitize-html';
import { articleAttribute, articleInputAttributes, articleTags, articleYoutube } from '../shared/articleMarkup';

export function sanitizeArticleMarkup(html: string, base?: string): string {
  return sanitizeHtml(html, {
    allowedTags: articleTags,
    allowedAttributes: {
      ...articleInputAttributes,
      a: ['href', 'target', 'rel'],
      iframe: ['src', 'title', 'width', 'height', 'loading', 'referrerpolicy', 'allow', 'allowfullscreen'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesAppliedToAttributes: ['href', 'src', 'poster'],
    allowProtocolRelative: false,
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'template', 'svg', 'math', 'object', 'select'],
    transformTags: { '*': (tagName, input) => {
      if (tagName === 'iframe') {
        const youtube = articleYoutube(input, base);
        return { tagName: youtube ? 'iframe' : 'span', attribs: youtube ?? {} };
      }
      const attribs: Record<string, string> = {};
      for (const [name, value] of Object.entries(input)) {
        const safe = articleAttribute(tagName, name, value, base);
        if (safe !== null) attribs[name] = safe;
      }
      if (tagName === 'a' && attribs.href) { attribs.target = '_blank'; attribs.rel = 'noopener noreferrer'; }
      if (tagName === 'audio' || tagName === 'video') attribs.controls = '';
      return { tagName, attribs };
    } },
  }).trim();
}
