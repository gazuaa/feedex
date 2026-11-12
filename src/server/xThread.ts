import type { D1DatabaseLike, Env } from './types';
import { parseHTML } from 'linkedom';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { xVideoHtml } from '../shared/xMedia';
import { originalUrl, providers, readFeed, restProvider, restingUntil } from './xFeed';
import { X_THREAD_MARK, X_THREAD_STYLE, X_VIDEO_STYLE } from '../shared/xThreadStyle';
export { isXStatusUrl as xStatusUrl } from '../shared/xFeed';

// x.com은 로그인하지 않은 사람에게 댓글을 몇 개만 보여 주고, 다른 사이트의 프레임도 거부한다.
// 그래서 X 글의 웹 보기는 공개 Nitter 글 페이지를 받아 글·인용·첨부·댓글만 앱이 다시 짠 문서로 보여 준다.
// 글 페이지에 봇 확인을 거는 경로는 우회하지 않고 한동안 건너뛴다.
const STATUS = /^https:\/\/x\.com\/([a-z\d_]{1,15})\/status\/(\d{1,20})$/i;
const pageless = new Map<string, number>();
type Element = { querySelector(selector: string): Element | null; querySelectorAll(selector: string): Iterable<Element>; getAttribute(name: string): string | null; textContent: string | null; childNodes: Iterable<Node>; parentElement: Element | null; matches(selector: string): boolean };
type Node = { nodeType: number; nodeName: string; textContent: string | null };


const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 공개 미러의 글 상세 페이지는 인용 글 안의 외부 링크 카드 이미지를 생략하므로, RSS 본문에 있던 인용 글 이미지를 보충한다.
function feedQuoteMedia(feedHtml: string | null | undefined): string {
  if (!feedHtml) return '';
  const cut = feedHtml.search(/<hr\b/i);
  if (cut < 0) return '';
  const { document } = parseHTML(`<!doctype html><html><body>${feedHtml.slice(cut)}</body></html>`);
  const quote = document.querySelector('blockquote') as unknown as Element | null;
  if (!quote) return '';
  let html = '';
  for (const image of quote.querySelectorAll('img')) {
    const src = image.getAttribute('src') || '';
    if (!/^https:\/\/pbs\.twimg\.com\//i.test(src)) continue;
    html += `<a class="photo" href="${escape(src)}"><img src="${escape(src)}" alt="" loading="lazy"></a>`;
  }
  return html ? `<div class="media">${html}</div>` : '';
}

// 인용 상자 안의 작성자(b)나 링크(cite)를 제외하고 글 본문과 줄바꿈만 추출한다.
function quoteNodeText(element: Element | null): string {
  if (!element) return '';
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === 3) text += node.textContent || '';
    else if (node.nodeName === 'BR') text += '\n';
    else if (node.nodeName === 'B' || node.nodeName === 'CITE' || node.nodeName === 'IMG' || node.nodeName === 'FOOTER') { /* 제외 */ }
    else if (node.nodeType === 1) text += quoteNodeText(node as unknown as Element);
  }
  return text;
}

// 공개 미러가 긴 트윗을 140자~280자에서 잘라 보냈을 때, 피드 인용문에 있던 전체 글로 보충한다.
function feedQuoteText(feedHtml: string | null | undefined, statusUrl: string): string {
  if (!feedHtml) return '';
  const cut = feedHtml.search(/<hr\b/i);
  if (cut < 0) return '';
  const { document } = parseHTML(`<!doctype html><html><body>${feedHtml.slice(cut)}</body></html>`);
  const quote = document.querySelector('blockquote') as unknown as Element | null;
  if (!quote) return '';
  const href = quote.querySelector('cite a')?.getAttribute('href') || '';
  const match = /(?:https?:\/\/[^/]+)?\/([a-z\d_]{1,15})\/status\/(\d{1,20})/i.exec(href);
  const targetMatch = /(?:https?:\/\/[^/]+)?\/([a-z\d_]{1,15})\/status\/(\d{1,20})/i.exec(statusUrl);
  if (match && targetMatch && match[2] !== targetMatch[2]) return '';
  const paragraphs = [...quote.querySelectorAll('p')].map((p) => {
    let t = '';
    for (const node of (p as unknown as Element).childNodes) {
      if (node.nodeType === 3) t += node.textContent || '';
      else if (node.nodeName === 'BR') t += '\n';
      else if (node.nodeName === 'B' || node.nodeName === 'CITE' || node.nodeName === 'IMG' || node.nodeName === 'FOOTER') { /* 제외 */ }
    }
    return t.replace(/[ \t]*[\r\n]+[ \t]*/g, '\n').trim();
  }).filter(Boolean);
  if (paragraphs.length) return paragraphs.join('\n\n');
  return quoteNodeText(quote).replace(/[ \t]*[\r\n]+[ \t]*/g, '\n').trim();
}

