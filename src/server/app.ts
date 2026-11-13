import { Hono } from 'hono';
import { accountArticleBlocks, articleBlockCountFilter, changeArticleBlocks, ArticleBlockError } from './articleBlocks';
import { initialSyncCursor, readerDelta, savedCountsJoin, syncHead } from './readerSync';
import { countedTotal, feedCountsReady, storedTotalCount } from './feedCounts';
import { pausedAtColumn, pauseSupported, shownToSubscriber } from './feedPause';
import { DEFAULT_AUTO_REFRESH_MINUTES, validAutoRefresh } from '../shared/preferences';
import { cors } from 'hono/cors';
import type {
  Env,
  UserRecord,
  UserPreferences,
  FolderRecord,
  SubscriptionItem,
  ArticleItem,
} from './types';
import { parseExcludedFeeds, scopedExcludedFeeds } from '../shared/feedExclusions';
import { CURATED_FEEDS } from './curatedFeeds';
import type { OpmlFeed } from '../shared/opml';
import { normalizeFeedUrl } from '../shared/feedDiscovery';
import { xRoutes } from './xConnection';
import { feedHistoryRoutes } from './feedHistory';
import { providers as xProviders, XFeedError } from './xFeed';
import { mirrorStatuses, staleXAccounts } from './xMirrorHealth';
import { inheritXView, saveXView } from './xViews';
import { fetchXThread, refreshXCardImages, verifiedXThread, xStatusUrl, xThreadSummaryPosts, xThreadTranslationBody, xThreadWithProof } from './xThread';
import { isXProfileFeed } from '../shared/xFeed';
import { importOpmlFeed, OpmlSourceError } from './opmlImporter';
import { clearOpmlFailure, listOpmlFailures, recordOpmlFailure } from './opmlFailures';
import { fetchAndParseFeed, parseOpml, generateOpml, type ParsedFeed } from './rssParser';
import { READER_FALLBACK_MARK, readerBodyNeedsRefresh, realFullContent, scrapeFullArticle } from './readerScraper';
import { checkEmbeddable } from './framing';
import { fetchWebView } from './webView';
import { fetchPreviewImage } from './previewImage';
import { analyseBuilderPage, builderListPageArticles, builderParsedFeed, builderSiteInfo, fetchPage, publicPageUrl, webCopy } from './rssBuilder';
import { pageAssetProxy } from './pageAssets';
import { resolveXAvatars } from './xAvatars';
import { refreshStoredFeeds, storedFeedColumns, type RefreshProgress, type StoredFeed } from './feedLoader';
import { extractOriginalPublishedAt } from './publicationDate';
import { resolveArticlePublication, type PublicationArticle } from './articlePublication';
import { DEFAULT_SUMMARY_MODEL, summarizeArticleWithAI, summaryText } from './aiSummarizer';
import { isCurrentSummary } from '../shared/aiSummary';
import { clearDeepLKey, DeepLError, deeplProblem, deeplUsage, ensureTranslationTable, readDeepLKey, saveDeepLKey, sourceHash, translateArticle, TranslationError, validDeepLKey } from './translator';
import { canManageX } from './xSettings';
import {
  generateId,
  upsertFeedAndArticles,
} from './seedService';
import {
  DEFAULT_GOOGLE_CLIENT_ID,
  verifyGoogleToken,
} from './googleVerify';

type Variables = {
  user: UserRecord;
};

export const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('/api/*', cors());

const DEFAULT_PREFS: UserPreferences = {
  layout: 'magazine',
  theme: 'dark',
  unreadOnly: false,
  markReadOnScroll: false,
  autoRefreshMinutes: DEFAULT_AUTO_REFRESH_MINUTES,
};

