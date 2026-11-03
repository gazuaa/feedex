import { parseHTML } from 'linkedom';
import { originalUrl, providers, readFeed, restProvider, restingUntil } from './xFeed';
import { X_THREAD_MARK, X_THREAD_STYLE } from '../shared/xThreadStyle';
export { isXStatusUrl as xStatusUrl } from '../shared/xFeed';

// x.com은 로그인하지 않은 사람에게 댓글을 몇 개만 보여 주고, 다른 사이트의 프레임도 거부한다.
// 그래서 X 글의 웹 보기는 공개 Nitter 글 페이지를 받아 글·인용·첨부·댓글만 앱이 다시 짠 문서로 보여 준다.
// 글 페이지에 봇 확인을 거는 경로는 우회하지 않고 한동안 건너뛴다.
const STATUS = /^https:\/\/x\.com\/([a-z\d_]{1,15})\/status\/(\d{1,20})$/i;
const pageless = new Map<string, number>();
type Element = { querySelector(selector: string): Element | null; querySelectorAll(selector: string): Iterable<Element>; getAttribute(name: string): string | null; textContent: string | null; childNodes: Iterable<Node>; parentElement: Element | null; matches(selector: string): boolean };
type Node = { nodeType: number; nodeName: string; textContent: string | null };


const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function fetchXThread(url: string): Promise<{ html: string; url: string; thread: true }> {
  const match = STATUS.exec(url);
  if (!match) throw new Error('X 글 주소가 아닙니다.');
  const [, username, id] = match;
  for (const provider of providers) {
    if (restingUntil(provider) || (pageless.get(provider) || 0) > Date.now()) continue;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${provider}/${username}/status/${id}`, {
        headers: { Accept: 'text/html', 'User-Agent': 'SFeedRSS/1.0' }, redirect: 'manual', credentials: 'omit', signal: controller.signal,
      });
      if (response.status === 429) { restProvider(provider, response.headers.get('Retry-After')); await response.body?.cancel(); continue; }
      if (!response.ok) { await response.body?.cancel(); continue; }
      const { document } = parseHTML(await readFeed(response, 3_000_000));
      const main = document.querySelector('.main-tweet .timeline-item') as unknown as Element | null;
      if (!main) {
        // 지워진 글 같은 안내 화면은 이 글만의 문제다. 봇 확인처럼 글이 아예 없는 화면이면 이 경로의 글 페이지는 한 시간 쓰지 않는다.
        if (!document.querySelector('.error-panel')) pageless.set(provider, Date.now() + 3_600_000);
        continue;
      }
      return { html: threadDocument(document as unknown as Element, main, provider, `https://x.com/${username}/status/${id}`), url: `https://x.com/${username}/status/${id}`, thread: true };
    } catch { /* 다음 경로를 쓴다. */ }
    finally { clearTimeout(timer); }
  }
  throw new Error('X 글 페이지를 받지 못했습니다.');
}

function threadDocument(document: Element, main: Element, provider: string, statusUrl: string): string {
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
  const media = (item: Element, href: string) => {
    const box = own(item, '.attachments');
    if (!box) return '';
    let html = '';
    for (const image of box.querySelectorAll('img')) {
      const src = link(image.getAttribute('src')), full = link(image.parentElement?.getAttribute('href') || null) || src;
      if (src) html += `<a class="photo" href="${escape(full!)}"><img src="${escape(src)}" alt="" loading="lazy"></a>`;
    }
    for (const video of box.querySelectorAll('video')) {
      const poster = link(video.getAttribute('poster')), source = link(video.querySelector('source')?.getAttribute('src') || null);
      // GIF는 X 동영상 서버의 mp4라 바로 재생한다. 일반 동영상은 X에서 재생한다.
      if (source && /^https:\/\/video\.twimg\.com\//.test(source)) html += `<video src="${escape(source)}"${poster ? ` poster="${escape(poster)}"` : ''} autoplay muted loop playsinline></video>`;
      else if (poster) html += `<a class="photo video" href="${escape(href)}"><img src="${escape(poster)}" alt="" loading="lazy"><span>X에서 동영상 재생</span></a>`;
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
  const quote = (item: Element) => {
    const box = item.querySelector('.quote');
    if (!box) return '';
    const href = link(box.querySelector('.quote-link')?.getAttribute('href') || null);
    const name = escape(box.querySelector('.fullname')?.textContent?.trim() || ''), user = escape(box.querySelector('.username')?.textContent?.trim() || '');
    const images = [...box.querySelectorAll('.quote-media-container img, .attachments img')].map((image) => link(image.getAttribute('src'))).filter(Boolean);
    return `<a class="quote" href="${escape(href || statusUrl)}"><span class="who"><b>${name}</b> <span>${user}</span></span><span class="text">${rich(box.querySelector('.quote-text'), true)}</span>${images.map((src) => `<img src="${escape(src!)}" alt="" loading="lazy">`).join('')}</a>`;
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
    return `<article class="post ${kind}">${avatar ? `<img class="avatar" src="${escape(avatar)}" alt="" loading="lazy">` : '<span class="avatar"></span>'}<div class="body">`
      + `<p class="who"><b>${name}</b> <span>${user}</span> · <a href="${escape(href)}" title="${escape(date?.getAttribute('title') || '')}">${when}</a></p>`
      + (replying ? `<p class="replying">${rich(replying)}</p>` : '')
      + `<div class="text">${rich(own(item, '.tweet-content'))}</div>${media(item, href)}${card(item)}${quote(item)}${stats(item)}</div></article>`;
  };
  const items = (selector: string, kind: string) => [...document.querySelectorAll(selector)].map((item) => post(item, kind)).join('');
  const replies = [...document.querySelectorAll('.replies .reply')].map((group) => `<div class="thread">${[...group.querySelectorAll('.timeline-item')].map((item) => post(item, 'reply')).join('')}</div>`).join('');
  const more = document.querySelector('.replies .show-more');
  const header = main.querySelector('.tweet-header');
  const title = escape(`${header?.querySelector('.fullname')?.textContent?.trim() || 'X'} (${header?.querySelector('.username')?.textContent?.trim() || ''}) X 글`);
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><base href="${escape(statusUrl)}" target="_blank">${X_THREAD_MARK}<title>${title}</title><style>${X_THREAD_STYLE}</style></head><body><main>`
    + items('.main-thread .before-tweet .timeline-item', 'before') + post(main, 'main') + items('.main-thread .after-tweet .timeline-item', 'after')
    + `<section class="replies"><h2>댓글</h2>${replies || '<p class="empty">아직 보이는 댓글이 없어요.</p>'}</section>`
    + `<p class="more"><a href="${escape(statusUrl)}">${more ? '댓글 더 보기 · ' : ''}X에서 열기 (로그인한 상태로 보기·반응)</a></p>`
    + '</main></body></html>';
}
