import type { Env } from './types';
import { FeedRequestError, fetchAndParseFeed, type ParsedFeed } from './rssParser';
import { analyseBuilderPage, builderListPageArticles, builderParsedFeed } from './rssBuilder';
import { saveFeedArticles, upsertFeedAndArticles } from './seedService';
import { xProfile } from '../shared/xFeed';
import { noteXFeed } from './xBackfill';
import { XFeedError } from './xFeed';

export interface StoredFeed { id: string; xml_url: string; builder_source_url: string | null; builder_selector: string | null; builder_title: string | null }
export const storedFeedColumns = 'f.id, f.xml_url, b.source_url AS builder_source_url, b.selector AS builder_selector, b.title AS builder_title';
export async function loadStoredFeed(env: Env, feed: StoredFeed) {
  const builder = feed.builder_source_url && feed.builder_selector ? { source_url: feed.builder_source_url, selector: feed.builder_selector, title: feed.builder_title || '' } : null;
  if (!builder) return fetchAndParseFeed(feed.xml_url, env.DB);
  const analysis = await analyseBuilderPage(builder.source_url, env, builder.selector);
  return builderParsedFeed(analysis, builder.selector, feed.xml_url, builder.title);
}

// 한 실행에서 동시에 연결하는 수를 여섯 개 이하로 유지한다.
const RSS_AT_ONCE = 4, X_AT_ONCE = 1, BUILDER_AT_ONCE = 1;
const MINUTE = 60_000;
export interface RefreshProgress { done: number; inserted: number; skipped?: number; xRateLimited?: boolean }

export async function refreshStoredFeeds(env: Env, feeds: StoredFeed[], progress: RefreshProgress = { done: 0, inserted: 0 }): Promise<number> {
  const collect = async (feed: StoredFeed, lease: number, failures: number) => {
    try {
      const parsed = await loadStoredFeed(env, feed);
      // 게시자가 피드 주소를 옮겨도 글은 기존 구독에 넣는다.
      const result = await upsertFeedAndArticles(env.DB, { ...parsed, xmlUrl: feed.xml_url });
      progress.inserted += result.insertedCount;
      if (parsed.xOlder) await noteXFeed(env.DB, result.feedId, parsed, result.insertedCount).catch(() => {});
      if (parsed.listPages && feed.builder_selector) {
        progress.inserted += await fillBuilderGap(env, result.feedId, feed.builder_selector, parsed, result.insertedCount).catch(() => 0);
      }
    } catch (error) {
      const xDelay = error instanceof XFeedError ? (error.retryAfter || 0) * 1000 : 0;
      if (xDelay) progress.xRateLimited = true;
      const upstreamDelay = error instanceof FeedRequestError ? error.retryDelayMs : xDelay;
      const delay = Math.max(upstreamDelay, Math.min(60, 5 * 2 ** Math.min(failures, 4)) * MINUTE);
      // 실패해도 마지막 성공 시각을 덮지 않는다.
      await env.DB.batch([
        env.DB.prepare(`UPDATE feeds SET last_error=? WHERE id=?
          AND EXISTS(SELECT 1 FROM feed_refresh_state WHERE feed_id=feeds.id AND lease_until=?)`)
          .bind(error instanceof Error ? error.message : '피드 수집 실패', feed.id, lease),
        env.DB.prepare('UPDATE feed_refresh_state SET retry_at=?,lease_until=0,failures=failures+1 WHERE feed_id=? AND lease_until=?')
          .bind(Date.now() + delay, feed.id, lease),
      ]);
      return;
    }
    await env.DB.prepare('UPDATE feed_refresh_state SET retry_at=0,lease_until=0,failures=0 WHERE feed_id=? AND lease_until=?').bind(feed.id, lease).run();
  };
  const skip = (count: number) => {
    progress.done += count;
    progress.skipped = (progress.skipped || 0) + count;
  };
  const refresh = async (feed: StoredFeed) => {
    const now = Date.now(), lease = now + 2 * MINUTE;
    try {
      // 수동과 정기 수집이 같은 피드를 동시에 받지 않게 한다.
      const claim = await env.DB.prepare(`INSERT INTO feed_refresh_state(feed_id,attempted_at,lease_until) VALUES(?,?,?)
        ON CONFLICT(feed_id) DO UPDATE SET attempted_at=excluded.attempted_at,lease_until=excluded.lease_until
        WHERE retry_at<=? AND feed_refresh_state.lease_until<=? RETURNING failures`)
        .bind(feed.id, new Date(now).toISOString(), lease, now, now).first<{ failures: number }>();
      if (!claim) { skip(1); return; }
      await collect(feed, lease, claim.failures);
    } catch (error) {
      console.error('피드 수집 상태 기록 실패:', error instanceof Error ? error.message : error);
    }
    progress.done++;
  };
  const inTurn = async (items: StoredFeed[], atOnce: number, stopped = () => false) => {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(atOnce, items.length) }, async () => {
      while (next < items.length && !stopped()) await refresh(items[next++]);
    }));
    if (next < items.length) skip(items.length - next);
  };
  const builders = feeds.filter((feed) => feed.builder_source_url), others = feeds.filter((feed) => !feed.builder_source_url);
  await Promise.all([
    inTurn(others.filter((feed) => !xProfile(feed.xml_url)), RSS_AT_ONCE),
    inTurn(others.filter((feed) => xProfile(feed.xml_url)), X_AT_ONCE, () => Boolean(progress.xRateLimited)),
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
