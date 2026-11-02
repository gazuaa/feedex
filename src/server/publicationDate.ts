// 피드 생성기의 pubDate는 오래된 글을 발견한 시각일 수 있다.
// 명시적인 발행 메타데이터만(dateModified나 아무 본문 글은 안 된다) 그 날짜를 덮어쓸 수 있다.
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2}|\b[A-Z]{2,5})\s*$/;

export function parsePublicationDate(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const text = raw.trim();
  if (!/\b\d{4}\b/.test(text)) return null;
  const local = text.match(/^(\d{4})[-.](\d{2})[-.](\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?)?$/);
  let value = text;
  if (local) {
    const [, year, month, day, hour = '00', minute = '00', second = '00', fraction = ''] = local;
    const calendar = new Date(Date.UTC(+year, +month - 1, +day));
    if (calendar.getUTCFullYear() !== +year || calendar.getUTCMonth() !== +month - 1 || calendar.getUTCDate() !== +day || +hour > 23 || +minute > 59 || +second > 59) return null;
    // 시간대 없는 기존 한국 CMS 피드와 한국경제 카드는 KST를 쓴다.
    value = `${year}-${month}-${day}T${hour}:${minute}:${second}${fraction}+09:00`;
  } else if (!HAS_ZONE.test(text)) {
    if (!Number.isFinite(Date.parse(text))) return null;
    value = `${text} +0900`;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) result[match[1].toLowerCase()] = match[3];
  return result;
}

function sameArticle(left: string, right: string): boolean {
  try {
    const a = new URL(left, right), b = new URL(right);
    return a.hostname.replace(/^www\./, '') === b.hostname.replace(/^www\./, '') && a.pathname.replace(/\/$/, '') === b.pathname.replace(/\/$/, '');
  } catch { return false; }
}

