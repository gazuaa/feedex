import { parseHTML } from 'linkedom';
import type { BuilderAnalysis, BuilderArticle, BuilderGroup, BuilderSite } from '../shared/rssBuilder';
import { normalizeFeedUrl } from '../shared/feedDiscovery';
import { revealLazyImages } from '../shared/lazyImages';
import { dropEmptySlots } from '../shared/emptySlots';
import { plainCopyStyles } from '../shared/copyStyles';
import { proxyPageAssets, type AssetProxy } from './pageAssets';
import { dropSidebars } from '../shared/sidebars';
import { dropConsentBanners } from '../shared/consentBanners';
import { PICK_SELECTOR, decodePick, extractPicked, type PickSelection } from '../shared/rssPicker';
import { parsePublicationDate } from './publicationDate';
import { decodeHtmlEntities } from './rssParser';
import type { ParsedArticle, ParsedFeed } from './rssParser';
import type { Env } from './types';

export function publicPageUrl(value: string): string {
  const normalized = normalizeFeedUrl(value);
  if (!normalized) throw new Error('올바른 공개 웹사이트 주소를 입력해 주세요.');
  const host = new URL(normalized).hostname.toLowerCase();
  if (!host.includes('.') || (/(?:^|\.)(?:localhost|local|internal|test)$/i.test(host) && !host.endsWith('.example.test')) || /^(?:\d+\.){3}\d+$/.test(host) || host.includes(':')) throw new Error('공개 웹사이트 주소만 사용할 수 있습니다.');
  return normalized;
}
const text = (value: string | null | undefined) => decodeHtmlEntities(value || '').replace(/\s+/g, ' ').trim();
const quoted = (value: string) => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
const skippedPath = /\/(?:tags?|category|categories|authors?|researchers|search|login|sign-?up|policy|privacy|terms)(?:\/|$)/i;
const fileExtension = /\.(?:png|jpe?g|gif|svg|pdf|zip|webp)$/i;

function articleUrl(href: string | null, source: URL): string | null {
  if (!href || href.startsWith('#')) return null;
  try {
    const url = new URL(href, source);
    if (!/^https?:$/.test(url.protocol) || url.origin !== source.origin || skippedPath.test(url.pathname) || fileExtension.test(url.pathname)) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    // 게시판은 2쪽부터 글 링크에도 목록의 쪽 번호(?page=2)를 붙인다. 떼지 않으면 같은 글이 쪽마다 다른 글이 된다.
    for (const [key, value] of source.searchParams) if (PAGE_PARAM.test(key) && url.searchParams.get(key) === value) url.searchParams.delete(key);
    if (url.href.replace(/\/$/, '') === source.href.replace(/\/$/, '') || url.pathname === '/') return null;
    return url.href;
  } catch { return null; }
}

type HtmlDocument = ReturnType<typeof parseHTML>['document'];

function pageTitle(document: HtmlDocument, source: URL): string {
  const title = text(document.querySelector('meta[property="og:title"]')?.getAttribute('content') || document.querySelector('title')?.textContent) || source.hostname;
  if (/security checkpoint|just a moment|verify you are human|access denied/i.test(title)) throw new Error('사이트가 자동 수집을 차단하고 있습니다. 보안 확인이 없는 공개 글 목록 주소를 사용해 주세요.');
  return title;
}

// 고르기용으로 보여 주는 페이지 사본과 나중에 서버가 뽑아 쓰는 페이지 모두에서
// 스크립트와 다른 동작 콘텐츠를 빼서 둘이 같게 한다.
function stripActiveContent(document: HtmlDocument) {
  document.querySelectorAll('script,noscript,iframe,frame,frameset,object,embed,applet,template,base,meta[http-equiv],link[rel~="preload"],link[rel~="modulepreload"],link[rel~="prefetch"]').forEach((node) => node.remove());
  for (const element of document.querySelectorAll('*')) {
    for (const { name, value } of Array.from(element.attributes) as Array<{ name: string; value: string }>) {
      if (/^on/i.test(name) || /^srcdoc$/i.test(name) || (/^(?:href|src|action|formaction|xlink:href)$/i.test(name) && /^\s*(?:javascript|vbscript|data:text\/html)/i.test(value))) element.removeAttribute(name);
    }
  }
}