// Feedly처럼, 이보다 오래된 글은 따로 표시하지 않는 한 읽은 글로 센다.
// 안 읽은 글 조회를 최근 글로 한정하면 피드에 몇 년 치 가져온 기록이 있어도 빠르다.
const UNREAD_WINDOW_DAYS = 30;
const unreadCutoff = () =>
  new Date(Date.now() - UNREAD_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

// 닫힌 쪽으로 실패한다: 빠른 로그인은 명시적으로 켰을 때만 동작한다 (vite 개발 서버나 .dev.vars)
function isQuickLoginEnabled(env: Env): boolean {
  return env.ALLOW_QUICK_LOGIN === 'true';
}

function parsePreferences(jsonStr: string | null | undefined): UserPreferences {
  if (!jsonStr) return { ...DEFAULT_PREFS };
  try {
    const parsed = JSON.parse(jsonStr);
    return {
      layout: ['magazine', 'cards', 'list'].includes(parsed.layout)
        ? parsed.layout
        : 'magazine',
      theme: parsed.theme === 'light' ? 'light' : 'dark',
      unreadOnly: Boolean(parsed.unreadOnly),
      markReadOnScroll: parsed.markReadOnScroll === true,
      autoRefreshMinutes: validAutoRefresh(parsed.autoRefreshMinutes) ? parsed.autoRefreshMinutes : DEFAULT_AUTO_REFRESH_MINUTES,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

async function createSessionForUser(db: Env['DB'], userId: string): Promise<string> {
  const token = `sfeed_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
  await db
    .prepare(
      `INSERT INTO sessions (token, user_id, expires_at, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .bind(token, userId, expiresAt, now.toISOString())
    .run();
  return token;
}

async function findOrCreateGoogleUser(
  db: Env['DB'],
  profile: { email: string; name: string; picture?: string | null; googleId?: string | null }
): Promise<UserRecord> {
  const now = new Date().toISOString();
  const email = profile.email.trim().toLowerCase();

  let user = await db
    .prepare('SELECT * FROM users WHERE email = ?')
    .bind(email)
    .first<UserRecord>();

  if (!user && profile.googleId) {
    user = await db
      .prepare('SELECT * FROM users WHERE google_id = ?')
      .bind(profile.googleId)
      .first<UserRecord>();
  }

  if (user) {
    await db
      .prepare(
        `UPDATE users
         SET name = COALESCE(?, name),
             picture = COALESCE(?, picture),
             google_id = COALESCE(?, google_id)
         WHERE id = ?`
      )
      .bind(profile.name || null, profile.picture || null, profile.googleId || null, user.id)
      .run();

    const updated = await db
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(user.id)
      .first<UserRecord>();
    return updated || user;
  }

  const userId = generateId('usr');
  const picture =
    profile.picture ||
    `https://api.dicebear.com/9.x/glass/svg?seed=${encodeURIComponent(email)}`;

  await db
    .prepare(
      `INSERT INTO users (id, email, name, picture, google_id, preferences_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      userId,
      email,
      profile.name || email.split('@')[0],
      picture,
      profile.googleId || null,
      JSON.stringify(DEFAULT_PREFS),
      now
    )
    .run();

  const created = await db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(userId)
    .first<UserRecord>();

  return created!;
}

// 공개 인증 설정 엔드포인트
app.get('/api/auth/config', (c) => {
  const clientId =
    c.env.GOOGLE_CLIENT_ID && !c.env.GOOGLE_CLIENT_ID.includes('your-google-oauth-client-id')
      ? c.env.GOOGLE_CLIENT_ID
      : DEFAULT_GOOGLE_CLIENT_ID;
  return c.json({
    googleClientId: clientId,
    workersAiAvailable: Boolean(c.env.AI),
    aiModel: c.env.AI_MODEL || DEFAULT_SUMMARY_MODEL,
    quickLoginEnabled: isQuickLoginEnabled(c.env),
  });
});

// Google Identity Services ID 토큰(credential) RS256 검증 엔드포인트 (MUUSED 방식)
app.post('/api/auth/google/credential', async (c) => {
  const body = await c.req.json<{ credential?: string }>();
  if (!body.credential) {
    return c.json({ error: 'Google credential 토큰이 필요합니다.' }, 400);
  }

  const payload = await verifyGoogleToken(body.credential, c.env.GOOGLE_CLIENT_ID);
  if (!payload) {
    return c.json({ error: '구글 로그인이 만료되었거나 올바르지 않습니다.' }, 401);
  }

  const user = await findOrCreateGoogleUser(c.env.DB, {
    email: payload.email,
    name: payload.name || payload.email.split('@')[0],
    picture: payload.picture,
    googleId: payload.sub,
  });

  const token = await createSessionForUser(c.env.DB, user.id);
  return c.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      preferences: parsePreferences(user.preferences_json),
    },
  });
});

// 빠른 Google 계정 로그인 (로컬 개발 전용 — 신원 확인 없음)
app.post('/api/auth/google/quick', async (c) => {
  if (!isQuickLoginEnabled(c.env)) {
    return c.json({ error: '빠른 로그인은 로컬 개발 환경에서만 사용할 수 있습니다.' }, 403);
  }

  const body = await c.req.json<{
    email?: string;
    name?: string;
    picture?: string;
  }>();

  const email = (body.email || 'demo@gmail.com').trim().toLowerCase();
  if (!email.includes('@')) {
    return c.json({ error: '올바른 이메일 주소를 입력해 주세요.' }, 400);
  }

  const name = (body.name || email.split('@')[0]).trim();
  const user = await findOrCreateGoogleUser(c.env.DB, {
    email,
    name,
    picture: body.picture || null,
    googleId: `google_${email}`,
  });

  const token = await createSessionForUser(c.env.DB, user.id);
  return c.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      preferences: parsePreferences(user.preferences_json),
    },
  });
});

// 맥 앱 로그인. 구글은 앱 안 웹 화면에서 하는 로그인을 막으므로, 맥 앱은 시스템 로그인 창(Safari)에서
// FeedEx에 로그인한다. 그 창이 1분짜리 일회용 코드를 받아 앱에 넘기고, 앱은 코드를 새 세션으로 바꾼다.
// 코드는 세션 표에 이 머리글로 남겨 두고 일반 API에는 쓰지 못하게 한다. 쓰면 세션처럼 1년으로 연장되기 때문이다.
const NATIVE_CODE_PREFIX = 'sfeed_code_';
const NATIVE_CODE_MS = 60_000;
const nativeCodePattern = /^sfeed_code_[0-9a-f]{64}$/;

app.post('/api/auth/native-code/redeem', async (c) => {
  const body = await c.req.json<{ code?: unknown }>().catch(() => ({} as { code?: unknown }));
  const code = typeof body.code === 'string' ? body.code : '';
  if (!nativeCodePattern.test(code)) return c.json({ error: '로그인 코드가 올바르지 않습니다.' }, 400);
  const now = new Date().toISOString();
  const row = await c.env.DB.prepare('SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?').bind(code, now).first<{ user_id: string }>();
  // 지우는 쪽이 한 번만 성공하므로 같은 코드를 두 번 바꿀 수 없다.
  const removed = row ? await c.env.DB.prepare('DELETE FROM sessions WHERE token = ? AND expires_at > ?').bind(code, now).run() : null;
  if (!row || Number(removed?.meta?.changes ?? 0) !== 1) return c.json({ error: '로그인 코드가 만료되었거나 이미 쓰였습니다. 다시 로그인해 주세요.' }, 401);
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(row.user_id).first<UserRecord>();
  if (!user) return c.json({ error: '계정을 찾지 못했습니다.' }, 401);
  const token = await createSessionForUser(c.env.DB, user.id);
  return c.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      preferences: parsePreferences(user.preferences_json),
    },
  });
});

// 보호된 /api/* 경로의 인증 미들웨어
app.use('/api/*', async (c, next) => {
  const path = c.req.path;
  if (path.startsWith('/api/auth/')) {
    return next();
  }

  const authHeader = c.req.header('Authorization') || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : c.req.query('token') || '';

  if (!token || token.startsWith(NATIVE_CODE_PREFIX)) {
    return c.json({ error: '인증이 필요합니다.' }, 401);
  }

  const sessionRow = await c.env.DB.prepare(
    `SELECT u.*, s.expires_at AS session_expires_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`
  )
    .bind(token, new Date().toISOString())
    .first<UserRecord & { session_expires_at: string }>();

  if (!sessionRow) {
    return c.json({ error: '세션이 만료되었거나 유효하지 않습니다.' }, 401);
  }

  // 활성 세션은 최대 6개월에 한 번만 연장한다. 기존 30일 세션은 다음 인증 요청 때
  // 올라가고, 취소된 세션은 취소된 채로 남는다.
  if (Date.parse(sessionRow.session_expires_at) < Date.now() + 180 * 86400_000) {
    await c.env.DB.prepare('UPDATE sessions SET expires_at=? WHERE token=? AND expires_at=?')
      .bind(new Date(Date.now() + 365 * 86400_000).toISOString(), token, sessionRow.session_expires_at).run();
  }

  c.set('user', sessionRow);
  return next();
});

app.get('/api/user/me', (c) => {
  const user = c.get('user');
  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      preferences: parsePreferences(user.preferences_json),
    },
  });
});

// 인용한 글·재게시한 글의 글쓴이 프로필 사진(xAvatars 참고).
app.post('/api/x/avatars', async (c) => {
  const body = await c.req.json<{ handles?: unknown }>().catch(() => null);
  return c.json(await resolveXAvatars(c.env.DB, body?.handles));
});

app.get('/api/user/article-blocks', (c) => {
  c.header('Cache-Control', 'no-store');
  const { rules, revision } = accountArticleBlocks(c.get('user').preferences_json);
  return c.json({ rules, revision });
});
app.put('/api/user/article-blocks', async (c) => {
  c.header('Cache-Control', 'no-store');
  if (Number(c.req.header('Content-Length')) > 400_000) return c.json({ error: '규칙 요청이 너무 큽니다.' }, 413);
  try {
    const text = await c.req.text();
    if (text.length > 400_000) return c.json({ error: '규칙 요청이 너무 큽니다.' }, 413);
    const { rules, revision } = await changeArticleBlocks(c.env.DB, c.get('user').id, JSON.parse(text));
    return c.json({ rules, revision });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof ArticleBlockError) return c.json({ error: error instanceof ArticleBlockError ? error.message : '규칙 요청을 확인해 주세요.' }, 400);
    throw error;
  }
});

// This account filter is stored separately from device UI preferences.
app.get('/api/user/feed-exclusions', (c) => {
  c.header('Cache-Control', 'no-store');
  let value: unknown;
  try { value = JSON.parse(c.get('user').preferences_json || '{}').excludedFeedIds; } catch { /* Legacy preferences. */ }
  return c.json({ feedIds: parseExcludedFeeds(value) });
});
app.put('/api/user/feed-exclusions', async (c) => {
  c.header('Cache-Control', 'no-store');
  const text = await c.req.text();
  if (text.length > 220_000) return c.json({ error: '피드 목록이 너무 큽니다.' }, 413);
  let value: unknown;
  try { value = JSON.parse(text).feedIds; } catch { return c.json({ error: '피드 목록을 확인해 주세요.' }, 400); }
  if (!Array.isArray(value)) return c.json({ error: '피드 목록을 확인해 주세요.' }, 400);
  const feedIds = parseExcludedFeeds(value);
  await c.env.DB.prepare(`UPDATE users SET preferences_json = json_set(CASE WHEN json_valid(preferences_json) THEN preferences_json ELSE '{}' END, '$.excludedFeedIds', json(?)) WHERE id = ?`)
    .bind(JSON.stringify(feedIds), c.get('user').id).run();
  return c.json({ feedIds });
});

app.put('/api/user/preferences', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<Partial<UserPreferences>>();
  const current = parsePreferences(user.preferences_json);
  const nextPrefs: UserPreferences = {
    layout:
      body.layout && ['magazine', 'cards', 'list'].includes(body.layout)
        ? body.layout
        : current.layout,
    theme: body.theme === 'light' || body.theme === 'dark' ? body.theme : current.theme,
    unreadOnly:
      typeof body.unreadOnly === 'boolean' ? body.unreadOnly : current.unreadOnly,
    markReadOnScroll: typeof body.markReadOnScroll === 'boolean' ? body.markReadOnScroll : current.markReadOnScroll,
    autoRefreshMinutes: validAutoRefresh(body.autoRefreshMinutes) ? body.autoRefreshMinutes : current.autoRefreshMinutes,
  };

  await c.env.DB.prepare("UPDATE users SET preferences_json = json_patch(CASE WHEN json_valid(preferences_json) THEN preferences_json ELSE '{}' END, json(?)) WHERE id = ?")
    .bind(JSON.stringify(nextPrefs), user.id)
    .run();

  return c.json({ preferences: nextPrefs });
});

// 로그인한 사람이 맥 앱에 넘길 일회용 코드를 받는다. 쓰지 않고 지난 코드는 이때 함께 지운다.
app.post('/api/user/native-code', async (c) => {
  const user = c.get('user');
  const now = new Date();
  await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token LIKE 'sfeed\\_code\\_%' ESCAPE '\\' AND expires_at <= ?").bind(user.id, now.toISOString()).run();
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const code = `${NATIVE_CODE_PREFIX}${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  await c.env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(code, user.id, new Date(now.getTime() + NATIVE_CODE_MS).toISOString(), now.toISOString()).run();
  return c.json({ code });
});

app.post('/api/user/logout', async (c) => {
  const authHeader = c.req.header('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (token) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  }
  return c.json({ success: true });
});

// 처음 받는 데이터에 전체 개수와 안 읽은 개수를 함께 넣어 필터를 바로 바꿀 수 있게 한다.
app.get('/api/bootstrap', async (c) => {
  const user = c.get('user');
  const blocks = accountArticleBlocks(user.preferences_json);
  const syncCursor = await initialSyncCursor(c.env.DB, user.id, blocks.revision);
  const { cte, params, visible, affected } = await articleBlockCountFilter(c.env.DB, user.id, blocks.rules);
  const paused = await pauseSupported(c.env.DB);
  // 피드별 글 수를 저장해 둔 값으로 전체 개수를 낸다. 준비되지 않았으면 예전처럼 직접 센다.
  const totalShape = { shown: shownToSubscriber(paused), visible, affected, pausedAt: pausedAtColumn(paused) };
  const totalCount = await feedCountsReady(c.env.DB) ? storedTotalCount(totalShape) : countedTotal(totalShape);

  const foldersRes = await c.env.DB.prepare(
    `SELECT * FROM folders WHERE user_id = ? ORDER BY sort_order ASC, name ASC`
  )
    .bind(user.id)
    .all<FolderRecord>();

  const subsRes = await c.env.DB.prepare(
    `${cte} SELECT
       s.id,
       s.feed_id,
       s.folder_id,
       s.custom_title,
       ${pausedAtColumn(paused)} AS paused_at,
       f.xml_url,
       f.html_url,
       COALESCE(s.custom_title, f.title) as title,
       f.description,
       f.favicon_url,
       f.last_fetched_at,
       f.last_error,
       (SELECT b.id FROM rss_builders b WHERE b.feed_id=s.feed_id AND b.created_by=s.user_id) AS builder_id,
       (
         SELECT COUNT(*)
         FROM articles a
         LEFT JOIN article_states st ON st.article_id = a.id AND st.user_id = s.user_id
         WHERE a.feed_id = f.id AND a.published_at >= ? AND COALESCE(st.is_read, 0) = 0 AND ${shownToSubscriber(paused)} AND ${visible}
       ) as unread_count,
       ${totalCount} as total_count,
       COALESCE(saved.saved_count,0) as saved_count,
       (SELECT v.view_mode FROM feed_view_modes v WHERE v.user_id = s.user_id AND v.feed_id = s.feed_id) as view_mode
     FROM subscriptions s
     JOIN feeds f ON f.id = s.feed_id
     ${savedCountsJoin(visible)}
     WHERE s.user_id = ?
     ORDER BY title ASC`
  )
    .bind(...params, unreadCutoff(), user.id, user.id)
    .all<SubscriptionItem>();

  const subscriptions = (subsRes.results || []).map((s) => ({
    ...s,
    unread_count: Number(s.unread_count || 0),
    total_count: Number(s.total_count || 0),
    saved_count: Number(s.saved_count || 0),
  }));

  const totalUnread = subscriptions.reduce((sum, s) => sum + s.unread_count, 0);
  const totalArticles = subscriptions.reduce((sum, s) => sum + s.total_count, 0);

  const savedCount = subscriptions.reduce((sum, s) => sum + s.saved_count, 0);

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const todayRow = await c.env.DB.prepare(
    `${cte} SELECT COUNT(*) as cnt,
            COALESCE(SUM(CASE WHEN COALESCE(st.is_read, 0) = 0 THEN 1 ELSE 0 END), 0) as unread
     FROM articles a
     JOIN subscriptions s ON s.feed_id = a.feed_id
     LEFT JOIN article_states st ON st.article_id = a.id AND st.user_id = s.user_id
     WHERE s.user_id = ? AND a.published_at >= ? AND ${shownToSubscriber(paused)} AND ${visible}`
  )
    .bind(...params, user.id, twentyFourHoursAgo)
    .first<{ cnt: number; unread: number }>();

  return c.json({
    syncCursor,
    folders: foldersRes.results || [],
    subscriptions,
    counts: {
      totalUnread,
      totalArticles,
      savedCount,
      todayCount: Number(todayRow?.unread || 0),
      todayTotal: Number(todayRow?.cnt || 0),
    },
    curatedFeeds: CURATED_FEEDS,
  });
});

app.route('/api/x', xRoutes);
app.route('/api/feeds', feedHistoryRoutes);

function feedPreviewResponse(parsed: ParsedFeed) {
  return {
    feed: { title: parsed.title, xmlUrl: parsed.xmlUrl, htmlUrl: parsed.htmlUrl && /^https?:\/\//i.test(parsed.htmlUrl) ? parsed.htmlUrl : null, description: parsed.description },
    articles: parsed.articles
      .filter((article) => /^https?:\/\//i.test(article.url))
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
      .slice(0, 10)
      .map((article) => ({ title: article.title, url: article.url, summary: article.summary, publishedAt: article.publishedAt, dateSource: article.dateSource })),
  };
}

// 두 미리 보기는 읽기 전용이다. 폴더·피드·글·구독을 절대 만들지 않는다.
app.post('/api/discover/preview', async (c) => {
  const body = await c.req.json<{ url?: unknown }>().catch(() => null);
  const url = typeof body?.url === 'string' ? normalizeFeedUrl(body.url) : null;
  if (!url) return c.json({ error: '올바른 RSS 또는 웹사이트 주소를 입력해 주세요.' }, 400);
  try {
    return c.json(feedPreviewResponse(await fetchAndParseFeed(url, c.env.DB)));
  } catch (error) {
    if (error instanceof XFeedError) return c.json({ error: error.message }, 502);
    return c.json({ error: '피드를 찾지 못했습니다. RSS 주소와 연결 상태를 확인한 뒤 다시 시도해 주세요.' }, 502);
  }
});

app.post('/api/rss-builder/analyse', async (c) => {
  const body = await c.req.json<{ url?: string }>().catch(() => null);
  if (typeof body?.url !== 'string') return c.json({ error: '웹사이트 주소를 입력해 주세요.' }, 400);
  try { publicPageUrl(body.url); } catch (error) { return c.json({ error: (error as Error).message }, 400); }
  try {
    const analysis = await analyseBuilderPage(body.url, c.env, undefined, pageAssetProxy(c.env, new URL(c.req.url).origin));
    if (!analysis.groups.length && !analysis.snapshot) return c.json({ error: '반복되는 글 목록을 찾지 못했습니다. 개별 글이 아닌 블로그·뉴스 목록 주소를 입력해 주세요.' }, 422);
    return c.json(analysis);
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : '글 목록을 분석하지 못했습니다.' }, 502); }
});

app.post('/api/rss-builder/site', async (c) => {
  const body = await c.req.json<{ url?: string }>().catch(() => null);
  if (typeof body?.url !== 'string') return c.json({ error: '웹사이트 주소를 입력해 주세요.' }, 400);
  try { publicPageUrl(body.url); } catch (error) { return c.json({ error: (error as Error).message }, 400); }
  return c.json(await builderSiteInfo(body.url));
});

app.post('/api/rss-builder', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ url?: string; selector?: string; title?: string; folderId?: string; folderName?: string }>().catch(() => null);
  if (typeof body?.url !== 'string' || typeof body.selector !== 'string' || !body.selector.trim() || body.selector.length > 2000 || (body.title != null && typeof body.title !== 'string') || (body.folderName != null && typeof body.folderName !== 'string') || (body.folderId != null && typeof body.folderId !== 'string')) return c.json({ error: '웹사이트 주소와 수집할 글 목록을 선택해 주세요.' }, 400);
  try { publicPageUrl(body.url); } catch (error) { return c.json({ error: (error as Error).message }, 400); }
  let folderId = body.folderId || null;
  if (folderId && !await c.env.DB.prepare('SELECT id FROM folders WHERE id=? AND user_id=?').bind(folderId, user.id).first()) return c.json({ error: '폴더를 찾을 수 없습니다.' }, 404);
  try {
    const analysis = await analyseBuilderPage(body.url, c.env, body.selector);
    const existing = await c.env.DB.prepare('SELECT b.id,f.xml_url FROM rss_builders b JOIN feeds f ON f.id=b.feed_id WHERE b.created_by=? AND b.source_url=? AND b.selector=?').bind(user.id, analysis.sourceUrl, body.selector).first<{ id: string; xml_url: string }>();
    const id = existing?.id || generateId('rss');
    const rssUrl = existing?.xml_url || `${new URL(c.req.url).origin}/rss/${id}.xml`;
    const title = body.title?.trim().slice(0, 200) || analysis.title;
    const parsed = builderParsedFeed(analysis, body.selector, rssUrl, title);
    // 목록이 여러 쪽이면 만들 때 예전 글도 몇 쪽 더 받아 둔다.
    if (parsed.listPages) parsed.articles.push(...await builderListPageArticles(parsed.listPages, body.selector, parsed.articles));
    const { feedId, insertedCount } = await upsertFeedAndArticles(c.env.DB, parsed);
    await c.env.DB.prepare('INSERT INTO rss_builders(id,feed_id,source_url,selector,title,created_by,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title').bind(id, feedId, analysis.sourceUrl, body.selector, title, user.id, new Date().toISOString()).run();
    if (!folderId && body.folderName?.trim()) {
      const name = body.folderName.trim().slice(0, 100);
      const folder = await c.env.DB.prepare('SELECT id FROM folders WHERE user_id=? AND name=?').bind(user.id, name).first<{ id: string }>();
      folderId = folder?.id || generateId('fld');
      if (!folder) await c.env.DB.prepare('INSERT INTO folders(id,user_id,name,color,sort_order,created_at) VALUES(?,?,?,?,?,?)').bind(folderId, user.id, name, '#10b981', 10, new Date().toISOString()).run();
    }
    await c.env.DB.prepare('INSERT INTO subscriptions(id,user_id,feed_id,folder_id,custom_title,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,feed_id) DO UPDATE SET folder_id=COALESCE(excluded.folder_id,subscriptions.folder_id),custom_title=excluded.custom_title').bind(generateId('sub'), user.id, feedId, folderId, title, new Date().toISOString()).run();
    return c.json({ rssUrl, feedId, title, insertedCount });
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'RSS 피드를 만들지 못했습니다.' }, 502); }
});

// RSS 빌더로 만든 피드를 다시 열어 고친다. 만든 사람만 바꿀 수 있고, 피드 주소와 받은 글은 그대로 둔다.
app.get('/api/rss-builder/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT id,source_url,selector,title FROM rss_builders WHERE id=? AND created_by=?').bind(c.req.param('id'), c.get('user').id).first<{ id: string; source_url: string; selector: string; title: string }>();
  return row ? c.json({ id: row.id, sourceUrl: row.source_url, selector: row.selector, title: row.title }) : c.json({ error: '고칠 수 있는 RSS 빌더 피드가 아닙니다.' }, 404);
});

app.put('/api/rss-builder/:id', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ url?: string; selector?: string; title?: string }>().catch(() => null);
  if (typeof body?.url !== 'string' || typeof body.selector !== 'string' || !body.selector.trim() || body.selector.length > 2000 || (body.title != null && typeof body.title !== 'string')) return c.json({ error: '웹사이트 주소와 수집할 글 목록을 선택해 주세요.' }, 400);
  try { publicPageUrl(body.url); } catch (error) { return c.json({ error: (error as Error).message }, 400); }
  const builder = await c.env.DB.prepare('SELECT b.id,b.feed_id,f.xml_url FROM rss_builders b JOIN feeds f ON f.id=b.feed_id WHERE b.id=? AND b.created_by=?').bind(c.req.param('id'), user.id).first<{ id: string; feed_id: string; xml_url: string }>();
  if (!builder) return c.json({ error: '고칠 수 있는 RSS 빌더 피드가 아닙니다.' }, 404);
  try {
    const analysis = await analyseBuilderPage(body.url, c.env, body.selector);
    const title = body.title?.trim().slice(0, 200) || analysis.title;
    const parsed = builderParsedFeed(analysis, body.selector, builder.xml_url, title);
    if (parsed.listPages) parsed.articles.push(...await builderListPageArticles(parsed.listPages, body.selector, parsed.articles));
    await c.env.DB.prepare('UPDATE rss_builders SET source_url=?,selector=?,title=? WHERE id=?').bind(analysis.sourceUrl, body.selector, title, builder.id).run();
    // 같은 피드 주소로 다시 저장하므로 피드와 구독, 읽음 기록은 그대로다. 새로 고른 목록의 글이 더해지고 썸네일·날짜가 채워진다.
    const { insertedCount } = await upsertFeedAndArticles(c.env.DB, parsed);
    await c.env.DB.prepare('UPDATE subscriptions SET custom_title=? WHERE user_id=? AND feed_id=?').bind(title, user.id, builder.feed_id).run();
    return c.json({ rssUrl: builder.xml_url, feedId: builder.feed_id, title, insertedCount });
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'RSS 피드를 고치지 못했습니다.' }, 502); }
});

