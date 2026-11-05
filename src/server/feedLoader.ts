import type { Env } from './types';
import { fetchAndParseFeed, type ParsedFeed } from './rssParser';
import { analyseBuilderPage, builderListPageArticles, builderParsedFeed } from './rssBuilder';
import { saveFeedArticles, upsertFeedAndArticles } from './seedService';
import { xProfile } from '../shared/xFeed';
import { noteXFeed } from './xBackfill';

export interface StoredFeed { id: string; xml_url: string; builder_source_url: string | null; builder_selector: string | null; builder_title: string | null }
export const storedFeedColumns = 'f.id, f.xml_url, b.source_url AS builder_source_url, b.selector AS builder_selector, b.title AS builder_title';
export async function loadStoredFeed(env: Env, feed: StoredFeed) {
  const builder = feed.builder_source_url && feed.builder_selector ? { source_url: feed.builder_source_url, selector: feed.builder_selector, title: feed.builder_title || '' } : null;
  if (!builder) return fetchAndParseFeed(feed.xml_url);
  const analysis = await analyseBuilderPage(builder.source_url, env, builder.selector);
  return builderParsedFeed(analysis, builder.selector, feed.xml_url, builder.title);
}

// 워커 한 번의 실행은 연결을 여섯 개까지만 동시에 연다. 넘치면 줄을 서는데 피드별 제한 시간은 줄에서도
// 흐르므로, 한꺼번에 시작하면 받아 보지도 못한 피드가 실패로 남는다. 그래서 정한 수만큼만 차례로 받고,
// X는 제공자 한도에 맞춰 두 개씩, 브라우저 세션을 쓰는 웹사이트 피드는 하나씩 받는다.
const RSS_AT_ONCE = 4, X_AT_ONCE = 2, BUILDER_AT_ONCE = 1;
export interface RefreshProgress { done: number; inserted: number }
export async function refreshStoredFeeds(env: Env, feeds: StoredFeed[], progress: RefreshProgress = { done: 0, inserted: 0 }): Promise<number> {
  const refresh = async (feed: StoredFeed) => {
    try {
      const parsed = await loadStoredFeed(env, feed), result = await upsertFeedAndArticles(env.DB, parsed);
      progress.inserted += result.insertedCount;
      // X 계정의 예전 글 위치와 빠진 글 채우기는 새로고침 성공에 영향을 주지 않는다.
      if (parsed.xOlder) await noteXFeed(env.DB, result.feedId, parsed, result.insertedCount).catch(() => {});
      if (parsed.listPages && feed.builder_selector) progress.inserted += await fillBuilderGap(env, result.feedId, feed.builder_selector, parsed, result.insertedCount).catch(() => 0);
    } catch (error) {
      // 실패 기록을 못 남겨도 뒤에 남은 피드는 계속 받는다.
      await env.DB.prepare('UPDATE feeds SET last_error = ?, last_fetched_at = ? WHERE id = ?').bind(error instanceof Error ? error.message : 'Refresh failed', new Date().toISOString(), feed.id).run().catch(() => {});
    } finally { progress.done += 1; }
  };
  const inTurn = async (items: StoredFeed[], atOnce: number) => {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(atOnce, items.length) }, async () => { while (next < items.length) await refresh(items[next++]); }));
  };
  const builders = feeds.filter((feed) => feed.builder_source_url), others = feeds.filter((feed) => !feed.builder_source_url);
  await Promise.all([
    inTurn(others.filter((feed) => !xProfile(feed.xml_url)), RSS_AT_ONCE),
    inTurn(others.filter((feed) => xProfile(feed.xml_url)), X_AT_ONCE),
    inTurn(builders, BUILDER_AT_ONCE),
  ]);
  return progress.inserted;
}

// 웹사이트 목록의 첫 쪽이 모두 새 글이면 지난 새로고침과의 사이에 글이 더 올라온 것이다.
// 이미 받은 글이 나올 때까지 다음 쪽을 두 쪽까지 읽어 빠진 글을 채운다.
async function fillBuilderGap(env: Env, feedId: string, selector: string, parsed: ParsedFeed, insertedCount: number): Promise<number> {
  if (!insertedCount || insertedCount < parsed.articles.length) return 0;
  const stored = await env.DB.prepare('SELECT COUNT(*) AS count FROM articles WHERE feed_id=?').bind(feedId).first<{ count: number }>();
  if (Number(stored?.count || 0) <= insertedCount) return 0;
  const more = await builderListPageArticles(parsed.listPages!.slice(0, 2), selector, parsed.articles);
  return more.length ? (await saveFeedArticles(env.DB, feedId, more)).insertedCount : 0;
}

const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
export async function generatedRss(env: Env, id: string): Promise<Response> {
  const feed = await env.DB.prepare('SELECT f.* FROM feeds f JOIN rss_builders b ON b.feed_id = f.id WHERE b.id = ?').bind(id).first<{ id: string; title: string; html_url: string; xml_url: string; description: string | null }>();
  if (!feed) return new Response('RSS feed not found', { status: 404 });
  const rows = await env.DB.prepare('SELECT a.title,a.url,a.summary,a.published_at,d.source FROM articles a LEFT JOIN article_date_checks d ON d.article_id=a.id WHERE a.feed_id=? ORDER BY a.published_at DESC,a.id DESC LIMIT 50').bind(feed.id).all<{ title: string; url: string; summary: string | null; published_at: string; source: string }>();
  const items = (rows.results || []).map((article) => `<item><title>${escapeXml(article.title)}</title><link>${escapeXml(article.url)}</link><guid isPermaLink="true">${escapeXml(article.url)}</guid>${article.source !== 'collected' ? `<pubDate>${new Date(article.published_at).toUTCString()}</pubDate>` : ''}<description>${escapeXml(article.summary || '')}</description></item>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escapeXml(feed.title)}</title><link>${escapeXml(feed.html_url)}</link><description>${escapeXml(feed.description || '')}</description>${items}</channel></rss>`, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' } });
}