// X의 외부 링크 카드 이미지(pbs.twimg.com/card_img/...)는 일주일이 지나면 새 주소로 바뀌고 예전 주소는 404가 된다.
// 그림이 깨졌을 때 공개 미러의 글 상세 페이지에서 현재 카드 이미지 주소를 받아와 본문과 썸네일을 갱신한다.
async function fetchXCardImage(url: string, db?: D1DatabaseLike): Promise<string | null> {
  const match = STATUS.exec(url);
  if (!match) return null;
  const [, username, id] = match;
  for (const provider of providers) {
    if (await restingUntil(provider, db) || (pageless.get(provider) || 0) > Date.now()) continue;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${provider}/${username}/status/${id}`, {
        headers: { Accept: 'text/html', 'User-Agent': 'FeedExRSS/1.0' }, redirect: 'manual', credentials: 'omit', signal: controller.signal,
      });
      if (response.status === 429) { await response.body?.cancel(); await restProvider(provider, response.headers.get('Retry-After'), db); continue; }
      if (!response.ok) { await response.body?.cancel(); continue; }
      const { document } = parseHTML(await readFeed(response, 3_000_000));
      const main = document.querySelector('.main-tweet .timeline-item') as unknown as Element | null;
      if (!main) {
        if (!document.querySelector('.error-panel')) pageless.set(provider, Date.now() + 3_600_000);
        continue;
      }
      const hosts = new Set([new URL(provider).hostname]);
      const cardImg = [...main.querySelectorAll('.card .card-image img')].find((node) => !node.matches('.quote *'))?.getAttribute('src') || null;
      if (!cardImg) return null;
      const mapped = originalUrl(cardImg.replace(/#m$/, ''), provider, hosts).replace(/#m$/, '');
      return /^https:\/\/pbs\.twimg\.com\//i.test(mapped) ? mapped : null;
    } catch { /* 다음 경로를 쓴다. */ }
    finally { clearTimeout(timer); }
  }
  return null;
}

export async function refreshXCardImages(url: string, contentHtml: string | null | undefined, db?: D1DatabaseLike): Promise<{ contentHtml: string; thumbnailUrl: string } | null> {
  if (!contentHtml || !/https:\/\/pbs\.twimg\.com\/card_img\//i.test(contentHtml)) return null;
  const quotedUrl = /<blockquote[\s\S]*?https:\/\/pbs\.twimg\.com\/card_img\/[\s\S]*?<cite>\s*<a[^>]+href="(https:\/\/x\.com\/[a-z\d_]{1,15}\/status\/\d{1,20})"/i.exec(contentHtml)?.[1];
  const fresh = await fetchXCardImage(quotedUrl || url, db);
  if (!fresh) return null;
  const updated = contentHtml.replace(/https:\/\/pbs\.twimg\.com\/card_img\/[^"'\s>]+/gi, escape(fresh));
  return { contentHtml: updated, thumbnailUrl: fresh };
}

type XThread = { html: string; url: string; thread: true; partial?: true };

/** `partial`은 답글인데 미러가 원글을 불러오지 못한 사본이다. 기기는 저장하지 않는다. */
export async function fetchXThread(url: string, feedHtml?: string | null, db?: D1DatabaseLike, feedTitle?: string): Promise<XThread> {
  const match = STATUS.exec(url);
  if (!match) throw new Error('X 글 주소가 아닙니다.');
  const [, username, id] = match;
  let partial: XThread | null = null;
  for (const provider of providers) {
    if (await restingUntil(provider, db) || (pageless.get(provider) || 0) > Date.now()) continue;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${provider}/${username}/status/${id}`, {
        headers: { Accept: 'text/html', 'User-Agent': 'FeedExRSS/1.0' }, redirect: 'manual', credentials: 'omit', signal: controller.signal,
      });
      if (response.status === 429) { await response.body?.cancel(); await restProvider(provider, response.headers.get('Retry-After'), db); continue; }
      if (!response.ok) { await response.body?.cancel(); continue; }
      const { document } = parseHTML(await readFeed(response, 3_000_000));
      const main = document.querySelector('.main-tweet .timeline-item') as unknown as Element | null;
      if (!main) {
        // 지워진 글 같은 안내 화면은 이 글만의 문제다. 봇 확인처럼 글이 아예 없는 화면이면 이 경로의 글 페이지는 한 시간 쓰지 않는다.
        if (!document.querySelector('.error-panel')) pageless.set(provider, Date.now() + 3_600_000);
        continue;
      }
      const page = document as unknown as Element;
      const missing = missingParent(page, main, /^R to @[a-z\d_]{1,15}:/i.test(feedTitle || ''));
      const result = { html: threadDocument(page, main, provider, url, feedHtml, missing), url, thread: true as const };
      // 답글인데 원글이 없으면 그 미러가 대화를 불러오지 못한 것이다. 다른 미러를 한 번 더 보고, 그래도 없으면 원글 없이 보여 준다.
      if (!missing) return result;
      partial ??= { ...result, partial: true };
    } catch { /* 다음 경로를 쓴다. */ }
    finally { clearTimeout(timer); }
  }
  if (partial) return partial;
  throw new Error('X 글 페이지를 받지 못했습니다.');
}

