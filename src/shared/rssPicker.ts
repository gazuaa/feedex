// RSS 만들기 도구의 클릭으로 고르기. 사람이 페이지의 정적 사본에서 기사 제목을 누르면
// 비슷한 카드를 찾아 선택자로 저장한다. extractPicked()는 서버(linkedom)와 샌드박스
// 페이지 사본 안에서 모두 돌아서 둘이 같은 기사를 본다. extractPicked와 pickerRuntime은
// Function#toString으로 페이지 사본에 넣으므로 자기 안에서 완결되게 둔다
// (import나 모듈 수준 참조 금지).

export type PickField = 'title' | 'summary' | 'image' | 'date';

export interface PickSelection {
  /** 되풀이되는 모든 기사 카드의 선택자. */
  item: string;
  /** 카드 안의 선택자. ''는 카드 자신이다. */
  title: string;
  summary?: string;
  image?: string;
  date?: string;
}

export interface PickedItem {
  title: string;
  url: string;
  summary: string | null;
  image: string | null;
  dateText: string | null;
}

export const PICK_SELECTOR = 'pick:';
export const PICK_FIELDS: PickField[] = ['title', 'summary', 'image', 'date'];

export function encodePick(selection: PickSelection, rendered: boolean): string {
  return PICK_SELECTOR + JSON.stringify(rendered ? { ...selection, rendered: true } : selection);
}

export function decodePick(selector: string): (PickSelection & { rendered?: boolean }) | null {
  if (!selector.startsWith(PICK_SELECTOR)) return null;
  try {
    const value = JSON.parse(selector.slice(PICK_SELECTOR.length));
    const field = (name: string) => value[name] === undefined || (typeof value[name] === 'string' && value[name].length <= 400);
    if (typeof value?.item !== 'string' || !value.item || value.item.length > 400 || typeof value.title !== 'string' || !PICK_FIELDS.every(field)) return null;
    return { item: value.item, title: value.title, summary: value.summary, image: value.image, date: value.date, rendered: value.rendered === true };
  } catch {
    return null;
  }
}