const PICKABLE_LINKS = 5;

/** 클릭으로 고르기용 페이지의 정적 사본. 고를 것이 없으면 undefined. */
export function pickerSnapshot(html: string, pageUrl: string, assets?: AssetProxy): string | undefined {
  return pageCopy(html, pageUrl, { minLinks: PICKABLE_LINKS, assets });
}

/**
 * 프레임을 거부하는 사이트의 웹 보기 대체: 서버가 받은 페이지를 스크립트 없이
 * 샌드박스에서 보여 준다. 링크는 새 탭에서 열린다.
 */
export function webCopy(html: string, pageUrl: string, assets?: AssetProxy): string {
  return pageCopy(html, pageUrl, { linkTarget: '_blank', articleOnly: true, assets })!;
}

// `articleOnly`는 기사 옆 열을 뺀다. RSS 고르기 도구는 그 열의 링크도 고를 수 있으므로 남긴다.
// `assets`는 https 앱 안에서 막히는 http 그림·스타일을 앱이 대신 받는 주소로 바꾼다(pageAssets 참고).
function pageCopy(html: string, pageUrl: string, { minLinks = 0, linkTarget, articleOnly, assets }: { minLinks?: number; linkTarget?: string; articleOnly?: boolean; assets?: AssetProxy }): string | undefined {
  const { document } = parseHTML(html);
  stripActiveContent(document);
  if (document.querySelectorAll('a[href]').length < minLinks) return undefined;
  revealLazyImages(document);
  dropEmptySlots(document);
  dropConsentBanners(document);
  if (articleOnly) dropSidebars(document);
  plainCopyStyles(document);
  if (assets) proxyPageAssets(document, pageUrl, assets);
  const head = document.head || document.documentElement;
  const base = document.createElement('base');
  base.setAttribute('href', pageUrl);
  if (linkTarget) base.setAttribute('target', linkTarget);
  const charset = document.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  head.prepend(charset, base);
  return '<!doctype html>' + document.documentElement.outerHTML;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (value: string | number) => String(value).padStart(2, '0');

/** 목록 페이지에 찍힌 형태의 날짜: "2026.10.21 14:05", "2026년 10월 21일", "Oct 21, 2026", "3시간 전". */
export function parseListedDate(raw: string | null | undefined, now = Date.now()): string | null {
  const value = (raw || '').replace(/\s+/g, ' ').trim();
  if (!value) return null;
  const direct = parsePublicationDate(value);
  if (direct) return direct;
  const numeric = value.match(/(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?(?:\D{0,6}?(오전|오후|AM|PM)?\s*(\d{1,2}):(\d{2}))?/i);
  if (numeric) {
    let hour = numeric[5] ? Number(numeric[5]) : 0;
    if (/오후|pm/i.test(numeric[4] || '') && hour < 12) hour += 12;
    if (/오전|am/i.test(numeric[4] || '') && hour === 12) hour = 0;
    return parsePublicationDate(`${numeric[1]}-${pad(numeric[2])}-${pad(numeric[3])} ${pad(hour)}:${numeric[6] || '00'}`);
  }
  const named = value.match(/(?:(\d{1,2})\s+)?\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(\d{1,2})?(?:st|nd|rd|th)?,?\s+(\d{4})/i);
  if (named && (named[1] || named[3])) return parsePublicationDate(`${named[4]}-${pad(MONTHS.indexOf(named[2].toLowerCase()) + 1)}-${pad(named[1] || named[3])}`);
  const units: Record<string, number> = { 초: 1e3, second: 1e3, sec: 1e3, 분: 6e4, minute: 6e4, min: 6e4, 시간: 36e5, hour: 36e5, hr: 36e5, 일: 864e5, day: 864e5, 주: 6048e5, week: 6048e5 };
  const relative = value.match(/(\d+)\s*(초|분|시간|일|주)\s*전/) || value.match(/(\d+)\s*(second|sec|minute|min|hour|hr|day|week)s?\s+ago/i);
  if (relative) return new Date(now - Number(relative[1]) * units[relative[2].toLowerCase()]).toISOString();
  if (/^(?:방금|just now)/i.test(value)) return new Date(now).toISOString();
  if (/^(?:어제|yesterday)/i.test(value)) return new Date(now - 864e5).toISOString();
  return null;
}

function analysePicked(html: string, pageUrl: string, selector: string, pick: PickSelection & { rendered?: boolean }): BuilderAnalysis {
  const source = new URL(pageUrl);
  const { document } = parseHTML(html);
  const title = pageTitle(document, source);
  stripActiveContent(document);
  let picked;
  try { picked = extractPicked(document, pick, pageUrl); }
  catch { throw new Error('글 목록 선택이 올바르지 않습니다. 다시 선택해 주세요.'); }
  const now = Date.now();
  const articles: BuilderArticle[] = picked.slice(0, 100).map((item) => {
    const published = parseListedDate(item.dateText, now);
    return { title: item.title, url: item.url, summary: item.summary, thumbnailUrl: item.image, publishedAt: published || new Date(now).toISOString(), dateSource: published ? 'feed' : 'collected' };
  });
  return { sourceUrl: pageUrl, title, groups: articles.length ? [{ selector, label: 'pick', articles }] : [], rendered: Boolean(pick.rendered) };
}

/** "이 웹사이트로 피드 만들기" 카드의 이름과 설명. */
export async function builderSiteInfo(url: string): Promise<BuilderSite> {
  const source = publicPageUrl(url);
  try {
    const page = await fetchPage(source, 'text/html,application/xhtml+xml', 500_000);
    const { document } = parseHTML(page.html);
    const meta = (selector: string) => text(document.querySelector(selector)?.getAttribute('content')) || null;
    return { url: page.url, title: pageTitle(document, new URL(page.url)), description: meta('meta[name="description"]') || meta('meta[property="og:description"]') };
  } catch {
    return { url: source, title: new URL(source).hostname.replace(/^www\./, ''), description: null };
  }
}

export function analyseBuilderHtml(html: string, sourceUrl: string, selector?: string): BuilderAnalysis {
  const source = new URL(sourceUrl);
  const { document } = parseHTML(html);
  const title = pageTitle(document, source);
  document.querySelectorAll('script,style,noscript,template,nav,header,footer,aside,[role="navigation"]').forEach((node) => node.remove());
  if (selector && selector.length > 1000) throw new Error('글 목록 선택이 너무 깁니다.');
  let anchors;
  try { anchors = [...document.querySelectorAll(selector || 'a[href]')].slice(0, 600); }
  catch { throw new Error('글 목록 선택이 올바르지 않습니다. 다시 선택해 주세요.'); }
  const entries = new Map<string, { article: BuilderArticle; prefix: string; score: number }>();
  for (const node of anchors) {
    const anchor = node.tagName === 'A' ? node : node.querySelector('a[href]');
    if (!anchor) continue;
    const url = articleUrl(anchor.getAttribute('href'), source);
    if (!url) continue;
    const heading = anchor.querySelector('h1,h2,h3,h4');
    const articleTitle = text(heading?.textContent) || text(anchor.textContent) || text(anchor.getAttribute('title')) || text(anchor.querySelector('img')?.getAttribute('alt'));
    if (articleTitle.length < 7 || articleTitle.length > 350 || /^(?:더 보기|목록|read more|next page|previous|load more)$/i.test(articleTitle)) continue;
    const target = new URL(url);
    const prefix = target.search ? target.pathname + '?' : target.pathname.slice(0, target.pathname.lastIndexOf('/') + 1);
    const score = heading ? 3 : anchor.textContent?.trim() ? 2 : 1;
    if ((entries.get(url)?.score || 0) >= score) continue;
    let card = anchor.closest('article,li');
    if (!card) {
      let parent = anchor.parentElement;
      for (let depth = 0; parent && depth < 5; depth++, parent = parent.parentElement) {
        const sameGroup = [...parent.querySelectorAll('a[href]')].map((link) => articleUrl(link.getAttribute('href'), source)).filter((link) => link && new URL(link).pathname.startsWith(prefix));
        if (new Set(sameGroup).size > 1) break;
        card = parent;
        if (parent.querySelector('img,time') || /20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}/.test(parent.textContent || '')) break;
      }
    }
    const time = card?.querySelector('time');
    const dateText = (time && (time.getAttribute('datetime') || time.getAttribute('dateTime'))) || card?.querySelector('[itemprop="datePublished"]')?.getAttribute('content') || card?.textContent?.match(/\b20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}\b/)?.[0];
    const published = dateText ? parsePublicationDate(dateText.replace(/\./g, '-')) : null;
    const img = card?.querySelector('img');
    let thumbnailUrl: string | null = null;
    try { const src = img?.getAttribute('src') || img?.getAttribute('data-src'); if (src) { const u = new URL(src, source); if (/^https?:$/.test(u.protocol)) thumbnailUrl = u.href; } } catch {}
    entries.set(url, { prefix, score, article: { title: articleTitle, url, summary: text(card?.querySelector('p')?.textContent) || null, thumbnailUrl, publishedAt: published || new Date().toISOString(), dateSource: published ? 'feed' : 'collected' } });
  }
  const buckets = new Map<string, BuilderArticle[]>();
  for (const { article, prefix } of entries.values()) buckets.set(prefix, [...(buckets.get(prefix) || []), article]);
  const groups: BuilderGroup[] = [...buckets].filter(([, articles]) => selector ? articles.length > 0 : articles.length >= 2).map(([prefix, articles]) => ({
    selector: selector || `a[href^=${quoted(prefix)}], a[href^=${quoted(source.origin + prefix)}]`,
    label: prefix,
    articles: articles.slice(0, 40),
  })).sort((a, b) => {
    const score = (group: BuilderGroup) => group.articles.length + (group.label.startsWith(source.pathname.replace(/\/$/, '') + '/') ? 100 : 0);
    return score(b) - score(a);
  }).slice(0, 8);
  return { sourceUrl, title, groups, rendered: false };
}