// 이 글 자신이 답글인데(인용한 글의 답글 표시가 아니라) 위쪽 대화에 글이 하나도 없다.
const missingParent = (document: Element, main: Element, feedReply: boolean) => (feedReply || [...main.querySelectorAll('.replying-to')].some((node) => !node.matches('.quote *')))
  && !document.querySelector('.main-thread .before-tweet .timeline-item .tweet-header');

// 화면에 보인 완성본을 번역에서 그대로 쓰되, 서버가 만들지 않은 HTML은 번역기에 보내지 않는다.
function threadProof(env: Env, url: string, html: string) {
  const key = env.X_SETTINGS_SECRET || env.JWT_SECRET;
  if (!key || key.length < 32 || html.length > 1_000_000) return;
  return createHmac('sha256', key).update(`feedex-x-translation-v1\n${url}\n${html}`).digest('base64url');
}

export function xThreadWithProof(env: Env, copy: XThread) {
  return copy.partial ? copy : { ...copy, translationProof: threadProof(env, copy.url, copy.html) };
}

export function verifiedXThread(env: Env, url: string, snapshot: unknown): string | undefined {
  if (!snapshot || typeof snapshot !== 'object' || !('html' in snapshot) || !('proof' in snapshot)) return;
  const { html, proof } = snapshot;
  if (typeof html !== 'string' || typeof proof !== 'string' || !/^[\w-]{43}$/.test(proof) || !html.includes(X_THREAD_MARK)) return;
  const expected = threadProof(env, url, html);
  if (expected && timingSafeEqual(Buffer.from(expected), Buffer.from(proof))) return html;
}

export function xThreadTranslationBody(html: string): string {
  const { document } = parseHTML(html);
  const main = document.querySelector('main');
  if (!main?.querySelector('article.post.main')) return '';
  main.querySelectorAll('.avatar, .mini, .stats, .replying, .more, .empty').forEach(node => node.remove());
  main.querySelectorAll('.who').forEach(node => node.setAttribute('translate', 'no'));
  for (const text of main.querySelectorAll('.text')) {
    if (text.querySelector('p')) continue;
    // Workers AI는 문단을 번역한다. 일반 X 글과 인용 글에도 문단을 만들어 준다.
    const paragraph = document.createElement('p');
    paragraph.innerHTML = text.innerHTML;
    text.replaceChildren(paragraph);
  }
  return main.innerHTML;
}

export function xThreadSummaryPosts(html: string) {
  const { document } = parseHTML(html);
  if (!document.querySelector('main > article.post.main')) return [];
  // 본 대화의 글만 고른다. 댓글은 별도 section 안에 있고 여기에는 포함되지 않는다.
  return [...document.querySelectorAll('main > article.post:is(.before, .main, .after)')].map(post => ({
    kind: post.classList.contains('main') ? 'selected' : post.classList.contains('before') ? 'before' : 'after',
    body: post.querySelector('.body > .text')?.innerHTML || '',
    quote: post.querySelector('.quote-post .text')?.innerHTML || '',
    author: post.querySelector('.body > .who > span')?.textContent?.trim() || '',
    quoteAuthor: post.querySelector('.quote-post .who > span')?.textContent?.trim() || '',
  } as const));
}

