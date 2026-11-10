import { parseHTML } from 'linkedom';
import { XMLParser } from 'fast-xml-parser';
import { analyseBuilderHtml, analysePicked, builderParsedFeed, nextListPages, publicPageUrl } from './rssBuilder';
import { decodePick } from '../shared/rssPicker';
import { parsePublicationDate } from './publicationDate';
import { parseXmlFeedContent, fetchAndParseFeed, decodeHtmlEntities, type ParsedArticle } from './rssParser';
import { fetchXOlderPage, type XOlderPage } from './xFeed';
import type { Env } from './types';

export type HistorySource = { kind: 'rss' | 'site' | 'html' | 'news-json' | 'x-start' | 'x-page'; url: string; selector?: string; offset?: number; params?: Record<string, string>; maxPages?: number; x?: XOlderPage };
export interface HistoryPage { articles: ParsedArticle[]; next: HistorySource | null; sourceLimit?: boolean; discovery?: boolean }
export class HistorySourceError extends Error { constructor(message: string, readonly retryAt: number | null = null) { super(message); } }
const sameSite = (a: string, b: string) => new URL(a).hostname.replace(/^www\./, '') === new URL(b).hostname.replace(/^www\./, '');
const plain = (value: string) => parseHTML(`<div>${decodeHtmlEntities(value)}</div>`).document.querySelector('div')?.textContent?.trim() || '';
const decoded = (value: unknown) => { const text = typeof value === 'string' || typeof value === 'number' ? String(value) : ''; try { return decodeURIComponent(text.replace(/\+/g, '%20').replace(/%(?![\da-f]{2})/gi, '%25')); } catch { return text; } };
export function canonicalHistoryUrl(value: string): string {
  const url = new URL(value); url.hash = ''; url.protocol = 'https:'; url.hostname = url.hostname.replace(/^www\./, '');
  for (const name of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid$|gclid$)/i.test(name)) url.searchParams.delete(name);
  url.searchParams.sort(); if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/$/, ''); return url.href;
}
export function historyUrlVariants(value: string): string[] {
  const original = new URL(value), normal = new URL(canonicalHistoryUrl(value)), result = new Set([original.href, normal.href]);
  for (const scheme of ['https:', 'http:']) for (const www of ['', 'www.']) { const next = new URL(normal); next.protocol = scheme; next.hostname = www + normal.hostname; result.add(next.href); if (!next.search && next.pathname !== '/' && !/\.[a-z0-9]+$/i.test(next.pathname)) { next.pathname += '/'; result.add(next.href); } }
  return [...result];
}
async function readPage(input: string, accept: string): Promise<{ text: string; url: string; links: string }> {
  let url = publicPageUrl(input);
  const signal = AbortSignal.timeout(12000);
  for (let hop = 0; hop < 5; hop++) {
    const response = await fetch(url, { redirect: 'manual', credentials: 'omit', signal, headers: { Accept: accept, 'User-Agent': 'Mozilla/5.0 (compatible; FeedEx/1.0)', ...(accept === 'application/json' ? { 'X-Requested-With': 'XMLHttpRequest', Referer: new URL('/news/articleList.html', url).href } : {}) } });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) { await response.body?.cancel(); url = publicPageUrl(new URL(response.headers.get('location')!, url).href); continue; }
    if (response.status === 429) {
      const wait = response.headers.get('Retry-After') || '', seconds = /^\d+$/.test(wait) ? Number(wait) : (Date.parse(wait) - Date.now()) / 1000;
      await response.body?.cancel(); throw new HistorySourceError('사이트의 요청 제한에 도달했습니다. 기다린 뒤 이어받을 수 있습니다.', Date.now() + Math.min(600, Math.max(30, Number.isFinite(seconds) ? seconds : 60)) * 1000);
    }
    if (!response.ok) { await response.body?.cancel(); throw new HistorySourceError(`과거 목록을 받지 못했습니다. (HTTP ${response.status})`); }
    const reader = response.body?.getReader(); if (!reader) throw new HistorySourceError('목록 응답이 비어 있습니다.');
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2_000_000) throw new HistorySourceError('사이트의 목록 응답이 너무 큽니다.'); chunks.push(value); } }
    finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    return { text: new TextDecoder().decode(bytes), url, links: response.headers.get('Link') || '' };
  }
  throw new HistorySourceError('사이트 이동이 너무 많습니다.');
}
function nextRss(text: string, url: string, header: string): string | null {
  const parsed = new XMLParser({ ignoreAttributes: false }).parse(text), channel = parsed.feed || parsed.rss?.channel || {};
  const listed = [channel.link, channel['atom:link']].flatMap(value => Array.isArray(value) ? value : value ? [value] : []);
  const values: string[] = listed.filter(link => link && typeof link === 'object' && /^(?:next|prev-archive)$/.test(link['@_rel'] || '')).map(link => link['@_href']);
  for (const match of header.matchAll(/<([^>]+)>\s*;\s*rel=["']?(?:next|prev-archive)["']?/gi)) values.push(match[1]);
  for (const value of values) try { const next = publicPageUrl(new URL(value, url).href); if (sameSite(next, url) && next !== url) return next; } catch { /* 공개된 같은 사이트의 다음 목록만 따른다. */ }
  if (/wordpress\.org/i.test(String(channel.generator?.['#text'] || channel.generator || ''))) { const next = new URL(url); next.searchParams.set('paged', String((Number(next.searchParams.get('paged')) || 1) + 1)); return next.href; }
  return null;
}
function archiveLink(html: string, url: string): string | null {
  const { document } = parseHTML(html), candidates: { url: string; score: number }[] = [];
  for (const a of document.querySelectorAll('a[href]')) try {
    const next = publicPageUrl(new URL(a.getAttribute('href')!, url).href), target = new URL(next), text = a.textContent?.trim() || '';
    if (!sameSite(next, url) || next === url || target.pathname === '/') continue;
    let score = /전체\s*기사|최신\s*뉴스|기사\s*더보기|all\s*(?:posts|articles)|archives?/i.test(text) ? 20 : 0;
    if (/articleList\.html$/i.test(target.pathname)) score += 15;
    if (/\/(?:archive|archives|blog|posts|articles|news)\/?$/i.test(target.pathname)) score += 10;
    if ([...target.searchParams.keys()].some(key => /section|serial|category|tag|search/i.test(key))) score -= 15;
    if (score > 0) candidates.push({ url: next, score });
  } catch { /* 목록 이외의 링크는 사용하지 않는다. */ }
  return candidates.sort((a, b) => b.score - a.score)[0]?.url || null;
}
/** ND 계열 언론사의 공개 더보기 형식. 스크립트는 실행하지 않고 선언된 숫자·문자 인자만 읽는다. */
function newsNext(html: string, url: string): HistorySource | null {
  if (!/articlePaging\.vars\.params\s*=/.test(html) || !/class=["'][^"']*list-btn-more/.test(html)) return null;
  const params: Record<string, string> = {};
  for (const [, key, value] of html.matchAll(/params\[['"]([a-z_]+)['"]\]\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*;/gi)) {
    if (!/^(?:view_type|total|list_per_page|page_per_page|page|list_page_limit|sc_[a-z_]+|box_idxno)$/.test(key)) continue;
    try { const text = value.startsWith('"') ? JSON.parse(value) : value.slice(1, -1); if (typeof text === 'string' && text.length <= 200) params[key] = text; } catch { /* 잘못된 선언은 버린다. */ }
  }
  if (!/^\d{1,9}$/.test(params.total || '') || !/^\d{1,3}$/.test(params.list_per_page || '')) return null;
  const size = Number(params.list_per_page); if (size < 1 || size > 100) return null;
  const page = Number(params.page || 1) + 1, maxPages = Math.min(500, Number(params.list_page_limit) || 500, Math.ceil(Number(params.total) / size));
  if (page > maxPages) return null;
  for (const key of ['sc_section_code', 'sc_sub_section_code', 'sc_serial_code', 'sc_area', 'sc_level', 'sc_article_type', 'sc_view_level', 'sc_sdate', 'sc_edate', 'sc_serial_number', 'sc_word', 'sc_word2', 'sc_andor', 'sc_order_by', 'sc_multi_code', 'sc_is_image', 'sc_is_movie', 'sc_user_name', 'box_idxno']) params[key] ||= '';
  params.page = String(page);
  return { kind: 'news-json', url: new URL('/news/ajaxArticlePaging.php', url).href, params, maxPages };
}
function htmlArticles(html: string, url: string, selector?: string): { articles: ParsedArticle[]; selector: string | undefined } {
  const analysis = analyseBuilderHtml(html, url, selector, 100), group = analysis.groups[0];
  if (!group) return { articles: [], selector };
  const parsed = builderParsedFeed(analysis, group.selector, url, analysis.title);
  const { document } = parseHTML(html);
  const details = new Map<string, { date: string | null; author: string | null }>();
  for (const link of document.querySelectorAll('a[href]')) try {
    const href = canonicalHistoryUrl(new URL(link.getAttribute('href')!, url).href), card = link.closest('li,article');
    const byline = card?.querySelector('.byline,[class*="date"],time');
    const explicit = card?.querySelector('time[datetime],[itemprop="datePublished"]');
    const explicitDate = parsePublicationDate(explicit?.getAttribute('datetime') || explicit?.getAttribute('content'));
    const match = byline?.textContent?.match(/20\d{2}[.\/-]\d{1,2}[.\/-]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/);
    if (explicitDate || match) details.set(href, { date: explicitDate || parsePublicationDate(match![0]), author: card?.querySelector('.byline .name')?.textContent?.trim() || null });
  } catch { /* 공통 목록 분석 결과를 사용한다. */ }
  for (const article of parsed.articles) { const detail = details.get(canonicalHistoryUrl(article.url)); if (detail?.date) { article.publishedAt = detail.date; article.dateSource = 'feed'; } if (detail?.author) article.author = detail.author; }
  return { articles: parsed.articles, selector: group.selector };
}
export async function readHistorySource(source: HistorySource, env: Env): Promise<HistoryPage> {
  if (source.kind === 'x-start') { const parsed = await fetchAndParseFeed(source.url, env.DB); return { articles: parsed.articles, next: parsed.xOlder ? { kind: 'x-page', url: source.url, x: parsed.xOlder } : null }; }
  if (source.kind === 'x-page') {
    const page = await fetchXOlderPage(source.url, source.x!, parseXmlFeedContent, env.DB);
    if (page === 'limited') throw new HistorySourceError('X 공개 피드 제공 경로가 쉬는 중입니다. 잠시 뒤 이어받아 주세요.', Date.now() + 60_000);
    if (page === 'failed') throw new HistorySourceError('X의 과거 글 목록을 받지 못했습니다. 잠시 뒤 이어받아 주세요.');
    return { articles: page.articles, next: page.older ? { ...source, x: page.older, offset: 0 } : null };
  }
  const pageUrl = source.params ? `${source.url}?${new URLSearchParams(source.params)}` : source.url;
  const page = await readPage(pageUrl, source.kind === 'rss' ? 'application/rss+xml,application/atom+xml,application/xml;q=0.9' : source.kind === 'news-json' ? 'application/json' : 'text/html');
  if (source.kind === 'rss') { const parsed = parseXmlFeedContent(page.text, page.url), next = nextRss(page.text, page.url, page.links); return { articles: parsed.articles, next: parsed.articles.length && next ? { kind: 'rss', url: next } : null }; }
  if (source.kind === 'news-json') {
    const json = JSON.parse(page.text); if (json.result !== 'success' || !Array.isArray(json.data)) throw new HistorySourceError('사이트의 과거 목록 형식이 바뀌었습니다.');
    const articles: ParsedArticle[] = json.data.slice(0, 100).flatMap((item: Record<string, unknown>) => {
      const id = String(item.idxno || ''); if (!/^\d{1,12}$/.test(id)) return [];
      const url = new URL(`/news/articleView.html?idxno=${id}`, source.url).href, title = plain(decoded(item.title)); if (!title) return [];
      const published = String(item.pub_date || ''), time = String(item.viewTime || '');
      const date = parsePublicationDate(/^\d{4}-\d{2}-\d{2}$/.test(published) && time && published === String(item.viewDate || '').replace(/\./g, '-') ? `${published} ${time}` : published) || parsePublicationDate(`${item.viewDate || ''} ${time}`);
      const image = decoded(item.default_img_url); let thumbnail: string | null = null; try { if (image) thumbnail = publicPageUrl(new URL(image, source.url).href); } catch { /* 그림이 없으면 사이트 로고를 쓴다. */ }
      return [{ guid: url, url, title, summary: plain(decoded(item.summary)) || null, author: plain(decoded(item.user_name)) || null, contentHtml: null, thumbnailUrl: thumbnail, publishedAt: date || new Date().toISOString(), dateSource: date ? 'feed' as const : 'collected' as const }];
    });
    const current = Number(source.params!.page), nextPage = current + 1, max = source.maxPages || 500;
    return { articles, next: articles.length && nextPage <= max ? { ...source, offset: 0, params: { ...source.params, page: String(nextPage) } } : null, sourceLimit: articles.length > 0 && nextPage > max };
  }
  if (source.kind === 'site' && new URL(page.url).pathname === '/') { const next = archiveLink(page.text, page.url); if (next) return { articles: [], next: { kind: 'html', url: next }, discovery: true }; }
  let parsed: { articles: ParsedArticle[]; selector: string | undefined };
  const pick = source.selector ? decodePick(source.selector) : null;
  if (source.selector?.startsWith('sitemap:')) throw new HistorySourceError('사이트맵 피드는 공개 기사 목록을 제공하는 사이트에서 과거 글을 가져올 수 있습니다.');
  if (pick && source.selector) {
    const analysis = analysePicked(page.text, page.url, source.selector, pick); const feed = builderParsedFeed(analysis, source.selector, source.url); parsed = { articles: feed.articles, selector: source.selector };
  } else parsed = htmlArticles(page.text, page.url, source.selector);
  let next = newsNext(page.text, page.url);
  if (!next) { const url = nextListPages(page.text, page.url, 1)[0]; if (url) next = { kind: 'html', url, selector: parsed.selector }; }
  if (!next) {
    const { document } = parseHTML(page.text), href = document.querySelector('a[rel~="next"],link[rel~="next"]')?.getAttribute('href');
    if (href) try { const url = publicPageUrl(new URL(href, page.url).href); if (sameSite(url, page.url)) next = { kind: 'html', url, selector: parsed.selector }; } catch { /* 다음 쪽이 공개 주소일 때만 사용한다. */ }
  }
  return { articles: parsed.articles, next };
}