export async function fetchPage(url: string, accept = 'text/html,application/xhtml+xml', limit = 2_000_000): Promise<{ html: string; url: string }> {
  let current = publicPageUrl(url);
  for (let i = 0; i < 5; i++) {
    const response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SFeed/1.0)', Accept: accept } });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) { current = publicPageUrl(new URL(response.headers.get('location')!, current).href); continue; }
    if (!response.ok) throw new Error(`사이트 응답 오류 (HTTP ${response.status})`);
    return { html: (await response.text()).slice(0, limit), url: current };
  }
  throw new Error('사이트 이동이 너무 많습니다.');
}

/** `phone`은 스크립트로 휴대폰 배치를 고르는 사이트를 위해 페이지를 휴대폰 폭으로 배치한다. */
export async function renderPage(url: string, env: Pick<Env, 'BROWSER'>, content: 'links' | 'article' = 'links', phone = false): Promise<{ html: string; url: string }> {
  if (!env.BROWSER) throw new Error('이 사이트는 브라우저 렌더링이 필요합니다.');
  const { default: puppeteer } = await import('@cloudflare/puppeteer');
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    if (phone) await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      try {
        publicPageUrl(request.url());
        if (['image', 'font', 'media'].includes(request.resourceType())) void request.abort(); else void request.continue();
      } catch { void request.abort(); }
    });
    // 기사 사본에 필요한 것은 읽을 수 있는 문단이지, 다 끝난 광고·분석 트래픽이 아니다.
    const response = await page.goto(publicPageUrl(url), { waitUntil: content === 'article' ? 'domcontentloaded' : 'networkidle2', timeout: 20000 });
    if (response && !response.ok()) throw new Error(`사이트 응답 오류 (HTTP ${response.status()})`);
    await page.waitForFunction(content === 'article'
      ? 'Array.from(document.querySelector("article, [itemprop=articleBody], main")?.querySelectorAll("p") || []).reduce((length, p) => length + (p.innerText || "").trim().length, 0) > 120'
      : 'document.querySelectorAll("a[href]").length >= 5', { timeout: content === 'article' ? 10000 : 5000 }).catch(() => {});
    return { html: (await page.content()).slice(0, 2_000_000), url: publicPageUrl(page.url()) };
  } finally { await browser.close(); }
}