function threadDocument(document: Element, main: Element, provider: string, statusUrl: string, feedHtml: string | null | undefined, parentMissing: boolean): string {
  const hosts = new Set([new URL(provider).hostname]);
  const link = (value: string | null) => {
    if (!value) return null;
    const mapped = originalUrl(value.replace(/#m$/, ''), provider, hosts).replace(/#m$/, '');
    return /^https?:\/\//i.test(mapped) ? mapped : null;
  };
  // 글 본문은 글자·링크·줄바꿈만 남긴다. 인용 글은 상자 전체가 링크라 그 안의 링크는 글자로 둔다.
  // 링크 안에 링크를 넣으면 브라우저가 바깥 링크를 거기서 닫아, 나머지 글이 상자 밖으로 흘러나온다.
  const rich = (element: Element | null, inLink = false): string => {
    if (!element) return '';
    let html = '';
    for (const node of element.childNodes) {
      if (node.nodeType === 3) html += escape(node.textContent || '');
      else if (node.nodeName === 'BR') html += '<br>';
      else if (node.nodeName === 'A') {
        const href = link((node as unknown as Element).getAttribute('href'));
        html += !href ? escape(node.textContent || '') : inLink ? `<span class="link">${escape(node.textContent || '')}</span>` : `<a href="${escape(href)}">${escape(node.textContent || '')}</a>`;
      } else if (node.nodeType === 1) html += rich(node as unknown as Element, inLink);
    }
    return html;
  };
  // 인용한 글 안의 요소가 아니라 이 글 자신의 요소를 찾는다.
  const own = (item: Element, selector: string) => [...item.querySelectorAll(selector)].find((node) => !node.matches('.quote *')) || null;
  const media = (item: Element, href: string, container?: Element | null) => {
    const box = container || own(item, '.attachments');
    if (!box) return '';
    let html = '';
    for (const image of box.querySelectorAll('img')) {
      const src = link(image.getAttribute('src')), rawFull = link(image.parentElement?.getAttribute('href') || null);
      const full = rawFull && /^https:\/\/pbs\.twimg\.com\//i.test(rawFull) ? rawFull : src;
      if (src) html += `<a class="photo" href="${escape(full!)}"><img src="${escape(src)}" alt="" loading="lazy"></a>`;
    }
    for (const video of box.querySelectorAll('video')) {
      const poster = link(video.getAttribute('poster'));
      const source = link(video.getAttribute('src') || video.querySelector('source')?.getAttribute('src') || video.getAttribute('data-url'));
      html += xVideoHtml(source, poster, href, video.matches('video.gif'));
    }
    return html ? `<div class="media">${html}</div>` : '';
  };
  const card = (item: Element) => {
    const box = own(item, '.card');
    const href = link(box?.querySelector('.card-container')?.getAttribute('href') || null);
    if (!box || !href) return '';
    const image = link(box.querySelector('.card-image img')?.getAttribute('src') || null);
    const text = (selector: string) => escape(box.querySelector(selector)?.textContent?.trim() || '');
    return `<a class="card" href="${escape(href)}">${image ? `<img src="${escape(image)}" alt="" loading="lazy">` : ''}<span><strong>${text('.card-title')}</strong><small>${text('.card-description')}</small><em>${text('.card-destination')}</em></span></a>`;
  };
  const quote = (item: Element, kind: string) => {
    const box = item.querySelector('.quote');
    if (!box) return '';
    const href = link(box.querySelector('.quote-link')?.getAttribute('href') || null);
    const name = escape(box.querySelector('.fullname')?.textContent?.trim() || ''), user = escape(box.querySelector('.username')?.textContent?.trim() || '');
    const attachments = box.querySelector('.quote-media-container, .attachments');
    const avatar = link(box.querySelector('img.avatar')?.getAttribute('src') || null);
    const quoteMedia = (attachments ? media(box, href || statusUrl, attachments) : '') || (kind === 'main' ? feedQuoteMedia(feedHtml) : '');
    return `<div class="quote"><a class="quote-post" href="${escape(href || statusUrl)}"><span class="who">${avatar ? `<img class="mini" src="${escape(avatar)}" alt="" loading="lazy">` : ''}<b>${name}</b> <span>${user}</span></span><span class="text">${rich(box.querySelector('.quote-text'), true)}</span></a>${quoteMedia}</div>`;
  };
  const stats = (item: Element) => {
    const labels: Record<string, string> = { 'icon-comment': '댓글', 'icon-retweet': '재게시', 'icon-quote': '인용', 'icon-heart': '좋아요', 'icon-views': '조회' };
    const parts = [...item.querySelectorAll('.tweet-stats .tweet-stat')].flatMap((stat) => {
      const icon = [...stat.querySelectorAll('span')].map((span) => span.getAttribute('class') || '').find((name) => labels[name]);
      const count = stat.textContent?.trim();
      return icon && count ? [`${labels[icon]} ${escape(count)}`] : [];
    });
    return parts.length ? `<p class="stats">${parts.join(' · ')}</p>` : '';
  };
  const post = (item: Element, kind: string) => {
    const header = item.querySelector('.tweet-header');
    const avatar = link(header?.querySelector('img.avatar')?.getAttribute('src') || null);
    const name = escape(header?.querySelector('.fullname')?.textContent?.trim() || '');
    const user = escape(header?.querySelector('.username')?.textContent?.trim() || '');
    const date = header?.querySelector('.tweet-date a');
    const href = link(date?.getAttribute('href') || null) || statusUrl;
    const when = escape(kind === 'main' ? item.querySelector('.tweet-published')?.textContent?.trim() || date?.getAttribute('title') || '' : date?.textContent?.trim() || '');
    const replying = own(item, '.replying-to');
    const contentNode = own(item, '.tweet-content');
    let contentHtml = rich(contentNode);
    if (kind === 'main') {
      const feedQuote = feedQuoteText(feedHtml, statusUrl);
      const textOnly = contentNode?.textContent?.trim() || '';
      if (feedQuote && feedQuote.length > textOnly.length + 30) {
        const paragraphs = feedQuote.split(/\n{2,}/).filter(Boolean);
        contentHtml = paragraphs.length
          ? paragraphs.map((p) => `<p>${escape(p).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`).replace(/\n/g, '<br>')}</p>`).join('')
          : escape(feedQuote).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`).replace(/\n/g, '<br>');
      }
    }
    return `<article class="post ${kind}">${avatar ? `<img class="avatar" src="${escape(avatar)}" alt="" loading="lazy">` : '<span class="avatar"></span>'}<div class="body">`
      + `<p class="who"><b>${name}</b> <span>${user}</span> · <a href="${escape(href)}" title="${escape(date?.getAttribute('title') || '')}">${when}</a></p>`
      + (replying ? `<p class="replying">${rich(replying)}</p>` : '')
      + `<div class="text">${contentHtml}</div>${media(item, href)}${card(item)}${quote(item, kind)}${stats(item)}</div></article>`;
  };
  // "이전 답글 더 보기" 같은 칸은 글이 아니므로 뺀다.
  const items = (selector: string, kind: string) => [...document.querySelectorAll(selector)].filter((item) => item.querySelector('.tweet-header')).map((item) => post(item, kind)).join('');
  const replies = [...document.querySelectorAll('.replies .reply')].map((group) => `<div class="thread">${[...group.querySelectorAll('.timeline-item')].map((item) => post(item, 'reply')).join('')}</div>`).join('');
  const more = document.querySelector('.replies .show-more');
  const header = main.querySelector('.tweet-header');
  const title = escape(`${header?.querySelector('.fullname')?.textContent?.trim() || 'X'} (${header?.querySelector('.username')?.textContent?.trim() || ''}) X 글`);
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base href="${escape(statusUrl)}" target="_blank">${X_THREAD_MARK}<title>${title}</title><style>${X_THREAD_STYLE}${X_VIDEO_STYLE}</style></head><body><main>`
    + (parentMissing ? '<p class="empty parent-missing">공개 미러가 이 답글의 원글을 불러오지 못했어요. 위의 다시 시도를 누르거나 X에서 열어 보세요.</p>' : items('.main-thread .before-tweet .timeline-item', 'before')) + post(main, 'main') + items('.main-thread .after-tweet .timeline-item', 'after')
    + `<section class="replies"><h2>댓글</h2>${replies || '<p class="empty">아직 보이는 댓글이 없어요.</p>'}</section>`
    + `<p class="more"><a data-x-external href="${escape(statusUrl)}">${more ? '댓글 더 보기 · ' : ''}X에서 열기 (로그인한 상태로 보기·반응)</a></p>`
    + '</main></body></html>';
}