app.get('/api/discover/feeds/:id/preview', async (c) => {
  const feed = CURATED_FEEDS.find((item) => item.id === c.req.param('id'));
  if (!feed) return c.json({ error: '추천 피드를 찾을 수 없습니다.' }, 404);

  try {
    const parsed = await fetchAndParseFeed(feed.xmlUrl, c.env.DB);
    return c.json(feedPreviewResponse(parsed));
  } catch {
    return c.json({ error: '최근 글을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 502);
  }
});

// 폴더 만들기·읽기·고치기·지우기
app.post('/api/folders', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ name?: string; color?: string }>();
  const name = (body.name || '').trim();
  if (!name) {
    return c.json({ error: '폴더 이름을 입력해 주세요.' }, 400);
  }

  const existing = await c.env.DB.prepare(
    'SELECT * FROM folders WHERE user_id = ? AND name = ?'
  )
    .bind(user.id, name)
    .first<FolderRecord>();

  if (existing) {
    return c.json({ folder: existing });
  }

  const folderId = generateId('fld');
  const color = body.color || '#10b981';
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO folders (id, user_id, name, color, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(folderId, user.id, name, color, 10, now)
    .run();

  const created = await c.env.DB.prepare('SELECT * FROM folders WHERE id = ?')
    .bind(folderId)
    .first<FolderRecord>();

  return c.json({ folder: created });
});

app.put('/api/folders/:id', async (c) => {
  const user = c.get('user');
  const folderId = c.req.param('id');
  const body = await c.req.json<{ name?: string; color?: string }>();

  const name = (body.name || '').trim();
  if (!name) {
    return c.json({ error: '폴더 이름을 입력해 주세요.' }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE folders SET name = ?, color = COALESCE(?, color) WHERE id = ? AND user_id = ?`
  )
    .bind(name, body.color || null, folderId, user.id)
    .run();

  return c.json({ success: true });
});

app.delete('/api/folders/:id', async (c) => {
  const user = c.get('user');
  const folderId = c.req.param('id');

  await c.env.DB.prepare(
    `UPDATE subscriptions SET folder_id = NULL WHERE folder_id = ? AND user_id = ?`
  )
    .bind(folderId, user.id)
    .run();

  await c.env.DB.prepare(`DELETE FROM folders WHERE id = ? AND user_id = ?`)
    .bind(folderId, user.id)
    .run();

  return c.json({ success: true });
});

// 피드 주소 구독
app.post('/api/subscriptions', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    url?: string;
    folderId?: string | null;
    folderName?: string | null;
    customTitle?: string | null;
  }>();

  const rawUrl = (body.url || '').trim();
  if (!rawUrl) {
    return c.json({ error: '구독할 RSS URL 또는 웹사이트 주소를 입력해 주세요.' }, 400);
  }

  let parsed;
  try {
    parsed = await fetchAndParseFeed(rawUrl, c.env.DB);
  } catch (error) {
    return c.json({ error: new OpmlSourceError(error).message }, 502);
  }
  const { feedId, insertedCount } = await upsertFeedAndArticles(c.env.DB, parsed);

  let folderId = body.folderId || null;
  if (!folderId && body.folderName) {
    const folderName = body.folderName.trim();
    const existingFolder = await c.env.DB.prepare(
      'SELECT id FROM folders WHERE user_id = ? AND name = ?'
    )
      .bind(user.id, folderName)
      .first<{ id: string }>();

    if (existingFolder) {
      folderId = existingFolder.id;
    } else {
      folderId = generateId('fld');
      await c.env.DB.prepare(
        `INSERT INTO folders (id, user_id, name, color, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(folderId, user.id, folderName, '#10b981', 10, new Date().toISOString())
        .run();
    }
  }

  const existingSub = await c.env.DB.prepare(
    'SELECT id FROM subscriptions WHERE user_id = ? AND feed_id = ?'
  )
    .bind(user.id, feedId)
    .first<{ id: string }>();

  if (existingSub) {
    if (folderId) {
      await c.env.DB.prepare(
        'UPDATE subscriptions SET folder_id = ? WHERE id = ? AND user_id = ?'
      )
        .bind(folderId, existingSub.id, user.id)
        .run();
    }
    return c.json({
      subscriptionId: existingSub.id,
      feedId,
      title: parsed.title,
      insertedCount,
      alreadySubscribed: true,
    });
  }

  const subId = generateId('sub');
  await c.env.DB.prepare(
    `INSERT INTO subscriptions (id, user_id, feed_id, folder_id, custom_title, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      subId,
      user.id,
      feedId,
      folderId,
      body.customTitle?.trim() || null,
      new Date().toISOString()
    )
    .run();
  await inheritXView(c.env.DB, user.id, feedId);

  return c.json({
    subscriptionId: subId,
    feedId,
    title: parsed.title,
    insertedCount,
    alreadySubscribed: false,
  });
});

// 구독 고치기 (폴더 옮기기 또는 이름 바꾸기)
app.put('/api/subscriptions/:id', async (c) => {
  const user = c.get('user');
  const subId = c.req.param('id');
  const subscription = await c.env.DB.prepare('SELECT f.title FROM subscriptions s JOIN feeds f ON f.id=s.feed_id WHERE s.id=? AND s.user_id=?').bind(subId, user.id).first<{ title: string }>();
  if (!subscription) return c.json({ error: '구독을 찾을 수 없습니다.' }, 404);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: '수정할 내용을 확인해 주세요.' }, 400);
  const hasFolder = Object.hasOwn(body, 'folderId'), hasTitle = Object.hasOwn(body, 'customTitle');
  if (!hasFolder && !hasTitle) return c.json({ error: '수정할 내용을 확인해 주세요.' }, 400);
  if (hasFolder && body.folderId !== null && (typeof body.folderId !== 'string' || !body.folderId)) return c.json({ error: '폴더를 확인해 주세요.' }, 400);
  if (hasTitle && body.customTitle !== null && (typeof body.customTitle !== 'string' || !body.customTitle.trim() || body.customTitle.trim().length > 200 || /[\u0000-\u001f\u007f]/.test(body.customTitle))) return c.json({ error: '피드 이름은 1~200자로 입력해 주세요.' }, 400);
  // 생략한 값은 유지한다. 이름만 고칠 때 기존 폴더가 미분류로 바뀌면 안 된다.
  if (hasFolder && body.folderId && !(await c.env.DB.prepare('SELECT 1 FROM folders WHERE id=? AND user_id=?').bind(body.folderId, user.id).first())) return c.json({ error: '폴더를 찾을 수 없습니다.' }, 404);
  const title = hasTitle && body.customTitle !== null ? body.customTitle.trim() : null;
  await c.env.DB.prepare(`UPDATE subscriptions SET folder_id=CASE WHEN ? THEN ? ELSE folder_id END, custom_title=CASE WHEN ? THEN ? ELSE custom_title END WHERE id=? AND user_id=?`).bind(Number(hasFolder), body.folderId ?? null, Number(hasTitle), title, subId, user.id).run();
  return c.json({ success: true, ...(hasTitle ? { customTitle: title, title: title || subscription.title } : {}) });
});

// 구독 끊기
app.delete('/api/subscriptions/:id', async (c) => {
  const user = c.get('user');
  const subId = c.req.param('id');

  await c.env.DB.prepare('DELETE FROM subscriptions WHERE id = ? AND user_id = ?')
    .bind(subId, user.id)
    .run();

  return c.json({ success: true });
});

// 구독을 끊지 않고 피드의 새 글을 멈추거나 다시 받는다. 멈춘 동안 온 글은 숨겨 두고,
// 다시 받을 때 읽음으로 표시해서 갑자기 쌓인 안 읽은 글로 돌아오지 않고 제자리에 보이게 한다.
app.post('/api/subscriptions/:id/updates', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ paused?: unknown }>().catch(() => ({ paused: undefined }));
  if (typeof body.paused !== 'boolean') return c.json({ error: '업데이트를 멈출지 다시 받을지 지정해 주세요.' }, 400);
  if (!(await pauseSupported(c.env.DB))) return c.json({ error: '서버 업데이트가 끝나면 사용할 수 있습니다.' }, 503);
  const sub = await c.env.DB.prepare('SELECT id, feed_id, paused_at FROM subscriptions WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), user.id)
    .first<{ id: string; feed_id: string; paused_at: string | null }>();
  if (!sub) return c.json({ error: '구독을 찾을 수 없습니다.' }, 404);
  if (body.paused === Boolean(sub.paused_at)) return c.json({ pausedAt: sub.paused_at });
  const now = new Date().toISOString();
  const statements = body.paused
    ? [c.env.DB.prepare('UPDATE subscriptions SET paused_at = ? WHERE id = ?').bind(now, sub.id)]
    : [
        // 오래된 글은 이미 읽은 글로 세므로, 안 읽은 기간의 글만 표시하면 된다.
        c.env.DB.prepare(`INSERT INTO article_states (user_id, article_id, is_read, read_at)
          SELECT ?, a.id, 1, ? FROM articles a
          WHERE a.feed_id = ? AND a.created_at > ? AND a.published_at >= ?
          ON CONFLICT(user_id, article_id) DO UPDATE SET is_read = 1, read_at = excluded.read_at`)
          .bind(user.id, now, sub.feed_id, sub.paused_at, unreadCutoff()),
        c.env.DB.prepare('UPDATE subscriptions SET paused_at = NULL WHERE id = ?').bind(sub.id),
      ];
  // 구독 트리거는 폴더와 제목 변경만 기록하므로, 다른 기기는 명시적인 변경 항목으로
  // 멈춤을 알게 된다.
  statements.push(
    c.env.DB.prepare("DELETE FROM reader_sync_changes WHERE kind = 'subscription' AND owner_id = ? AND entity_id = ?").bind(user.id, sub.id),
    c.env.DB.prepare("INSERT INTO reader_sync_changes(kind, owner_id, entity_id, feed_id, operation) VALUES('subscription', ?, ?, ?, 'upsert')").bind(user.id, sub.id, sub.feed_id),
  );
  await c.env.DB.batch(statements);
  return c.json({ pausedAt: body.paused ? now : null });
});

// 누른 사람이 기다리는 시간. 넘으면 먼저 답하고 남은 피드는 응답 뒤에 계속 받는다.
const FEED_REFRESH_WAIT_MS = 3000;
// 이보다 최근에 받은 피드는 전체 새로고침에서 건너뛴다. 모두 읽음을 연달아 누를 때 같은 피드를 또 받지 않는다.
const FEED_REFRESH_FRESH_MS = 3 * 60_000;

// 피드 새로고침
app.post('/api/feeds/refresh', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ feedId?: string; folderId?: string }>().catch(() => ({ feedId: undefined, folderId: undefined }));

  let feedsToRefresh: StoredFeed[] = [];
  if (body.feedId) {
    const row = await c.env.DB.prepare(
      `SELECT ${storedFeedColumns}
       FROM feeds f
       JOIN subscriptions s ON s.feed_id = f.id
       LEFT JOIN rss_builders b ON b.feed_id = f.id
       WHERE f.id = ? AND s.user_id = ?`
    )
      .bind(body.feedId, user.id)
      .first<StoredFeed>();
    if (row) feedsToRefresh = [row];
  } else {
    // 보고 있는 폴더의 피드부터, 그다음은 오래전에 받은 피드부터 받는다.
    // 대기 시간 안에 다 못 받아도 누를 때마다 안 받은 피드로 넘어간다.
    const res = await c.env.DB.prepare(
      `SELECT ${storedFeedColumns}
       FROM feeds f
       JOIN subscriptions s ON s.feed_id = f.id
       LEFT JOIN rss_builders b ON b.feed_id = f.id
       WHERE s.user_id = ? AND (f.last_fetched_at IS NULL OR f.last_fetched_at < ?)
       ORDER BY CASE WHEN s.folder_id = ? THEN 0 ELSE 1 END, f.last_fetched_at ASC`
    )
      .bind(user.id, new Date(Date.now() - FEED_REFRESH_FRESH_MS).toISOString(), body.folderId ?? '')
      .all<StoredFeed>();
    feedsToRefresh = res.results || [];
  }

  const progress: RefreshProgress = { done: 0, inserted: 0 };
  const work = refreshStoredFeeds(c.env, feedsToRefresh, progress).catch((error) => console.error('피드 새로고침 실패:', error instanceof Error ? error.message : error));
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work, new Promise((resolve) => { timer = setTimeout(resolve, FEED_REFRESH_WAIT_MS); })]);
  clearTimeout(timer);
  const pendingFeeds = feedsToRefresh.length - progress.done;
  // 실행 문맥이 없는 테스트 환경에서는 그냥 이어서 돈다.
  if (pendingFeeds) { try { c.executionCtx.waitUntil(work); } catch { /* 위와 같다 */ } }

  return c.json({
    refreshedFeeds: progress.done - (progress.skipped || 0),
    newArticles: progress.inserted,
    pendingFeeds,
  });
});

app.post('/api/sync', async (c) => {
  const body = await c.req.json<{ cursor?: unknown }>();
  const user = c.get('user');
  return c.json(await readerDelta(c.env.DB, user.id, body?.cursor, accountArticleBlocks(user.preferences_json)));
});

// 목록의 검색 조건. 모두 읽음도 같은 조건을 써서 검색 결과만 읽음 처리한다.
const SEARCH_MATCH = '(a.title LIKE ? OR a.summary LIKE ? OR a.author LIKE ? OR f.title LIKE ?)';
const searchParams = (search: string) => Array<string>(4).fill(`%${search}%`);

// 구독이 이만큼 많으면 최신순 인덱스를 따라 읽는 편이 빠르다. 구독이 적으면 내 글을 찾기까지
// 다른 사람의 글을 한참 지나쳐야 하므로 구독부터 읽는다.
const ARTICLES_FIRST_SUBSCRIPTIONS = 20;

// 필터·검색·배치를 지원하며 글을 가져온다
app.get('/api/articles', async (c) => {
  const user = c.get('user');
  const { sequence: syncSequence } = await syncHead(c.env.DB);
  // 기록을 되살릴 때는 지금 걸러진·페이지로 나뉜 목록 밖의 읽은 글도 찾아야 한다.
  // 구독 조인은 여전히 소유권을 확인한다.
  const articleId = c.req.query('articleId');
  // X 타임라인은 본문 없이 동기화된 글 여러 개의 본문을 한 번에 받는다.
  const articleIds = [...new Set((c.req.query('articleIds') || '').split(',').filter((id) => id && id.length <= 200))].slice(0, 80);
  const exact = Boolean(articleId) || articleIds.length > 0;
  const oldest = c.req.query('sort') === 'oldest';
  const scope = c.req.query('scope') || 'all'; // 'all' | 'today' | 'saved' | 'folder' | 'feed'
  const folderId = c.req.query('folderId') || '';
  const feedId = c.req.query('feedId') || '';
  const unreadOnly = c.req.query('unreadOnly') === 'true';
  // 폴더나 피드 안의 저장한 글 (휴대폰 목록의 저장 탭).
  const savedOnly = c.req.query('savedOnly') === 'true';
  const search = (c.req.query('search') || '').trim();
  const limit = Math.min(Number(c.req.query('limit') || 80), 200);
  // 키셋 커서: 이전 페이지의 마지막 글 (published_at, id).
  const before = c.req.query('before') || '';
  const beforeId = c.req.query('beforeId') || '';
  const cutoff = unreadCutoff();

  // 멈춘 피드는 멈추기 전에 저장된 글은 보여 주고, 그 뒤의 글은 보여 주지 않는다.
  const conditions: string[] = ['s.user_id = ?', shownToSubscriber(await pauseSupported(c.env.DB))];
  // 첫 자리표시자는 SELECT 목록에 있다: 나이에 따른 기본 읽음 상태.
  const params: unknown[] = [cutoff, user.id];
  // 저장한 글은 저장 표에서 먼저 찾는다. 글 전체에서 저장된 글을 골라내면 수십만 행을 읽는다.
  const savedFirst = !exact && (scope === 'saved' || savedOnly) && !(scope === 'feed' && feedId);
  const requireSaved = () => {
    if (savedFirst) {
      conditions.push('st.user_id = ? AND st.is_saved = 1');
      params.push(user.id);
    } else {
      conditions.push('COALESCE(st.is_saved, 0) = 1');
    }
  };

  if (articleId) {
    conditions.push('a.id = ?');
    params.push(articleId);
  } else if (articleIds.length) {
    conditions.push(`a.id IN (${articleIds.map(() => '?').join(',')})`);
    params.push(...articleIds);
  } else if (scope === 'folder' && folderId) {
    conditions.push('s.folder_id = ?');
    params.push(folderId);
  } else if (scope === 'feed' && feedId) {
    conditions.push('s.feed_id = ?');
    params.push(feedId);
  } else if (scope === 'saved') {
    requireSaved();
  } else if (scope === 'today') {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    conditions.push('a.published_at >= ?');
    params.push(twentyFourHoursAgo);
  }

  const excludedFeedIds = scopedExcludedFeeds(scope, savedOnly, c.req.query('excludedFeedIds'));
  if (!exact && excludedFeedIds.length) {
    conditions.push('a.feed_id NOT IN (SELECT value FROM json_each(?))');
    params.push(JSON.stringify(excludedFeedIds));
  }

  if (!exact && savedOnly && scope !== 'saved') {
    requireSaved();
  }
  if (!exact && unreadOnly && !savedOnly && scope !== 'saved') {
    conditions.push('a.published_at >= ? AND COALESCE(st.is_read, 0) = 0');
    params.push(cutoff);
  }

  if (!exact && search) {
    conditions.push(SEARCH_MATCH);
    params.push(...searchParams(search));
  }

  if (!exact && before) {
    // 앞의 범위 조건은 결과를 바꾸지 않고, 뒤쪽 쪽을 볼 때 인덱스로 바로 그 자리부터 읽게 한다.
    conditions.push(oldest ? 'a.published_at >= ? AND (a.published_at > ? OR (a.published_at = ? AND a.id > ?))' : 'a.published_at <= ? AND (a.published_at < ? OR (a.published_at = ? AND a.id < ?))');
    params.push(before, before, before, beforeId);
  }

  // 한 행을 더 받아서, 더 오래된 페이지가 있는지 클라이언트에 알린다.
  params.push(limit + 1);

  // 읽는 순서를 조건별로 코드에서 정한다. CROSS JOIN은 SQLite가 표 순서를 바꾸지 못하게 한다.
  // 통계에 맡기면 구독부터 읽고 글 전체를 정렬해 한 번에 100만 행 넘게 읽을 수 있다.
  const scoped = (scope === 'folder' && folderId) || (scope === 'feed' && feedId);
  const articlesFirst = exact || (!scoped && !savedFirst && Number((await c.env.DB.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ?').bind(user.id).first<{ n: number }>())?.n) >= ARTICLES_FIRST_SUBSCRIPTIONS);
  const source = savedFirst ? `article_states st
    CROSS JOIN articles a ON a.id = st.article_id
    CROSS JOIN subscriptions s ON s.feed_id = a.feed_id AND s.user_id = st.user_id
    JOIN feeds f ON f.id = a.feed_id
    LEFT JOIN folders fl ON fl.id = s.folder_id
    LEFT JOIN article_date_checks dc ON dc.article_id = a.id` : `${articlesFirst ? 'articles a CROSS JOIN subscriptions s ON s.feed_id = a.feed_id' : 'subscriptions s CROSS JOIN articles a ON a.feed_id = s.feed_id'}
    JOIN feeds f ON f.id = a.feed_id
    LEFT JOIN folders fl ON fl.id = s.folder_id
    LEFT JOIN article_states st ON st.article_id = a.id AND st.user_id = s.user_id
    LEFT JOIN article_date_checks dc ON dc.article_id = a.id`;
  const sql = `
    SELECT
      a.id,
      a.feed_id,
      COALESCE(s.custom_title, f.title) as feed_title,
      f.favicon_url as feed_favicon,
      f.html_url as feed_html_url,
      s.folder_id,
      fl.name as folder_name,
      a.guid,
      a.title,
      a.url,
      a.author,
      a.summary,
      a.content_html,
      a.full_content_html,
      a.ai_summary,
      a.thumbnail_url,
      a.published_at,
      COALESCE(dc.source, 'feed') AS date_source,
      COALESCE(st.is_read, CASE WHEN a.published_at < ? THEN 1 ELSE 0 END) as is_read,
      COALESCE(st.is_saved, 0) as is_saved
    FROM ${source}
    WHERE ${conditions.join(' AND ')}
    ORDER BY a.published_at ${oldest ? 'ASC' : 'DESC'}, a.id ${oldest ? 'ASC' : 'DESC'}
    LIMIT ?
  `;

  const res = await c.env.DB.prepare(sql)
    .bind(...params)
    .all<Record<string, unknown>>();

  const rows = res.results || [];
  const hasMore = rows.length > limit;
  const articles: ArticleItem[] = rows.slice(0, limit).map((row) => ({
    id: String(row.id),
    feed_id: String(row.feed_id),
    feed_title: String(row.feed_title || ''),
    feed_favicon: (row.feed_favicon as string) || null,
    feed_html_url: (row.feed_html_url as string) || null,
    folder_id: (row.folder_id as string) || null,
    folder_name: (row.folder_name as string) || null,
    guid: String(row.guid),
    title: String(row.title),
    url: String(row.url),
    author: (row.author as string) || null,
    summary: (row.summary as string) || null,
    content_html: (row.content_html as string) || null,
    full_content_html: realFullContent(row.full_content_html as string | null),
    ai_summary: (row.ai_summary as string) || null,
    // ''(찾아봤지만 이미지 없음)와 null(아직 찾아보지 않음)을 구분한다.
    thumbnail_url: row.thumbnail_url == null ? null : String(row.thumbnail_url),
    published_at: String(row.published_at),
    date_source: String(row.date_source),
    is_read: Boolean(Number(row.is_read)),
    is_saved: Boolean(Number(row.is_saved)),
  }));

  return c.json({ articles, hasMore, syncSequence });
});

// 스크롤 읽음은 보이고 지나간 글만 바꾸고 북마크는 지킨다.
app.post('/api/articles/mark-read', async (c) => {
  const body = await c.req.json<{ articleIds?: unknown }>();
  if (!Array.isArray(body.articleIds) || body.articleIds.length > 50 || !body.articleIds.length || body.articleIds.some((id) => typeof id !== 'string' || !id || id.length > 200)) {
    return c.json({ error: '읽음 처리할 글을 1~50개 지정해 주세요.' }, 400);
  }
  const ids = [...new Set(body.articleIds as string[])];
  const userId = c.get('user').id;
  await c.env.DB.prepare(`INSERT INTO article_states (user_id, article_id, is_read, read_at)
    SELECT ?, a.id, 1, ? FROM articles a
    CROSS JOIN subscriptions s ON s.feed_id = a.feed_id
    WHERE s.user_id = ? AND a.id IN (${ids.map(() => '?').join(',')})
    ON CONFLICT(user_id, article_id) DO UPDATE SET is_read = 1, read_at = excluded.read_at`)
    .bind(userId, new Date().toISOString(), userId, ...ids).run();
  return c.json({ success: true });
});

// 글의 읽음 / 저장 상태 전환
app.post('/api/articles/:id/state', async (c) => {
  const user = c.get('user');
  const articleId = c.req.param('id');
  const body = await c.req.json<{ isRead?: boolean; isSaved?: boolean }>();
  const now = new Date().toISOString();

  const existing = await c.env.DB.prepare(
    'SELECT is_read, is_saved FROM article_states WHERE user_id = ? AND article_id = ?'
  )
    .bind(user.id, articleId)
    .first<{ is_read: number; is_saved: number }>();

  const nextRead =
    typeof body.isRead === 'boolean'
      ? body.isRead
        ? 1
        : 0
      : existing
      ? Number(existing.is_read)
      : 0;
  const nextSaved =
    typeof body.isSaved === 'boolean'
      ? body.isSaved
        ? 1
        : 0
      : existing
      ? Number(existing.is_saved)
      : 0;

  await c.env.DB.prepare(
    `INSERT INTO article_states (user_id, article_id, is_read, is_saved, read_at, saved_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, article_id) DO UPDATE SET
       is_read = excluded.is_read,
       is_saved = excluded.is_saved,
       read_at = CASE WHEN excluded.is_read = 1 THEN excluded.read_at ELSE article_states.read_at END,
       saved_at = CASE WHEN excluded.is_saved = 1 THEN excluded.saved_at ELSE article_states.saved_at END`
  )
    .bind(
      user.id,
      articleId,
      nextRead,
      nextSaved,
      nextRead ? now : null,
      nextSaved ? now : null
    )
    .run();

  return c.json({
    articleId,
    isRead: Boolean(nextRead),
    isSaved: Boolean(nextSaved),
  });
});

// 조건에 맞는 글을 모두 읽음 처리한다. `search`와 `savedOnly`는 /api/articles에서처럼
// 화면의 목록으로 범위를 좁힌다. `olderThan` / `newerThan`(글 id)은 목록 순서에서
// 그 글의 한쪽만 처리한다.
app.post('/api/articles/mark-all-read', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    scope?: string;
    folderId?: string;
    feedId?: string;
    search?: string;
    savedOnly?: boolean;
    excludedFeedIds?: string[];
    olderThan?: string;
    newerThan?: string;
  }>();

  const scope = body.scope || 'all';
  const conditions: string[] = ['s.user_id = ?', shownToSubscriber(await pauseSupported(c.env.DB))];
  const params: unknown[] = [user.id];

  if (scope === 'folder' && body.folderId) {
    conditions.push('s.folder_id = ?');
    params.push(body.folderId);
  } else if (scope === 'feed' && body.feedId) {
    conditions.push('s.feed_id = ?');
    params.push(body.feedId);
  } else if (scope === 'saved') {
    conditions.push('COALESCE(st.is_saved, 0) = 1');
  } else if (scope === 'today') {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    conditions.push('a.published_at >= ?');
    params.push(twentyFourHoursAgo);
  }
  const excludedFeedIds = scopedExcludedFeeds(scope, Boolean(body.savedOnly), body.excludedFeedIds);
  if (excludedFeedIds.length) {
    conditions.push('a.feed_id NOT IN (SELECT value FROM json_each(?))');
    params.push(JSON.stringify(excludedFeedIds));
  }
  if (body.savedOnly && scope !== 'saved') conditions.push('COALESCE(st.is_saved, 0) = 1');
  const search = typeof body.search === 'string' ? body.search.trim() : '';
  if (search) {
    conditions.push(SEARCH_MATCH);
    params.push(...searchParams(search));
  }
  const edge = body.olderThan || body.newerThan;
  if (edge) {
    const anchor = await c.env.DB.prepare('SELECT a.published_at FROM articles a WHERE a.id = ? AND EXISTS(SELECT 1 FROM subscriptions s WHERE s.feed_id = a.feed_id AND s.user_id = ?)')
      .bind(edge, user.id)
      .first<{ published_at: string }>();
    if (!anchor) return c.json({ error: '아티클을 찾을 수 없습니다.' }, 404);
    const side = body.olderThan ? '<' : '>';
    conditions.push(`(a.published_at ${side} ? OR (a.published_at = ? AND a.id ${side} ?))`);
    params.push(anchor.published_at, anchor.published_at, edge);
  }

  // 오래된 글은 이미 읽은 글로 세므로 안 읽은 기간의 글만 표시하면 된다. 글마다 돌면
  // D1 쿼리 한도를 넘으므로 한 문장으로 처리한다.
  conditions.push('a.published_at >= ?');
  params.push(unreadCutoff());
  const res = await c.env.DB.prepare(
    `INSERT INTO article_states (user_id, article_id, is_read, read_at)
     SELECT s.user_id, a.id, 1, ?
     FROM articles a
     JOIN subscriptions s ON s.feed_id = a.feed_id
     JOIN feeds f ON f.id = a.feed_id
     LEFT JOIN article_states st ON st.article_id = a.id AND st.user_id = s.user_id
     WHERE ${conditions.join(' AND ')} AND COALESCE(st.is_read, 0) = 0
     ON CONFLICT(user_id, article_id) DO UPDATE SET is_read = 1, read_at = excluded.read_at`
  )
    .bind(new Date().toISOString(), ...params)
    .run();

  return c.json({ markedCount: Number(res.meta?.changes ?? 0) });
});

// 구독한 모든 언론사에 대해 글을 열 때 리더 보기와 관계없이 실행한다.
// 여러 번 열면 다시 받지 않고 저장한 결과를 쓴다.
app.post('/api/articles/:id/publication-date', async (c) => {
  const article = await c.env.DB.prepare(`SELECT a.id,a.url,a.title,a.summary,a.content_html,a.full_content_html,a.published_at,d.source AS date_source,d.checked_at FROM articles a LEFT JOIN article_date_checks d ON d.article_id=a.id WHERE a.id=? AND EXISTS(SELECT 1 FROM subscriptions s WHERE s.feed_id=a.feed_id AND s.user_id=?)`).bind(c.req.param('id'), c.get('user').id).first<PublicationArticle>();
  if (!article) return c.json({ error: '아티클을 찾을 수 없습니다.' }, 404);
  return c.json(await resolveArticlePublication(c.env.DB, article));
});

// 리더 보기: 원문 주소에서 전체 기사 본문을 긁어 온다
// 피드마다 본문 보기(피드 본문 / 리더 / 웹 페이지)를 기억한다.
app.put('/api/feeds/:feedId/view-mode', async (c) => {
  const user = c.get('user');
  const feedId = c.req.param('feedId');
  const { viewMode, onlyIfUnset } = await c.req
    .json<{ viewMode?: string; onlyIfUnset?: boolean }>()
    .catch(() => ({ viewMode: undefined, onlyIfUnset: false }));
  if (viewMode !== 'feed' && viewMode !== 'reader' && viewMode !== 'web') {
    return c.json({ error: '보기 방식은 feed, reader, web 중 하나여야 합니다.' }, 400);
  }
  const subscribed = await c.env.DB.prepare('SELECT f.xml_url FROM subscriptions s JOIN feeds f ON f.id = s.feed_id WHERE s.user_id = ? AND s.feed_id = ?')
    .bind(user.id, feedId)
    .first<{ xml_url: string }>();
  if (!subscribed) return c.json({ error: '구독 중인 피드가 아닙니다.' }, 404);
  // X 계정은 하나에서 고른 보기를 구독 중인 모든 X 계정이 함께 쓴다.
  if (onlyIfUnset !== true && isXProfileFeed(subscribed.xml_url)) {
    return c.json({ viewMode, feedIds: await saveXView(c.env.DB, user.id, viewMode) });
  }
  await c.env.DB.prepare(
    `INSERT INTO feed_view_modes (user_id, feed_id, view_mode, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, feed_id) ${onlyIfUnset === true ? 'DO NOTHING' : 'DO UPDATE SET view_mode = excluded.view_mode, updated_at = excluded.updated_at'}`
  )
    .bind(user.id, feedId, viewMode, new Date().toISOString())
    .run();
  const saved = onlyIfUnset === true
    ? await c.env.DB.prepare('SELECT view_mode FROM feed_view_modes WHERE user_id = ? AND feed_id = ?').bind(user.id, feedId).first<{ view_mode: SubscriptionItem['view_mode'] }>()
    : null;
  return c.json({ viewMode: saved?.view_mode ?? viewMode });
});

// 피드에 이미지가 없는 글의 썸네일: 목록에서 가까운 행을 위해 페이지의 og:image를 찾는다.
// 기기 캐시가 같은 페이지를 거듭 받지 않게 하고, 예전의 빈 답은 다시 시도할 수 있으며
// 일시적인 실패는 확정 답으로 치지 않는다.
app.post('/api/articles/:id/thumbnail', async (c) => {
  const body = await c.req.json<{ refresh?: boolean }>().catch(() => ({ refresh: false }));
  const article = await c.env.DB.prepare('SELECT id, url, thumbnail_url, content_html FROM articles a WHERE id = ? AND EXISTS(SELECT 1 FROM subscriptions s WHERE s.feed_id = a.feed_id AND s.user_id = ?)')
    .bind(c.req.param('id'), c.get('user').id)
    .first<{ id: string; url: string; thumbnail_url: string | null; content_html: string | null }>();
  if (!article) return c.json({ error: '아티클을 찾을 수 없습니다.' }, 404);
  if (body.refresh && xStatusUrl(article.url)) {
    const refreshed = await refreshXCardImages(article.url, article.content_html, c.env.DB);
    if (!refreshed) return c.json({ thumbnailUrl: null });
    await c.env.DB.prepare('UPDATE articles SET thumbnail_url = ?, content_html = ? WHERE id = ?')
      .bind(refreshed.thumbnailUrl, refreshed.contentHtml, article.id)
      .run();
    return c.json(refreshed);
  }
  if (article.thumbnail_url) return c.json({ thumbnailUrl: article.thumbnail_url });

  const found = await fetchPreviewImage(article.url);
  if (found !== undefined) {
    await c.env.DB.prepare("UPDATE articles SET thumbnail_url = ? WHERE id = ? AND (thumbnail_url IS NULL OR thumbnail_url = '')")
      .bind(found ?? '', article.id)
      .run();
  }
  return c.json({ thumbnailUrl: found ?? null, retryable: found === undefined });
});

// 웹 보기: 원문 페이지를 리더 영역 안 프레임에 넣어도 되는가?
app.get('/api/articles/:id/embeddable', async (c) => {
  const article = await c.env.DB.prepare('SELECT url FROM articles WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ url: string }>();
  if (!article) return c.json({ error: '아티클을 찾을 수 없습니다.' }, 404);
  return c.json(await checkEmbeddable(article.url, new URL(c.req.url).origin));
});

// 인용 글과 댓글은 구독을 추가하지 않고 현재 본문 영역에서 연다.
app.get('/api/articles/:id/x-post', async (c) => {
  const url = c.req.query('url') || '';
  if (!xStatusUrl(url)) return c.json({ error: 'X 글 주소를 확인해 주세요.' }, 400);
  const source = await c.env.DB.prepare('SELECT a.url, a.content_html FROM articles a WHERE a.id=? AND EXISTS(SELECT 1 FROM subscriptions s WHERE s.feed_id=a.feed_id AND s.user_id=?)')
    .bind(c.req.param('id'), c.get('user').id).first<{ url: string; content_html: string | null }>();
  if (!source || !xStatusUrl(source.url)) return c.json({ error: 'X 글을 찾을 수 없습니다.' }, 404);
  c.header('Cache-Control', 'no-store');
  try { return c.json(xThreadWithProof(c.env, await fetchXThread(url, source.content_html, c.env.DB))); }
  catch { return c.json({ error: 'X 글을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 502); }
});

// 프레임을 거부하는 사이트의 웹 보기: 스크립트 없는 페이지 사본.
// ?layout=phone은 받은 페이지가 데스크톱에만 맞을 때 휴대폰 폭으로 배치한 사본을 요청한다.
app.get('/api/articles/:id/web-copy', async (c) => {
  const article = await c.env.DB.prepare(
    'SELECT a.url, a.title, a.content_html FROM articles a WHERE a.id = ? AND EXISTS(SELECT 1 FROM subscriptions s WHERE s.feed_id = a.feed_id AND s.user_id = ?)'
  )
    .bind(c.req.param('id'), c.get('user').id)
    .first<{ url: string; title: string; content_html: string | null }>();
  if (!article) return c.json({ error: '아티클을 찾을 수 없습니다.' }, 404);
  // 공개 미러에서 못 받은 대화는 빈 x.com 사본으로 저장하지 않는다.
  if (xStatusUrl(article.url)) {
    c.header('Cache-Control', 'no-store');
    try { return c.json(xThreadWithProof(c.env, await fetchXThread(article.url, article.content_html, c.env.DB, article.title))); }
    catch { return c.json({ error: 'X 대화를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' }, 502); }
  }
  try {
    return c.json(await fetchWebView(article.url, c.env, c.req.query('layout') === 'phone', pageAssetProxy(c.env, new URL(c.req.url).origin)));
  } catch {
    return c.json({ error: '원문 페이지를 불러오지 못했습니다.' }, 502);
  }
});

app.post('/api/articles/:id/reader-view', async (c) => {
  const articleId = c.req.param('id');
  const body = await c.req
    .json<{ force?: boolean }>()
    .catch(() => ({ force: false }));

  const article = await c.env.DB.prepare(
    `SELECT id, title, url, content_html, full_content_html, thumbnail_url, published_at
     FROM articles WHERE id = ? AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.feed_id=articles.feed_id AND s.user_id=?)`
  )
    .bind(articleId, c.get('user').id)
    .first<{
      id: string;
      title: string;
      url: string;
      content_html: string | null;
      full_content_html: string | null;
      thumbnail_url: string | null;
      published_at: string;
    }>();

  if (!article) {
    return c.json({ error: '아티클을 찾을 수 없습니다.' }, 404);
  }

  if (realFullContent(article.full_content_html) && !body.force) {
    const publishedAt = extractOriginalPublishedAt(article.content_html, article.url) || extractOriginalPublishedAt(article.full_content_html, article.url) || article.published_at;
    if (publishedAt !== article.published_at) {
      await c.env.DB.prepare('UPDATE articles SET published_at = ? WHERE id = ?').bind(publishedAt, article.id).run();
    }
    return c.json({
      fullContentHtml: article.full_content_html,
      publishedAt,
      cached: true,
    });
  }

  const scraped = await scrapeFullArticle(
    article.url,
    article.content_html,
    article.title,
    c.env
  );

  if (!scraped.fullContentHtml) {
    // 예전에 뽑은 실제 본문은 지킨다. 이전 버전이 캐시한 지어낸 본문만 지워서
    // 더는 보이지 않게 한다.
    await c.env.DB.prepare(
      `UPDATE articles
       SET full_content_html = CASE WHEN instr(full_content_html, ?) > 0 THEN NULL ELSE full_content_html END,
           published_at = COALESCE(?, published_at)
       WHERE id = ?`
    )
      .bind(READER_FALLBACK_MARK, scraped.originalPublishedAt, article.id)
      .run();
    return c.json({ error: '원문 본문을 불러오지 못했습니다. 사이트가 자동 접근을 막고 있을 수 있습니다.' }, 502);
  }

  await c.env.DB.prepare(
    `UPDATE articles
     SET full_content_html = ?,
         thumbnail_url = COALESCE(NULLIF(thumbnail_url, ''), ?),
         published_at = COALESCE(?, published_at)
     WHERE id = ?`
  )
    .bind(scraped.fullContentHtml, scraped.leadImageUrl, scraped.originalPublishedAt, article.id)
    .run();

  return c.json({
    fullContentHtml: scraped.fullContentHtml,
    publishedAt: scraped.originalPublishedAt || article.published_at,
    scrapedFromWeb: scraped.scrapedFromWeb,
    cached: false,
  });
});

// 번역과 요약은 같은 리더 본문을 쓴다. 예전 미리보기는 원문에서 한 번 다시 받는다.
async function readerBodyForArticleTools(env: Env, article: { id: string; url: string; title: string; content_html: string | null; full_content_html: string | null }, phone: boolean) {
  if (xStatusUrl(article.url)) return null;
  const cached = realFullContent(article.full_content_html);
  if (cached && !readerBodyNeedsRefresh(cached)) return cached;
  const { fullContentHtml } = await scrapeFullArticle(article.url, article.content_html, article.title, env, phone);
  if (fullContentHtml) await env.DB.prepare('UPDATE articles SET full_content_html=? WHERE id=? AND full_content_html IS ?')
    .bind(fullContentHtml, article.id, article.full_content_html).run();
  return fullContentHtml;
}

// 글 번역. 웹·리더 보기에서는 기사 본문을, 피드 보기에서는 피드 본문을 번역한다.
app.post('/api/articles/:id/translate', async (c) => {
  type Request = { source?: unknown; force?: unknown; phone?: unknown; xThread?: unknown; xUrl?: unknown };
  const body: Request = await c.req.json<Request>().catch(() => ({}));
  const source = body.source === 'feed' ? 'feed' : 'full';
  const article = await c.env.DB.prepare(
    `SELECT id, title, url, summary, content_html, full_content_html
     FROM articles WHERE id = ? AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.feed_id=articles.feed_id AND s.user_id=?)`
  ).bind(c.req.param('id'), c.get('user').id).first<{ id: string; title: string; url: string; summary: string | null; content_html: string | null; full_content_html: string | null }>();
  if (!article) return c.json({ error: '아티클을 찾을 수 없습니다.' }, 404);
  const needsXThread = source === 'full' && xStatusUrl(article.url);
  const linkedUrl = body.xUrl;
  if (linkedUrl !== undefined && (!needsXThread || typeof linkedUrl !== 'string' || !xStatusUrl(linkedUrl))) {
    return c.json({ error: '번역할 X 글 주소를 확인해 주세요.' }, 400);
  }
  const threadUrl = linkedUrl ?? article.url;
  const linkedThread = threadUrl !== article.url;
  let full: string | null = null;
  if (needsXThread) {
    let html = verifiedXThread(c.env, threadUrl, body.xThread);
    if (!html) {
      const copy = await fetchXThread(threadUrl, article.content_html, c.env.DB, linkedThread ? undefined : article.title).catch(() => null);
      if (copy && !copy.partial) html = copy.html;
    }
    full = html ? xThreadTranslationBody(html) : null;
    if (!full) return c.json({ error: 'X 원글과 댓글을 가져오지 못했어요. 대화를 다시 불러온 뒤 번역해 주세요.' }, 422);
  } else if (source === 'full') {
    full = await readerBodyForArticleTools(c.env, article, body.phone === true);
    if (!full) return c.json({ error: '기사 전체 본문을 가져오지 못했어요. 다시 시도하거나 원문에서 읽어 주세요.' }, 422);
  }
  const bodySource = full ? 'full' : 'feed';
  const cacheSource = linkedThread ? `x:${threadUrl.split('/').at(-1)}` : bodySource;
  const escaped = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = full || article.content_html || (article.summary ? `<p>${escaped(article.summary)}</p>` : '');
  if (!html.trim() && !article.title.trim()) return c.json({ error: '번역할 본문이 없어요.' }, 422);
  await ensureTranslationTable(c.env);
  const title = linkedThread ? 'X 게시물' : needsXThread ? article.title.replace(/^(?:RT by|R to) @[a-z\d_]{1,15}:\s*/i, '') : article.title;
  const hash = await sourceHash(title, html);
  if (body.force !== true) {
    const saved = await c.env.DB.prepare('SELECT title, content_html, provider, model FROM article_translations WHERE article_id=? AND target_lang=? AND source_kind=? AND source_hash=?')
      .bind(article.id, 'KO', cacheSource, hash).first<{ title: string; content_html: string; provider: string; model: string }>();
    if (saved) return c.json({ title: saved.title, html: saved.content_html, provider: saved.provider, model: saved.model, bodySource, cached: true });
  }
  let result;
  try { result = await translateArticle(c.env, { title, html, mixedLanguages: needsXThread }); }
  catch (error) { return c.json({ error: error instanceof TranslationError ? error.message : '번역하지 못했어요. 잠시 후 다시 시도해 주세요.' }, error instanceof TranslationError ? error.status as 502 : 502); }
  if (!result.alreadyKorean) {
    await c.env.DB.prepare(`INSERT INTO article_translations(article_id,target_lang,source_kind,source_hash,title,content_html,provider,model,created_at) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(article_id,target_lang,source_kind) DO UPDATE SET source_hash=excluded.source_hash,title=excluded.title,content_html=excluded.content_html,provider=excluded.provider,model=excluded.model,created_at=excluded.created_at`)
      .bind(article.id, 'KO', cacheSource, hash, result.title, result.html, result.provider, result.model, new Date().toISOString()).run();
  }
  return c.json({ title: result.title, html: result.html, provider: result.provider, model: result.model, bodySource, notice: result.notice, alreadyKorean: Boolean(result.alreadyKorean), cached: false });
});

// 번역 설정. DeepL API 키는 운영자만 넣고 지운다. 키는 응답에 돌려주지 않는다.
async function translationConfig(env: Env, user: UserRecord) {
  if (!canManageX(env, user)) return { canManage: false };
  const deepl = await readDeepLKey(env).catch(() => null);
  let usage: { used: number; limit: number } | null = null, problem: string | null = null;
  if (deepl) {
    try { usage = await deeplUsage(deepl.key); }
    catch (error) { problem = deeplProblem(error instanceof DeepLError ? error.status : 0); }
  }
  return { canManage: true, provider: deepl ? 'deepl' : 'workers-ai', managed: Boolean(deepl?.managed), usage, problem, storage: Boolean(env.X_SETTINGS_SECRET && env.X_SETTINGS_SECRET.length >= 32) };
}
// X 미러와 계정 수집 상태. 운영자에게만 보인다. 미러가 주소를 옮기거나 멈추거나, 특정 계정을 오래 받지 못하면 설정 화면에서 알 수 있다.
app.get('/api/x-mirrors', async (c) => {
  c.header('Cache-Control', 'no-store');
  if (!canManageX(c.env, c.get('user'))) return c.json({ canManage: false });
  const [mirrors, stale] = await Promise.all([mirrorStatuses(c.env.DB, xProviders), staleXAccounts(c.env.DB)]);
  return c.json({ canManage: true, mirrors, staleAccounts: stale.accounts, staleTotal: stale.total });
});
app.get('/api/translation/config', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await translationConfig(c.env, c.get('user')));
});
app.put('/api/translation/deepl', async (c) => {
  if (!canManageX(c.env, c.get('user'))) return c.json({ error: '번역 설정은 FeedEx 운영자만 바꿀 수 있습니다.' }, 403);
  if (c.env.DEEPL_API_KEY?.trim()) return c.json({ error: '이 키는 서버에서 관리 중입니다.' }, 400);
  const body = await c.req.json<{ key?: unknown }>().catch(() => ({} as { key?: unknown }));
  const key = typeof body.key === 'string' ? body.key.trim() : '';
  if (!validDeepLKey(key)) return c.json({ error: 'DeepL API 키 모양이 아니에요. DeepL 계정의 API Keys에서 복사해 주세요.' }, 400);
  // 저장하기 전에 키가 실제로 되는지 DeepL에 사용량을 물어 확인한다.
  try { await deeplUsage(key); }
  catch (error) { return c.json({ error: deeplProblem(error instanceof DeepLError ? error.status : 0) }, 400); }
  try { await saveDeepLKey(c.env, key); }
  catch (error) { return c.json({ error: error instanceof TranslationError ? error.message : 'DeepL API 키를 저장하지 못했어요.' }, 503); }
  return c.json(await translationConfig(c.env, c.get('user')));
});
app.delete('/api/translation/deepl', async (c) => {
  if (!canManageX(c.env, c.get('user'))) return c.json({ error: '번역 설정은 FeedEx 운영자만 바꿀 수 있습니다.' }, 403);
  if (c.env.DEEPL_API_KEY?.trim()) return c.json({ error: '이 키는 서버에서 관리 중입니다.' }, 400);
  await clearDeepLKey(c.env);
  return c.json(await translationConfig(c.env, c.get('user')));
});

// 기사 요약은 번역과 마찬가지로 구독한 원문부터 확인한다.
app.post('/api/articles/:id/summarize', async (c) => {
  type SummaryRequest = { force?: boolean; phone?: boolean; xUrl?: unknown; xThread?: unknown };
  const body: SummaryRequest = await c.req.json<SummaryRequest>().catch(() => ({}));
  const article = await c.env.DB.prepare(
    `SELECT id, title, url, summary, content_html, full_content_html, ai_summary
     FROM articles WHERE id=? AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.feed_id=articles.feed_id AND s.user_id=?)`
  ).bind(c.req.param('id'), c.get('user').id).first<{
    id: string; title: string; url: string; summary: string | null; content_html: string | null;
    full_content_html: string | null; ai_summary: string | null;
  }>();
  if (!article) return c.json({ error: '아티클을 찾을 수 없습니다.' }, 404);
  if (body.xUrl !== undefined || xStatusUrl(article.url)) {
    const url = body.xUrl === undefined ? article.url : body.xUrl;
    if (typeof url !== 'string' || !xStatusUrl(url) || !xStatusUrl(article.url)) {
      return c.json({ error: '요약할 X 글 주소를 확인해 주세요.' }, 400);
    }
    const samePost = url === article.url;
    if (samePost && !body.force && isCurrentSummary(article.ai_summary, 'x')) {
      return c.json({ aiSummary: article.ai_summary, cached: true });
    }
    let html = verifiedXThread(c.env, url, body.xThread);
    if (!html) {
      const copy = await fetchXThread(url, article.content_html, c.env.DB, samePost ? article.title : undefined).catch(() => null);
      if (copy && !copy.partial) html = copy.html;
    }
    const posts = html ? xThreadSummaryPosts(html) : [];
    const labels = { before: '앞선 게시물', selected: '선택한 게시물', after: '이어지는 게시물' } as const;
    const parts = posts.flatMap(post => {
      const text = summaryText(post.body), quote = summaryText(post.quote);
      if (!text && !quote) return [];
      const label = `${labels[post.kind]}${post.author ? ` (${post.author})` : ''}`;
      const quoteLabel = `인용된 게시물${post.quoteAuthor ? ` (${post.quoteAuthor})` : ''}`;
      return [[`${label}:\n${text}`, quote ? `${quoteLabel}:\n${quote}` : ''].filter(Boolean).join('\n')];
    });
    if (!parts.length) return c.json({ error: '요약할 X 대화를 가져오지 못했어요. 대화를 다시 불러온 뒤 요약해 주세요.' }, 422);
    const selected = posts.find(post => post.kind === 'selected');
    const author = selected?.author;
    const includeSelectedReply = posts.some(post => post.kind === 'before') && Boolean(summaryText(selected?.body || ''));
    const title = author ? `X 대화 (${author})` : 'X 대화';
    const result = await summarizeArticleWithAI(c.env, { title, text: parts.join('\n\n'), source: 'x', includeSelectedReply });
    if (!result) return c.json({ error: 'X 글 요약을 만들지 못했어요. 잠시 후 다시 시도해 주세요.' }, 502);
    if (samePost) await c.env.DB.prepare('UPDATE articles SET ai_summary=? WHERE id=?').bind(result.summary, article.id).run();
    return c.json({ aiSummary: result.summary, cached: false });
  }
  const full = await readerBodyForArticleTools(c.env, article, body.phone === true);
  const fullText = summaryText(full || '');
  const source = fullText ? 'full' : 'feed';
  const text = fullText || summaryText(article.content_html || '') || summaryText(article.summary || '');
  if (text.length < 65) {
    return c.json({ error: '요약할 기사 본문을 충분히 가져오지 못했어요. 원문을 확인해 주세요.' }, 422);
  }
  if (!body.force && isCurrentSummary(article.ai_summary, source)) {
    return c.json({ aiSummary: article.ai_summary, cached: true });
  }
  const result = await summarizeArticleWithAI(c.env, { title: article.title, text, source });
  if (!result) return c.json({ error: '기사 요약을 만들지 못했어요. 잠시 후 다시 시도해 주세요.' }, 502);
  await c.env.DB.prepare('UPDATE articles SET ai_summary=? WHERE id=?').bind(result.summary, article.id).run();
  return c.json({ aiSummary: result.summary, cached: false });
});

// 무엇이든 쓰기 전에 OPML 전체를 읽는다. 클라이언트는 항목을 하나씩 가져온다.
app.post('/api/opml/parse', async (c) => {
  const body = await c.req.json<{ opmlXml?: string }>();
  if (typeof body.opmlXml !== 'string' || !body.opmlXml.trim()) {
    return c.json({ error: 'OPML XML 내용이 비어 있습니다.' }, 400);
  }
  try {
    const items = parseOpml(body.opmlXml);
    if (items.length === 0) {
      return c.json({ error: 'OPML 파일에서 RSS 피드 항목을 찾지 못했습니다.' }, 400);
    }
    return c.json({ items, totalFound: items.length });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'OPML 파일을 읽지 못했습니다.' }, 400);
  }
});

function validOpmlItem(item: OpmlFeed | undefined): item is OpmlFeed {
  return Boolean(item && typeof item.xmlUrl === 'string' && item.xmlUrl.trim() &&
    (item.title == null || typeof item.title === 'string') &&
    (item.htmlUrl == null || typeof item.htmlUrl === 'string') &&
    (item.folderName == null || typeof item.folderName === 'string'));
}

app.get('/api/opml/failures', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({ failures: await listOpmlFailures(c.env.DB, c.get('user').id) });
});

// 구독하지 않고, 같은 Worker 환경에서 옮겨 간 주소를 진단한다.
app.post('/api/opml/check', async (c) => {
  const body = await c.req.json<{ url?: string }>();
  let url: URL;
  try {
    if (typeof body.url !== 'string') throw new Error();
    url = new URL(body.url.trim());
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
  } catch {
    return c.json({ error: '올바른 HTTP 또는 HTTPS RSS 주소가 아닙니다.' }, 400);
  }
  try {
    const parsed = await fetchAndParseFeed(url.href, c.env.DB);
    return c.json({ ok: true, title: parsed.title, articles: parsed.articles.length });
  } catch (error) {
    return c.json({ ok: false, error: new OpmlSourceError(error).message });
  }
});

// 클라이언트도 네트워크·응답 중단 실패를 기록할 수 있다. 비공개 피드 주소는
// 사용자 본인 계정 말고 다른 어떤 서비스에도 드러내지 않는다.
app.post('/api/opml/failures', async (c) => {
  const body = await c.req.json<{ item?: OpmlFeed; error?: string }>();
  if (!validOpmlItem(body.item) || typeof body.error !== 'string' || !body.error.trim()) {
    return c.json({ error: '저장할 실패 항목을 확인해 주세요.' }, 400);
  }
  await recordOpmlFailure(c.env.DB, c.get('user').id, body.item, body.error);
  return c.json({ saved: true });
});

// 요청마다 피드 하나만 처리해서, 큰 파일이 Worker 시간이나 쿼리 한도를 다 쓰지 않게 한다.
app.post('/api/opml/import', async (c) => {
  const body = await c.req.json<{ item?: OpmlFeed; previousUrl?: string }>();
  const item = body.item;
  if (!validOpmlItem(item) || (body.previousUrl != null && typeof body.previousUrl !== 'string')) {
    return c.json({ error: '가져오기 화면을 새로고침한 뒤 OPML 파일을 다시 선택해 주세요.' }, 400);
  }
  let xmlUrl: string;
  try {
    const url = new URL(item.xmlUrl.trim());
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    xmlUrl = url.href;
  } catch {
    const error = '올바른 HTTP 또는 HTTPS RSS 주소가 아닙니다.';
    await recordOpmlFailure(c.env.DB, c.get('user').id, item, error);
    if (body.previousUrl && body.previousUrl !== item.xmlUrl) {
      await clearOpmlFailure(c.env.DB, c.get('user').id, body.previousUrl);
    }
    return c.json({ status: 'failed' as const, foldersCreated: 0, error, failureSaved: true });
  }
  try {
    const result = await importOpmlFeed(c.env.DB, c.get('user').id, { ...item, xmlUrl });
    await clearOpmlFailure(c.env.DB, c.get('user').id, xmlUrl, body.previousUrl || item.xmlUrl);
    return c.json(result);
  } catch (error) {
    const sourceError = error instanceof OpmlSourceError;
    const detail = error instanceof Error ? error.message : 'Unknown error';
    console.warn('OPML import failed', {
      stage: sourceError ? 'fetch' : 'database',
      sourceHost: new URL(xmlUrl).hostname,
      // 피드 주소의 경로·쿼리는 절대 기록하지 않는다. 비공개 피드 토큰이 들어 있을 수 있다.
      reason: detail.replace(/https?:\/\/[^\s]+/gi, '[feed URL]').slice(0, 300),
    });
    const message = sourceError
      ? error.message
      : '구독 정보를 조회하거나 저장하는 중 오류가 발생했습니다. 서버 오류 기록을 확인해야 합니다.';
    let failureSaved = false;
    try {
      await recordOpmlFailure(c.env.DB, c.get('user').id, { ...item, xmlUrl }, message);
      if (body.previousUrl && body.previousUrl !== xmlUrl) {
        await clearOpmlFailure(c.env.DB, c.get('user').id, body.previousUrl);
      }
      failureSaved = true;
    } catch {
      console.error('Could not persist OPML import failure');
    }
    return c.json({
      status: 'failed' as const,
      foldersCreated: 0,
      error: message,
      failureSaved,
      ...(sourceError && error.retryAfter ? { retryAfter: error.retryAfter } : {}),
    });
  }
});

// OPML 내보내기
app.get('/api/opml/export', async (c) => {
  const user = c.get('user');

  const foldersRes = await c.env.DB.prepare(
    'SELECT id, name FROM folders WHERE user_id = ? ORDER BY sort_order ASC, name ASC'
  )
    .bind(user.id)
    .all<{ id: string; name: string }>();

  const subsRes = await c.env.DB.prepare(
    `SELECT
       s.folder_id,
       COALESCE(s.custom_title, f.title) as title,
       f.xml_url,
       f.html_url
     FROM subscriptions s
     JOIN feeds f ON f.id = s.feed_id
     WHERE s.user_id = ?
     ORDER BY title ASC`
  )
    .bind(user.id)
    .all<{
      folder_id: string | null;
      title: string;
      xml_url: string;
      html_url: string | null;
    }>();

  const xml = generateOpml(
    user.name,
    foldersRes.results || [],
    subsRes.results || []
  );

  return new Response(xml, {
    headers: {
      'Content-Type': 'text/x-opml; charset=utf-8',
      'Content-Disposition': 'attachment; filename="feedex-subscriptions.opml"',
    },
  });
});