// 자동 방문을 막는 사이트도 검색 엔진용 사이트맵은 내는 경우가 많다. 글 주소와
// lastmod 시각이면 새 글을 알아채기에 충분하다. 글 페이지는 닫혀 있으므로 제목은 주소에서 얻는다.
export const SITEMAP_SELECTOR = 'sitemap:';
const MAX_SITEMAP_FILES = 6;
const MAX_SITEMAP_ARTICLES = 100;
const sameSite = (url: URL, source: URL) => url.hostname.replace(/^www\./, '') === source.hostname.replace(/^www\./, '');

function xmlValue(block: string, tag: string): string | null {
  const value = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'))?.[1];
  return value ? decodeHtmlEntities(value.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '')).trim() : null;
}

async function readSitemaps(source: URL, prefix: string): Promise<Array<{ url: string; lastmod: string | null }>> {
  const queue: string[] = [];
  try {
    const robots = await fetchPage(`${source.origin}/robots.txt`, 'text/plain', 200_000);
    for (const [, listed] of robots.html.matchAll(/^\s*sitemap:\s*(\S+)/gim)) {
      try { const url = new URL(listed); if (sameSite(url, source)) queue.push(url.href); } catch {}
    }
  } catch {}
  if (!queue.length) queue.push(`${source.origin}/sitemap.xml`);
  const hints = prefix.split('/').filter((part) => part.length > 2);
  const visited = new Set<string>();
  const entries: Array<{ url: string; lastmod: string | null }> = [];
  while (queue.length && visited.size < MAX_SITEMAP_FILES) {
    const next = queue.shift()!;
    if (visited.has(next) || /\.gz$/i.test(next)) continue;
    visited.add(next);
    let xml: string;
    try { xml = (await fetchPage(next, 'application/xml,text/xml;q=0.9,*/*;q=0.8', 10_000_000)).html; } catch { continue; }
    for (const [, block] of xml.matchAll(/<url(?:\s[^>]*)?>([\s\S]*?)<\/url>/gi)) {
      const loc = xmlValue(block, 'loc');
      if (loc) entries.push({ url: loc, lastmod: xmlValue(block, 'lastmod') });
    }
    // 사이트맵 색인에서는 목록 경로 이름이 붙은 하위 사이트맵을 먼저 본다.
    const score = (loc: string) => hints.filter((hint) => loc.includes(hint)).length;
    const children = [...xml.matchAll(/<sitemap(?:\s[^>]*)?>([\s\S]*?)<\/sitemap>/gi)].map(([, block]) => xmlValue(block, 'loc')).filter((loc): loc is string => {
      try { return !!loc && sameSite(new URL(loc), source); } catch { return false; }
    });
    queue.push(...children.sort((a, b) => score(b) - score(a)));
  }
  return entries;
}

