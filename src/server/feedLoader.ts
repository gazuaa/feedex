import type { Env } from './types';
import { fetchAndParseFeed } from './rssParser';
import { analyseBuilderPage, builderParsedFeed } from './rssBuilder';
import { upsertFeedAndArticles } from './seedService';
import { xProfile } from '../shared/xFeed';

export interface StoredFeed { id: string; xml_url: string; builder_source_url: string | null; builder_selector: string | null; builder_title: string | null }
export const storedFeedColumns = 'f.id, f.xml_url, b.source_url AS builder_source_url, b.selector AS builder_selector, b.title AS builder_title';
export async function loadStoredFeed(env: Env, feed: StoredFeed) {
  const builder = feed.builder_source_url && feed.builder_selector ? { source_url: feed.builder_source_url, selector: feed.builder_selector, title: feed.builder_title || '' } : null;
  if (!builder) return fetchAndParseFeed(feed.xml_url);
  const analysis = await analyseBuilderPage(builder.source_url, env, builder.selector);
  return builderParsedFeed(analysis, builder.selector, feed.xml_url, builder.title);
}

// 일반 RSS 피드는 계속 동시에 새로고침하면서, 브라우저 세션은 제공자의 동시 실행 한도 안에서 쓴다.
export async function refreshStoredFeeds(env: Env, feeds: StoredFeed[]): Promise<number> {
  let inserted = 0;
  const refresh = async (feed: StoredFeed) => {
    try { const result = await upsertFeedAndArticles(env.DB, await loadStoredFeed(env, feed)); inserted += result.insertedCount; }
    catch (error) { await env.DB.prepare('UPDATE feeds SET last_error = ?, last_fetched_at = ? WHERE id = ?').bind(error instanceof Error ? error.message : 'Refresh failed', new Date().toISOString(), feed.id).run(); }
  };
  const xFeeds = feeds.filter((feed) => !feed.builder_source_url && xProfile(feed.xml_url));
  let nextX = 0;
  const refreshX = async () => { while (nextX < xFeeds.length) await refresh(xFeeds[nextX++]); };
  await Promise.all([
    ...feeds.filter((feed) => !feed.builder_source_url && !xProfile(feed.xml_url)).map(refresh),
    refreshX(), refreshX(),
    (async () => { for (const feed of feeds.filter((item) => item.builder_source_url)) await refresh(feed); })(),
  ]);
  return inserted;
}

const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
export async function generatedRss(env: Env, id: string): Promise<Response> {
  const feed = await env.DB.prepare('SELECT f.* FROM feeds f JOIN rss_builders b ON b.feed_id = f.id WHERE b.id = ?').bind(id).first<{ id: string; title: string; html_url: string; xml_url: string; description: string | null }>();
  if (!feed) return new Response('RSS feed not found', { status: 404 });
  const rows = await env.DB.prepare('SELECT a.title,a.url,a.summary,a.published_at,d.source FROM articles a LEFT JOIN article_date_checks d ON d.article_id=a.id WHERE a.feed_id=? ORDER BY a.published_at DESC,a.id DESC LIMIT 50').bind(feed.id).all<{ title: string; url: string; summary: string | null; published_at: string; source: string }>();
  const items = (rows.results || []).map((article) => `<item><title>${escapeXml(article.title)}</title><link>${escapeXml(article.url)}</link><guid isPermaLink="true">${escapeXml(article.url)}</guid>${article.source !== 'collected' ? `<pubDate>${new Date(article.published_at).toUTCString()}</pubDate>` : ''}<description>${escapeXml(article.summary || '')}</description></item>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escapeXml(feed.title)}</title><link>${escapeXml(feed.html_url)}</link><description>${escapeXml(feed.description || '')}</description>${items}</channel></rss>`, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' } });
}