export function extractOriginalPublishedAt(html: string | null | undefined, url: string): string | null {
  if (!html) return null;
  const parseHtmlDate = (value: unknown) => {
    if (typeof value !== 'string') return null;
    // 피드 읽기에는 한국 CMS 날짜를 KST로 보는 관례가 있다. 해외 언론사의 시간대 없는
    // 메타데이터에는 이 관례를 적용하지 않는다. 명시적인 시차를 확인할 수 있을 때까지
    // 피드 날짜를 그대로 둔다.
    if (!HAS_ZONE.test(value.trim())) {
      try { if (!/(?:\.kr|(?:^|\.)(?:hankyung|aitimes)\.com)$/i.test(new URL(url).hostname)) return null; }
      catch { return null; }
    }
    return parsePublicationDate(value);
  };
  // 주석과 JSON이 아닌 스크립트는 무시해서, 글에 인용된 예시를 페이지 자체
  // 메타데이터로 착각하지 않게 한다.
  const source = html.replace(/<!--[\s\S]*?-->/g, '');
  const markup = source.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  for (const match of markup.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    if (['article:published_time', 'datepublished', 'pubdate', 'publishdate', 'publish-date', 'dc.date.issued', 'parsely-pub-date', 'sailthru.date', 'citation_publication_date'].includes((attrs.property || attrs.itemprop || attrs.name || '').toLowerCase())) {
      const date = parseHtmlDate(attrs.content);
      if (date) return date;
    }
  }
  for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (attributes(match[1]).type?.toLowerCase() !== 'application/ld+json') continue;
    try {
      const visit = (node: unknown): string | null => {
        if (Array.isArray(node)) {
          for (const child of node) { const date = visit(child); if (date) return date; }
          return null;
        }
        if (!node || typeof node !== 'object') return null;
        const obj = node as Record<string, unknown>;
        const types = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
        const main = obj.mainEntityOfPage;
        const identity = obj.url || (typeof main === 'object' && main ? (main as Record<string, unknown>)['@id'] : main) || obj['@id'];
        if (types.some((type) => typeof type === 'string' && /^(?:NewsArticle|Article|BlogPosting|ReportageNewsArticle|TechArticle)$/.test(type)) && (!identity || (typeof identity === 'string' && sameArticle(identity, url)))) {
          const date = parseHtmlDate(obj.datePublished);
          if (date) return date;
        }
        // 관련 기사, 댓글, 인용된 객체 안으로는 들어가지 않는다.
        return visit(obj['@graph']) || visit(obj.mainEntity);
      };
      const date = visit(JSON.parse(match[2]));
      if (date) return date;
    } catch { /* 잘못된 구조화 메타데이터가 피드를 막으면 안 된다. */ }
  }
  for (const match of markup.matchAll(/<time\b([^>]*)>([\s\S]*?)<\/time>/gi)) {
    const attrs = attributes(match[1]);
    const preceding = markup.slice(Math.max(0, (match.index || 0) - 3000), match.index);
    const headline = [...preceding.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)].at(-1)?.[1];
    const link = headline?.match(/<a\b[^>]*>/i);
    const linkedPostDate = link && sameArticle(attributes(link[0]).href, url) && attrs.class?.split(/\s+/).some((name) => ['post-date', 'entry-date'].includes(name));
    if (!/modified|updated/i.test(attrs.class || '') && (attrs.itemprop?.toLowerCase() === 'datepublished' || /\bpubdate\b/i.test(match[1]) || linkedPostDate || attrs.class?.split(/\s+/).some((name) => ['published', 'date-published', 'published-date', 'entry-published'].includes(name)))) {
      const date = parseHtmlDate(attrs.datetime || match[2].replace(/<[^>]*>/g, '').trim());
      if (date) return date;
    }
  }
  for (const match of markup.matchAll(/<(?:span|p)\b([^>]*)>([^<]*)<\/(?:span|p)>/gi)) {
    const attrs = attributes(match[1]);
    if (attrs.itemprop?.toLowerCase() === 'datepublished') {
      const date = parseHtmlDate(attrs.content || match[2]);
      if (date) return date;
    }
  }
  // PolitePol에는 한국경제 기자 카드 HTML이 들어 있다. 본문의 아무 날짜나 훑지 않고
  // 바로 앞의 제목 링크에 날짜를 묶는다.
  if (/^https?:\/\/(?:www\.)?hankyung\.com\/article\//i.test(url)) {
    for (const match of markup.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>\s*<p\b([^>]*)>([\s\S]*?)<\/p>/gi)) {
      if (!attributes(match[2]).class?.split(/\s+/).includes('txt-date')) continue;
      const link = match[1].match(/<a\b[^>]*>/i);
      if (!link || !sameArticle(attributes(link[0]).href, url)) continue;
      const date = parsePublicationDate(match[3].replace(/<[^>]*>/g, '').trim());
      if (date) return date;
    }
  }
  return null;
}

// 예전 Feedly 다운로드에는 납작해진 기자 카드만 남았다. 이 언론사 형식은
// 정확한 제목 바로 뒤에 날짜를 둔다.
export function extractSummaryPublishedAt(summary: string | null, title: string, url: string): string | null {
  if (!summary) return null;
  const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
  const text = normalize(summary), headline = normalize(title);
  if (/^https?:\/\/(?:www\.)?blockmedia\.co\.kr\/archives\/\d+/i.test(url)) {
    // 예전 Feedly 행은 납작해진 PolitePol 카드를 가졌다: 분류, 정확한 제목, 짧은 글쓴이 줄,
    // 발행 시각, 선택적인 바닥글. 이 카드 모양이 온전할 때만 쓰고, 기사 본문의 날짜는 훑지 않는다.
    const position = text.indexOf(headline);
    if (!headline || position < 0 || position > 80) return null;
    const tail = text.slice(position + headline.length);
    const cardDate = tail.match(/^\s+[\p{L}\p{N} .·|_()-]{1,60}?\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})(?:\s+Delivered by PolitePaul service)?\s*$/u);
    return cardDate ? parsePublicationDate(cardDate[1]) : null;
  }
  if (!/^https?:\/\/(?:www\.)?hankyung\.com\/article\//i.test(url)) return null;
  if (!headline || !text.startsWith(headline)) return null;
  const date = text.slice(headline.length).match(/^\s+(\d{4}\.\d{2}\.\d{2} \d{2}:\d{2})(?:\s|$)/);
  return date ? parsePublicationDate(date[1]) : null;
}