function slugTitle(url: URL): string {
  const segment = url.pathname.split('/').filter(Boolean).pop() || '';
  let words = segment;
  try { words = decodeURIComponent(segment); } catch {}
  // "lombard-s-roadmap"은 주소로 들어가며 아포스트로피를 잃었다.
  words = words.replace(/\.(?:s?html?|php|aspx?)$/i, '').replace(/[-_+]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/(\w) s(?= |$)/g, "$1's");
  return words ? words[0].toUpperCase() + words.slice(1) : url.hostname;
}

export async function analyseSitemap(sourceUrl: string, selector?: string): Promise<BuilderAnalysis> {
  const source = new URL(sourceUrl);
  const prefix = selector ? selector.slice(SITEMAP_SELECTOR.length) : source.pathname.replace(/\/?$/, '/');
  const seen = new Set<string>();
  const entries = (await readSitemaps(source, prefix)).flatMap((entry) => {
    try {
      const url = new URL(entry.url);
      url.hash = '';
      if (!/^https?:$/.test(url.protocol) || !sameSite(url, source) || !url.pathname.startsWith(prefix) || url.pathname === prefix || skippedPath.test(url.pathname) || fileExtension.test(url.pathname) || seen.has(url.href)) return [];
      seen.add(url.href);
      return [{ url, lastmod: entry.lastmod && !Number.isNaN(Date.parse(entry.lastmod)) ? entry.lastmod : null }];
    } catch { return []; }
  });
  // 분류 같은 목록 페이지에는 글과 달리 보통 lastmod가 없다.
  const withDate = entries.filter((entry) => entry.lastmod);
  const candidates = withDate.length * 2 >= entries.length ? withDate : entries;
  // 여러 항목에 같은 시각이 찍혀 있으면 글이 나온 때가 아니라 한꺼번에 옮긴 기록이다.
  const shared = new Map<string, number>();
  for (const { lastmod } of candidates) if (lastmod) shared.set(lastmod, (shared.get(lastmod) || 0) + 1);
  const trusted = (lastmod: string | null): lastmod is string => {
    if (!lastmod) return false;
    const count = shared.get(lastmod) || 0;
    return !((count >= 3 && lastmod.includes('T')) || count >= Math.max(10, candidates.length / 5));
  };
  const dated = candidates.filter((entry) => trusted(entry.lastmod)).sort((a, b) => Date.parse(b.lastmod!) - Date.parse(a.lastmod!));
  const articles: BuilderArticle[] = (dated.length ? dated.slice(0, MAX_SITEMAP_ARTICLES) : candidates.slice(0, 40)).map(({ url, lastmod }) => ({
    title: slugTitle(url),
    url: url.href,
    summary: null,
    thumbnailUrl: null,
    publishedAt: trusted(lastmod) ? new Date(lastmod).toISOString() : new Date().toISOString(),
    dateSource: trusted(lastmod) ? 'feed' : 'collected',
  }));
  const section = prefix.split('/').filter(Boolean).pop();
  return {
    sourceUrl: source.href,
    title: [source.hostname.replace(/^www\./, ''), section].filter(Boolean).join(' · '),
    groups: articles.length ? [{ selector: SITEMAP_SELECTOR + prefix, label: prefix, articles }] : [],
    rendered: false,
    fromSitemap: true,
  };
}