export function extractPicked(root: ParentNode, selection: PickSelection, baseUrl: string): PickedItem[] {
  const absolute = (value: string | null | undefined) => {
    if (!value || !value.trim() || value.trim().startsWith('data:')) return null;
    try {
      const url = new URL(value.trim(), baseUrl);
      return /^https?:$/.test(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  };
  const articleUrl = (value: string | null | undefined) => {
    const href = absolute(value);
    if (!href) return null;
    const url = new URL(href);
    url.hash = '';
    for (const key of Array.from(url.searchParams.keys())) if (/^(?:utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    // 게시판은 2쪽부터 글 링크에도 목록의 쪽 번호(?page=2)를 붙인다. 떼지 않으면 같은 글이 쪽마다 다른 글이 된다.
    // 이 함수는 고르기 화면 안에서도 돌므로 바깥 값을 쓰지 않고 쪽 번호 이름을 여기 적는다.
    try { new URL(baseUrl).searchParams.forEach((value, key) => { if (/^(?:page|p|pg|paged|pageno|page_no|pagenum|pageindex|cpage|curpage|currentpage|pn)$/i.test(key) && url.searchParams.get(key) === value) url.searchParams.delete(key); }); } catch { /* 기준 주소가 없으면 그대로 둔다. */ }
    return url.href;
  };
  const text = (node: Element | null) => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const within = (card: Element, selector: string | undefined) => (selector === undefined ? null : selector ? card.querySelector(selector) : card);
  // 서버에서 렌더링한 React는 dateTime과 srcSet으로 쓴다. 브라우저는 속성 이름을
  // 소문자로 바꾸지만 linkedom은 쓴 그대로 둔다.
  const attr = (node: Element | null | undefined, name: string) =>
    node ? node.getAttribute(name) ?? Array.from(node.attributes).find((item) => item.name.toLowerCase() === name)?.value ?? null : null;
  const imageSource = (img: Element) => {
    for (const name of ['data-src', 'data-lazy-src', 'data-original', 'src', 'srcset', 'data-srcset']) {
      const value = attr(img, name);
      const first = value && (name.endsWith('srcset') ? value.split(',')[0].trim().split(/\s+/)[0] : value);
      const url = absolute(first);
      if (url) return url;
    }
    return null;
  };
  const items: PickedItem[] = [];
  const seen = new Set<string>();
  for (const card of Array.from(root.querySelectorAll(selection.item)).slice(0, 400)) {
    const heading = within(card, selection.title);
    if (!heading) continue;
    const link = heading.closest('a[href]') || heading.querySelector('a[href]') || card.querySelector('a[href]');
    const url = articleUrl(link?.getAttribute('href'));
    const title = text(heading) || link?.getAttribute('title')?.trim() || '';
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    const summary = text(within(card, selection.summary));
    const imageNode = within(card, selection.image);
    const img = imageNode && (imageNode.tagName === 'IMG' ? imageNode : imageNode.querySelector('img'));
    const dateNode = within(card, selection.date);
    const dateText = dateNode && (attr(dateNode, 'datetime') || attr(dateNode.querySelector('time'), 'datetime') || text(dateNode));
    items.push({
      title: title.slice(0, 350),
      url,
      summary: summary && summary !== title ? summary.slice(0, 600) : null,
      image: img ? imageSource(img) : null,
      dateText: dateText || null,
    });
  }
  return items;
}

/** 샌드박스 페이지 사본 안에서 돌며 postMessage로 앱과 이야기한다. */
export function pickerRuntime(extract: typeof extractPicked, baseUrl: string, suggestUrl: string | null) {
  const FIELDS = ['title', 'summary', 'image', 'date'] as const;
  const HEADINGS = 'h1,h2,h3,h4,h5,h6';
  type Field = (typeof FIELDS)[number];
  type Selection = { item: string; title: string; summary?: string; image?: string; date?: string };
  let field: Field = 'title';
  let selection: Selection | null = null;
  let hovered: Element | null = null;
  const send = (message: Record<string, unknown>) => parent.postMessage({ source: 'sfeed-picker', ...message }, '*');

  const style = document.createElement('style');
  style.textContent = [
    '[data-sfeed-hover]{outline:2px dashed #10b981!important;outline-offset:1px!important;cursor:pointer!important}',
    '[data-sfeed-item]{outline:2px solid rgba(16,185,129,.6)!important;outline-offset:2px!important}',
    '[data-sfeed-field=title]{background-color:rgba(16,185,129,.22)!important;box-shadow:inset 0 0 0 2px #10b981!important}',
    '[data-sfeed-field=summary]{background-color:rgba(59,130,246,.16)!important;box-shadow:inset 0 0 0 2px #3b82f6!important}',
    '[data-sfeed-field=image]{outline:3px solid #f59e0b!important;outline-offset:-3px!important}',
    '[data-sfeed-field=date]{background-color:rgba(168,85,247,.2)!important;box-shadow:inset 0 0 0 2px #a855f7!important}',
  ].join('');
  (document.head || document.documentElement).appendChild(style);

  const stable = (name: string) => /^[A-Za-z_][\w-]*$/.test(name) && !/\d{4,}/.test(name) && name.length <= 40;
  const sig = (node: Element, classes?: string[]) =>
    node.tagName.toLowerCase() + (classes || Array.from(node.classList).filter(stable).slice(0, 3)).map((name) => '.' + name).join('');
  const normalize = (href: string) => {
    try {
      const url = new URL(href, baseUrl);
      url.hash = '';
      for (const key of Array.from(url.searchParams.keys())) if (/^(?:utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
      return url.href.replace(/\/$/, '');
    } catch {
      return null;
    }
  };
  const hrefOf = (node: Element | null) => {
    const link = node && (node.matches('a[href]') ? node : node.querySelector('a[href]'));
    return link ? normalize(link.getAttribute('href') || '') : null;
  };
  // 한 목록의 카드들은 안쪽 태그가 대부분 같다. 제목 옆의 글쓴이·분류 링크는
  // 제목 링크처럼 보이지 않는다.
  const shape = (node: Element) => new Set(Array.from(node.querySelectorAll('*')).slice(0, 200).map((child) => child.tagName));
  const alike = (a: Element, b: Element) => {
    const left = shape(a);
    const right = shape(b);
    if (!left.size && !right.size) return true;
    let both = 0;
    left.forEach((tag) => { if (right.has(tag)) both++; });
    return both / (left.size + right.size - both) >= 0.5;
  };

  // 카드는, 다른 곳으로 이어지는 비슷한 형제 사이에서 가장 많이 되풀이되는 링크의 조상이다.
  // 같으면 바깥쪽이 더 많은 항목을 담는다.
  const cardFor = (start: Element, link: Element) => {
    const own = hrefOf(link);
    let best: { card: Element; classes: string[]; count: number } | null = null;
    let depth = 0;
    for (let node: Element | null = start; node && node.parentElement && node !== document.body && depth < 12; node = node.parentElement, depth++) {
      if (node !== link && !node.contains(link)) continue;
      const current = node;
      const peers = Array.from(current.parentElement!.children).filter((other) => other !== current && other.tagName === current.tagName && hrefOf(other) && hrefOf(other) !== own && alike(current, other));
      if (!peers.length) continue;
      const common = Array.from(current.classList).filter(stable).filter((name) => peers.filter((peer) => peer.classList.contains(name)).length * 2 >= peers.length);
      const similar = peers.filter((peer) => common.every((name) => peer.classList.contains(name))).length;
      if (similar && (!best || similar >= best.count)) best = { card: current, classes: common.slice(0, 3), count: similar };
    }
    return best;
  };

  const cardSelector = (card: Element, classes: string[]) => {
    const parts = [sig(card, classes)];
    let node = card.parentElement;
    for (let depth = 0; node && node !== document.body && depth < 3; depth++, node = node.parentElement) {
      const id = node.id && stable(node.id) ? node.tagName.toLowerCase() + '#' + node.id : '';
      parts.unshift(id || sig(node));
      if (id || Array.from(node.classList).some(stable)) break;
    }
    return parts.join(' ');
  };

  const pathWithin = (card: Element, target: Element) => {
    if (card === target) return '';
    const chain: Element[] = [];
    for (let node: Element | null = target; node && node !== card; node = node.parentElement) chain.unshift(node);
    for (let start = chain.length - 1; start >= 0; start--) {
      const selector = chain.slice(start).map((node) => sig(node)).join(' ');
      if (card.querySelector(selector) === target) return selector;
    }
    return chain.map((node) => sig(node)).join(' ');
  };

  const DATE_TEXT = /(\d{4}\s*[.\-/년]\s*\d{1,2}|\d+\s*(?:분|시간|일|주)\s*전|\b\d+\s*(?:minutes?|hours?|days?|weeks?)\s+ago|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b)/i;
  const guess = (card: Element, heading: Element) => {
    const result: Partial<Selection> = {};
    const image = card.querySelector('img');
    if (image && !heading.contains(image)) result.image = pathWithin(card, image);
    const date = Array.from(card.querySelectorAll('time')).find((node) => !heading.contains(node))
      || Array.from(card.querySelectorAll('span,div,p,small,li')).find((node) => node.children.length === 0 && !heading.contains(node) && DATE_TEXT.test(node.textContent || ''));
    if (date) result.date = pathWithin(card, date);
    const summary = Array.from(card.querySelectorAll('p,div')).find((node) =>
      !node.contains(heading) && !heading.contains(node) && node !== date && !node.querySelector('p,div') && (node.textContent || '').trim().length >= 40);
    if (summary) result.summary = pathWithin(card, summary);
    return result;
  };

  const paint = () => {
    document.querySelectorAll('[data-sfeed-item],[data-sfeed-field]').forEach((node) => {
      node.removeAttribute('data-sfeed-item');
      node.removeAttribute('data-sfeed-field');
    });
    if (!selection) return 0;
    let cards: Element[] = [];
    try { cards = Array.from(document.querySelectorAll(selection.item)).slice(0, 400); } catch {}
    for (const card of cards) {
      card.setAttribute('data-sfeed-item', '');
      for (const name of FIELDS) {
        const selector = selection[name];
        const node = selector === undefined ? null : selector ? card.querySelector(selector) : card;
        node?.setAttribute('data-sfeed-field', name);
      }
    }
    let items: ReturnType<typeof extract> = [];
    try { items = extract(document, selection, baseUrl); } catch {}
    send({ type: 'selection', selection, items: items.slice(0, 50), count: items.length });
    return items.length;
  };

  // 카드 전체가 링크 하나일 수 있다(분류, 글쓴이, 제목, 요약). 그때 제목은 가장 큰
  // 글자로 쓴 글이다.
  const titleWithin = (link: Element) => {
    const leaves = Array.from(link.querySelectorAll('*')).filter((node) => node.children.length === 0 && (node.textContent || '').trim().length >= 2);
    if (leaves.length < 2) return link;
    const size = (node: Element) => { try { return parseFloat(getComputedStyle(node).fontSize) || 0; } catch { return 0; } };
    const weight = (node: Element) => size(node) * 1000 + (node.textContent || '').trim().length;
    return leaves.reduce((best, node) => (weight(node) > weight(best) ? node : best));
  };

  const pick = (target: Element) => {
    if (field === 'title') {
      const link = target.closest('a[href]') || target.querySelector('a[href]');
      if (!link) return send({ type: 'notice', message: '링크로 연결된 글 제목을 눌러 주세요.' });
      const base = (target.textContent || '').trim().length > 1 ? target : link;
      const heading = base.matches(HEADINGS) ? base : base.querySelector(HEADINGS) || (base === link ? titleWithin(link) : base);
      const found = cardFor(heading, link);
      const card = found ? found.card : link;
      selection = { item: found ? cardSelector(found.card, found.classes) : cardSelector(link, Array.from(link.classList).filter(stable).slice(0, 3)), title: pathWithin(card, heading), ...guess(card, heading) };
      const count = paint();
      return send({ type: 'notice', message: count > 1 ? null : '같은 모양의 글을 찾지 못해 이 글 하나만 선택했습니다. 목록의 다른 글 제목을 눌러 보세요.' });
    } else {
      const card = target.closest('[data-sfeed-item]');
      if (!selection || !card) return send({ type: 'notice', message: selection ? '초록 테두리로 표시된 글 카드 안에서 골라 주세요.' : '먼저 글 제목을 골라 주세요.' });
      const node = field === 'image' ? (target.matches('img') ? target : target.querySelector('img') || target) : target;
      selection = { ...selection, [field]: pathWithin(card, node) };
      send({ type: 'notice', message: null });
    }
    paint();
  };

  document.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.target instanceof Element) pick(event.target);
  }, true);
  document.addEventListener('submit', (event) => event.preventDefault(), true);
  document.addEventListener('mouseover', (event) => {
    hovered?.removeAttribute('data-sfeed-hover');
    hovered = event.target instanceof Element ? event.target : null;
    hovered?.setAttribute('data-sfeed-hover', '');
  }, true);
  document.documentElement.addEventListener('mouseleave', () => hovered?.removeAttribute('data-sfeed-hover'));
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== parent || !data || data.source !== 'sfeed-app') return;
    if (data.type === 'field' && FIELDS.includes(data.field)) field = data.field;
    if (data.type === 'clear' && selection && data.field !== 'title' && FIELDS.includes(data.field)) {
      const next: Selection = { ...selection };
      delete next[data.field as Exclude<Field, 'title'>];
      selection = next;
      paint();
    }
  });

  // 그럴듯한 목록부터 시작한다: 카드가 가장 많이 되풀이되는, 링크가 걸린 제목(제목 태그나
  // 몇 단어짜리 글). 없으면 서버의 추측, 즉 서버가 찾은 첫 기사로 대신한다.
  const suggestion = () => {
    let best: { anchor: Element; count: number } | null = null;
    const headlines = Array.from(document.querySelectorAll('a[href]')).filter((anchor) => {
      if (anchor.closest('nav,header,footer,aside,[role="navigation"],[role="banner"],[role="contentinfo"]')) return false;
      const heading = anchor.querySelector(HEADINGS) || anchor.closest(HEADINGS);
      const words = (heading || anchor).textContent?.replace(/\s+/g, ' ').trim() || '';
      return words.length >= 15 && words.length <= 300 && words.split(' ').length >= (heading ? 2 : 4);
    }).slice(0, 60);
    for (const anchor of headlines) {
      const found = cardFor(anchor.querySelector(HEADINGS) || anchor, anchor);
      if (found && (!best || found.count > best.count)) best = { anchor, count: found.count };
    }
    if (best) return best.anchor;
    const wanted = suggestUrl && normalize(suggestUrl);
    const anchors = wanted ? Array.from(document.querySelectorAll('a[href]')).filter((anchor) => hrefOf(anchor) === wanted) : [];
    return anchors.find((anchor) => anchor.querySelector(HEADINGS)) || anchors.sort((a, b) => (b.textContent || '').trim().length - (a.textContent || '').trim().length)[0] || null;
  };

  send({ type: 'ready' });
  const start = suggestion();
  if (start) {
    pick(start);
    // 페이지 사본만 스크롤한다. scrollIntoView는 프레임 둘레의 대화창까지 움직여
    // 만들기 도구의 조절기를 가린다.
    const first = document.querySelector('[data-sfeed-item]');
    try { if (first) window.scrollTo(0, Math.max(0, first.getBoundingClientRect().top + window.scrollY - window.innerHeight / 3)); } catch {}
  }
}

/** iframe srcdoc에 바로 넣을 수 있는, 고르기 도구를 더한 페이지 사본. */
export function pickerDocument(snapshot: string, baseUrl: string, suggestUrl: string | null): string {
  const code = `(${pickerRuntime.toString()})(${extractPicked.toString()}, ${JSON.stringify(baseUrl)}, ${JSON.stringify(suggestUrl)});`.replace(/<\/script/gi, '<\\/script');
  const script = `<script>${code}</script>`;
  return /<\/body>/i.test(snapshot) ? snapshot.replace(/<\/body>(?![\s\S]*<\/body>)/i, () => `${script}</body>`) : snapshot + script;
}