export async function analyseBuilderPage(url: string, env: Env, selector?: string, assets?: AssetProxy): Promise<BuilderAnalysis> {
  const source = publicPageUrl(url);
  if (selector?.startsWith(SITEMAP_SELECTOR)) return analyseSitemap(source, selector);
  if (selector?.startsWith(PICK_SELECTOR)) {
    const pick = decodePick(selector);
    if (!pick) throw new Error('선택한 글 목록 정보가 올바르지 않습니다. 다시 선택해 주세요.');
    const page = pick.rendered ? await renderPage(source, env) : await fetchPage(source);
    return { ...analysePicked(page.html, page.url, selector, pick), ...(pick.rendered ? {} : { nextPages: nextListPages(page.html, page.url, BUILDER_PAGES - 1) }) };
  }
  // 선택자가 없으면 만들기 도구의 첫 보기다. 목록을 찾지 못했어도 사람이 고를 수 있게
  // 페이지 사본을 함께 넣는다.
  const read = (page: { html: string; url: string }, rendered: boolean): BuilderAnalysis => {
    const result = { ...analyseBuilderHtml(page.html, page.url, selector), rendered };
    // 다음 쪽은 서버가 받은 정적 페이지로만 읽으므로, 브라우저로 그린 페이지에는 찾지 않는다.
    const pages = rendered ? {} : { nextPages: nextListPages(page.html, page.url, BUILDER_PAGES - 1) };
    if (selector) return { ...result, ...pages };
    return { ...result, ...pages, snapshot: pickerSnapshot(page.html, page.url, assets) };
  };
  let failure: unknown;
  let fallback: BuilderAnalysis | null = null;
  try {
    const result = read(await fetchPage(source), false);
    if (result.groups.length) return result;
    fallback = result;
  } catch (error) { failure = error; }
  if (env.BROWSER) {
    try {
      const result = read(await renderPage(source, env), true);
      if (result.groups.length || selector) return result;
      if (result.snapshot || !fallback?.snapshot) fallback = result;
      failure = undefined;
    } catch (error) { failure = new Error(error instanceof Error && /차단/.test(error.message) ? error.message : '사이트의 글 목록을 불러오지 못했습니다. 자동 수집을 허용하는 공개 페이지인지 확인해 주세요.'); }
  }
  if (!selector && !fallback?.snapshot) {
    const fromSitemap = await analyseSitemap(source).catch(() => null);
    if (fromSitemap?.groups.length) return fromSitemap;
  }
  if (fallback && (fallback.snapshot || !failure)) return fallback;
  if (failure) throw failure;
  return { sourceUrl: source, title: new URL(source).hostname, groups: [], rendered: false };
}

const builderArticles = (analysis: BuilderAnalysis, selector: string): ParsedArticle[] => (analysis.groups.find((item) => item.selector === selector)?.articles ?? [])
  .map((article) => ({ ...article, guid: article.url, contentHtml: article.summary ? `<p>${article.summary.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>` : null, author: null }));

export function builderParsedFeed(analysis: BuilderAnalysis, selector: string, xmlUrl: string, title?: string): ParsedFeed {
  const articles = builderArticles(analysis, selector);
  if (!articles.length) throw new Error('수집할 글 목록을 찾지 못했습니다. 다른 목록을 선택해 주세요.');
  return { xmlUrl, htmlUrl: analysis.sourceUrl, title: title?.trim() || analysis.title, description: 'RSS 빌더로 만든 웹사이트 글 목록', faviconUrl: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(analysis.sourceUrl).hostname)}&sz=64`, articles, ...(analysis.nextPages?.length ? { listPages: analysis.nextPages } : {}) };
}

/** 만들 때 받는 목록 쪽 수(첫 쪽 포함). 한 쪽은 대개 10~20개다. */
export const BUILDER_PAGES = 5;
// 쪽 번호로 흔히 쓰는 질의 이름. 다른 이름이어도 링크에 다음 두 쪽이 함께 있으면 쪽 번호로 본다.
const PAGE_PARAM = /^(?:page|p|pg|paged|pageno|page_no|pagenum|pageindex|cpage|curpage|currentpage|pn)$/i;

/**
 * 목록 아래의 쪽 번호 링크에서 다음 쪽들의 주소를 만든다. `?page=2`처럼 질의 값 하나만 다른 링크나
 * `/page/2` 같은 경로를 쓴다. 스크립트로 더 불러오는 목록처럼 쪽 주소가 없으면 빈 배열이다.
 */
export function nextListPages(html: string, pageUrl: string, count: number): string[] {
  const { document } = parseHTML(html);
  const base = new URL(pageUrl);
  const pathPage = (path: string) => /^(.*?)\/page\/(\d{1,5})(\/?)$/.exec(path);
  const baseMatch = pathPage(base.pathname);
  const basePath = (baseMatch ? baseMatch[1] : base.pathname).replace(/\/$/, '');
  const params = new Map<string, Set<number>>(), paths = new Set<number>();
  let slash = '';
  for (const anchor of document.querySelectorAll('a[href]')) {
    let url: URL;
    try { url = new URL(anchor.getAttribute('href') || '', base); } catch { continue; }
    if (url.origin !== base.origin) continue;
    const linked = pathPage(url.pathname);
    if (linked && linked[1].replace(/\/$/, '') === basePath && url.search === base.search) { paths.add(Number(linked[2])); slash ||= linked[3]; continue; }
    if (url.pathname !== base.pathname) continue;
    const changed = [...new Set([...url.searchParams.keys(), ...base.searchParams.keys()])].filter((key) => url.searchParams.get(key) !== base.searchParams.get(key));
    const value = changed.length === 1 ? url.searchParams.get(changed[0]) : null;
    if (!value || !/^\d{1,5}$/.test(value)) continue;
    params.set(changed[0], (params.get(changed[0]) ?? new Set()).add(Number(value)));
  }
  const pages = (current: number, make: (page: number) => string) => Array.from({ length: count }, (_, index) => make(current + index + 1));
  // 다음 쪽 링크가 있어야 하고, 흔한 이름이 아니면 그다음 쪽 링크도 있어야 쪽 번호로 본다(분류 번호 같은 값과 구분).
  const named = [...params].sort(([a], [b]) => Number(PAGE_PARAM.test(b)) - Number(PAGE_PARAM.test(a))).find(([name, values]) => {
    const current = Number(base.searchParams.get(name)) || 1;
    return values.has(current + 1) && (PAGE_PARAM.test(name) || values.has(current + 2));
  });
  if (named) {
    const [name] = named, current = Number(base.searchParams.get(name)) || 1;
    return pages(current, (page) => { const url = new URL(base); url.searchParams.set(name, String(page)); url.hash = ''; return url.href; });
  }
  const current = baseMatch ? Number(baseMatch[2]) : 1;
  if (paths.has(current + 1)) return pages(current, (page) => `${base.origin}${basePath}/page/${page}${slash}${base.search}`);
  return [];
}

/**
 * 목록의 다음 쪽들에서 같은 목록의 글을 더 받는다. 다음 쪽은 서버가 받은 정적 페이지로만 읽고,
 * 이미 받은 글만 나오거나 글이 없는 쪽에서 멈춘다. 날짜가 없는 글은 앞 쪽 글보다 아래에 놓이도록 시각을 조금씩 당긴다.
 */
export async function builderListPageArticles(pages: string[], selector: string, current: ParsedArticle[]): Promise<ParsedArticle[]> {
  const known = new Set(current.map((article) => article.guid)), found: ParsedArticle[] = [];
  const pick = selector.startsWith(PICK_SELECTOR) ? decodePick(selector) : null;
  if (selector.startsWith(SITEMAP_SELECTOR) || (selector.startsWith(PICK_SELECTOR) && !pick)) return [];
  let floor = Math.min(Date.now(), ...current.map((article) => Date.parse(article.publishedAt)).filter(Number.isFinite));
  for (const url of pages) {
    let articles: ParsedArticle[];
    try {
      const page = await fetchPage(url);
      articles = builderArticles(pick ? analysePicked(page.html, page.url, selector, pick) : analyseBuilderHtml(page.html, page.url, selector), selector);
    } catch { break; }
    const fresh = articles.filter((article) => !known.has(article.guid));
    if (!fresh.length) break;
    for (const article of fresh) {
      known.add(article.guid);
      if (article.dateSource === 'collected') article.publishedAt = new Date(floor -= 1000).toISOString();
      else floor = Math.min(floor, Date.parse(article.publishedAt) || floor);
      found.push(article);
    }
  }
  return found;
}
