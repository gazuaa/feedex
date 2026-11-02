import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  apiRequest,
  ApiError,
  rememberProfile,
  rememberedProfile,
  getStoredToken,
  setStoredToken,
  type ArticleItem,
  type ArticleViewMode,
  type BootstrapResponse,
  type CuratedFeedItem,
  type FolderItem,
  type LayoutMode,
  type ScopeType,
  type SubscriptionItem,
  type ThemeMode,
  type UserProfile,
} from './client/api';
import { LoginView } from './components/LoginView';
import { Sidebar } from './components/Sidebar';
import { HeaderBar } from './components/HeaderBar';
import { ArticleList } from './components/ArticleList';
import { LoadMoreArticles } from './components/LoadMoreArticles';
import { ArticleDrawer } from './components/ArticleDrawer';
import { ResizableWorkspace } from './components/ResizableWorkspace';
import { DiscoverModal } from './components/DiscoverModal';
import { MarkAllReadDialog } from './components/MarkAllReadDialog';
import { MoveFeedDialog } from './components/MoveFeedDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { applyTheme, readStoredTheme } from './client/theme';
import { useMobileViewport, useScrollChrome } from './client/mobile';
import { useTextSize } from './client/textSize';
import { useMobileNavigation } from './client/navigation';
import { MobileHeader, MobileDock, type LibraryTab } from './components/MobileChrome';
import { MobileLibrary } from './components/MobileLibrary';
import { ReaderCache, articlePageKey, updateCounts, updateSubscription, type ArticlePage } from './client/readerCache';
import { feedCacheVersion, preloadArticleQueries, ReaderPreloader } from './client/readerPreload';
import { usePullRefresh } from './client/pullRefresh';
import { PullRefreshIndicator } from './components/PullRefreshIndicator';
import { useScrollRead } from './client/scrollRead';
import { UnreadSession } from './client/unreadSession';
import { useAutoRefresh } from './client/autoRefresh';
import { DEFAULT_AUTO_REFRESH_MINUTES } from './shared/preferences';
import { ReaderSync } from './client/readerSync';
import { DesktopContextMenu, type AppContextAction, type AppContextTarget } from './components/DesktopContextMenu';
import { ArticleResources } from './client/articleResources';
import { maintainDeviceCache } from './client/deviceContent';
import { readDevicePreferences, saveDevicePreferences, readFeedPreference, feedViewPreference } from './client/devicePreferences';
import { useListAnchor } from './client/listAnchor';
import { notifyNewArticles, useLocalNotifications } from './client/localNotifications';
import { shortcutKey } from './client/shortcutKey';

export const App: React.FC = () => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const authenticatedToken = useRef<string | null>(null);
  const readerCache = useMemo(() => user ? new ReaderCache(user.id) : null, [user?.id]);
  const readerSync = useMemo(() => readerCache ? new ReaderSync(readerCache, apiRequest, (articles) => notifyNewArticles(readerCache.account, articles, undefined, () => readerCache.active)) : null, [readerCache]);
  const localNotifications = useLocalNotifications(readerCache?.account ?? '');
  const notificationArticle = useRef<string | null>(null);
  const publishSyncedPage = useRef<() => Promise<void>>(async () => {});
  const warmListsRef = useRef<() => Promise<void>>(async () => {});
  const loggingOut = useRef(false);
  const applySyncedChanges = useRef<(delta: import('./shared/readerSync').ReaderSyncDelta) => void>(() => {});
  const readerPreloader = useMemo(() => readerCache ? new ReaderPreloader(readerCache) : null, [readerCache]);
  const [preloadVersion, setPreloadVersion] = useState<{ cache: ReaderCache; version: string } | null>(null);
  const activeCache = useRef(readerCache);
  activeCache.current = readerCache;
  const articleResources = useMemo(() => readerCache ? new ArticleResources(readerCache.account, () => readerCache.active && activeCache.current === readerCache) : null, [readerCache]);
  const stateWrites = useRef(new Map<string, Promise<unknown>>());
  const confirmedStates = useRef(new Map<string, ArticleItem>());
  const confirmedFeedViews = useRef(new Map<string, ArticleViewMode | null>());
  const importedFeedViews = useMemo(() => new Set<string>(), [readerCache]);
  const bootstrapFlight = useRef<{ cache: ReaderCache; revision: number; promise: Promise<void> } | null>(null);
  const bootstrapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (bootstrapTimer.current) clearTimeout(bootstrapTimer.current); bootstrapTimer.current = null; }, [readerCache]);

  // Bootstrap data
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [counts, setCounts] = useState({
    totalUnread: 0,
    totalArticles: 0,
    savedCount: 0,
    todayCount: 0,
    todayTotal: 0,
  });
  const [curatedFeeds, setCuratedFeeds] = useState<CuratedFeedItem[]>([]);
  const [loadingBootstrap, setLoadingBootstrap] = useState(true);

  // Active Navigation & Filters
  const [activeScope, setActiveScope] = useState<ScopeType>('all');
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [activeFeedId, setActiveFeedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');
  const [articleSort, setArticleSort] = useState<'newest' | 'oldest'>('newest');
  useEffect(() => {
    if (!searchQuery) { setCommittedSearch(''); return; }
    const timer = setTimeout(() => setCommittedSearch(searchQuery), 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // User Preferences
  const [layout, setLayout] = useState<LayoutMode>('magazine');
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [desktopLibraryTab, setDesktopLibraryTab] = useState<LibraryTab>('all');
  const [markReadOnScroll, setMarkReadOnScroll] = useState(false);
  const [autoRefreshMinutes, setAutoRefreshMinutes] = useState(DEFAULT_AUTO_REFRESH_MINUTES);
  // Phones only: the 저장 tab inside a folder or feed list keeps that list.
  const [savedOnly, setSavedOnly] = useState(false);

  // Articles & Reader State
  const [articles, setArticles] = useState<ArticleItem[]>([]);
  const [loadingArticles, setLoadingArticles] = useState(false);
  const [hasMoreArticles, setHasMoreArticles] = useState(false);
  const [loadingMoreArticles, setLoadingMoreArticles] = useState(false);
  // Query of the list currently shown; an older page is dropped if the view changed meanwhile.
  const articleQueryRef = useRef('');
  const displayedArticleQuery = useRef('');
  const articleRequestRef = useRef(0);
  const articleListRef = useRef<HTMLElement>(null);
  const pendingScroll = useRef<number | null>(null);
  const articleCache = useRef(new Map<string, ArticleItem>());
  const [restoredArticle, setRestoredArticle] = useState<ArticleItem | null>(null);
  const [refreshingFeeds, setRefreshingFeeds] = useState(false);
  const refreshingFeedsRef = useRef(false);
  // Syncs on launch, on returning to the app and on the refresh interval turn
  // the refresh button, so a list that changes on its own explains itself.
  const [backgroundSyncs, setBackgroundSyncs] = useState(0);
  const showSync = useCallback((task: Promise<unknown>) => {
    setBackgroundSyncs((count) => count + 1);
    return task.finally(() => setBackgroundSyncs((count) => count - 1));
  }, []);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);

  // Modals & Mobile Sidebar
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [discoverTab, setDiscoverTab] = useState<'curated' | 'opml'>(
    'curated'
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches);
  const isMobile = useMobileViewport();
  const chromeHidden = useScrollChrome(articleListRef, isMobile && Boolean(user) && !mobileSidebarOpen && !selectedArticleId, `${activeScope}:${activeFolderId}:${activeFeedId}:${unreadOnly}:${savedOnly}:${searchQuery}`);
  const [textSize] = useTextSize();
  useEffect(() => { document.documentElement.style.setProperty('--sfeed-text-scale', String(textSize)); }, [textSize]);
  useMobileNavigation(isMobile && !authChecking ? user?.id ?? null : null, {
    scope: activeScope, folderId: activeFolderId, feedId: activeFeedId,
    search: searchQuery, unread: unreadOnly, saved: savedOnly, articleId: selectedArticleId, library: mobileSidebarOpen,
  }, (location, scroll) => {
    pendingScroll.current = scroll;
    setActiveScope(location.scope);
    setActiveFolderId(location.folderId);
    setActiveFeedId(location.feedId);
    setSearchQuery(location.search);
    setUnreadOnly(location.unread);
    setSavedOnly(location.saved === true);
    setSelectedArticleId(location.articleId);
    setMobileSidebarOpen(location.library);
    setDiscoverOpen(false);
  }, () => articleListRef.current?.scrollTop ?? 0);
  const [markReadTarget, setMarkReadTarget] = useState<{
    scope: ScopeType;
    folderId: string | null;
    feedId: string | null;
    name: string;
    // The list's search and 저장 filter, so only the articles it shows are marked.
    search: string;
    savedOnly: boolean;
    // Q / W: only the articles above or below the open one; `older` is that side in time.
    edge?: { articleId: string; side: 'above' | 'below'; older: boolean };
    // Opened from the keyboard, so Enter confirms.
    keyboard?: boolean;
  } | null>(null);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const markingAllReadRef = useRef(false);
  const [markReadError, setMarkReadError] = useState<string | null>(null);

  useEffect(() => {
    if (pendingScroll.current === null) articleListRef.current?.scrollTo({ top: 0 });
  }, [activeScope, activeFolderId, activeFeedId, unreadOnly, savedOnly, searchQuery, articleSort]);

  useListAnchor(articleListRef, articles, `${activeScope}:${activeFolderId}:${activeFeedId}:${unreadOnly}:${savedOnly}:${committedSearch}:${articleSort}`);

  useLayoutEffect(() => {
    for (const article of articles) articleCache.current.set(article.id, article);
  }, [articles]);

  useEffect(() => {
    articleCache.current.clear();
    displayedArticleQuery.current = '';
    stateWrites.current.clear();
    confirmedStates.current.clear();
    confirmedFeedViews.current.clear();
    setRestoredArticle(null);
    return () => { articleRequestRef.current++; articleQueryRef.current = ''; };
  }, [user?.id]);

  // Sync HTML root class with theme
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const openNotificationLink = (account: string) => {
    const params = new URLSearchParams(window.location.search), id = params.get('article_id');
    if (id && params.get('account') === account) { notificationArticle.current = id; setSelectedArticleId(id); setMobileSidebarOpen(false); }
  };
  const applyUser = (profile: UserProfile) => {
    const prefs = readDevicePreferences(profile.id, isMobile ? 'mobile' : 'desktop', profile.preferences);
    saveDevicePreferences(profile.id, prefs, isMobile ? 'mobile' : 'desktop');
    setUser(profile); setLayout(prefs.layout); setTheme(prefs.theme); setUnreadOnly(prefs.unreadOnly);
    setDesktopLibraryTab(prefs.unreadOnly ? 'unread' : 'all'); setMarkReadOnScroll(prefs.markReadOnScroll); setAutoRefreshMinutes(prefs.autoRefreshMinutes);
  };
  useEffect(() => {
    if (!user) return;
    applyUser(user);
  }, [user?.id, isMobile]);
  useEffect(() => {
    if (!readerCache) return;
    const account = readerCache.account;
    const cleanup = () => void maintainDeviceCache(account);
    cleanup(); const timer = setInterval(cleanup, 3600_000);
    const clear = (event: Event) => { if ((event as CustomEvent).detail === account) readerCache.invalidate(); };
    window.addEventListener('sfeed-cache-cleared', clear);
    return () => { clearInterval(timer); window.removeEventListener('sfeed-cache-cleared', clear); };
  }, [readerCache]);
  // Check OAuth callback token or stored token on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const callbackToken = params.get('session_token');
    if (callbackToken) {
      setStoredToken(callbackToken);
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const token = getStoredToken();
    if (!token) {
      setAuthChecking(false);
      return;
    }

    const remembered = rememberedProfile(token);
    if (remembered) { authenticatedToken.current = token; applyUser(remembered); setAuthChecking(false); }
    apiRequest<{ user: UserProfile }>('/api/user/me', { signal: AbortSignal.timeout(8000) })
      .then((res) => {
        if (getStoredToken() !== token) return;
        authenticatedToken.current = token;
        openNotificationLink(res.user.id);
        rememberProfile(res.user); applyUser(res.user);
      })
      .catch((error) => {
        if (getStoredToken() !== token) return;
        if (error instanceof ApiError && error.status === 401) { setStoredToken(null); activeCache.current?.close(); setUser(null); }
        else { const profile = rememberedProfile(token); if (profile) { authenticatedToken.current = token; applyUser(profile); } }
      })
      .finally(() => {
        setAuthChecking(false);
      });
  }, []);

  const fetchBootstrap = useCallback((): Promise<void> => {
    const cache = readerCache;
    if (!cache?.active || !readerSync || activeCache.current !== cache) return Promise.resolve();
    if (bootstrapFlight.current?.cache === cache) return bootstrapFlight.current.promise;
    const token = getStoredToken();
    const current = () => activeCache.current === cache && cache.active && getStoredToken() === token && token === authenticatedToken.current;
    const apply = (data: BootstrapResponse) => {
      setFolders(data.folders); setSubscriptions(data.subscriptions); setCounts(data.counts); setCuratedFeeds(data.curatedFeeds); setLoadingBootstrap(false);
      const subscribed = new Set(data.subscriptions.map((sub) => sub.feed_id));
      setSelectedArticleId((id) => id && articleCache.current.has(id) && !subscribed.has(articleCache.current.get(id)!.feed_id) ? null : id);
      for (const [id, article] of articleCache.current) if (!subscribed.has(article.feed_id)) articleCache.current.delete(id);
      const version = feedCacheVersion(data);
      setPreloadVersion((prev) => prev?.cache === cache && prev.version === version ? prev : { cache, version });
    };
    const run = async () => {
      const cached = await cache.get<BootstrapResponse>('bootstrap');
      if (cached && current()) apply(cached);
      const result = await readerSync.check(current, () => Promise.allSettled([...stateWrites.current.values()]));
      if (!current()) return;
      if (result.bootstrap) apply(result.bootstrap);
      if (result.delta && result.changed) applySyncedChanges.current(result.delta);
      if (result.changed && document.visibilityState === 'visible') void publishSyncedPage.current();
    };
    const promise = run().catch(() => {}).finally(() => {
      if (current()) setLoadingBootstrap(false);
      if (bootstrapFlight.current?.promise === promise) bootstrapFlight.current = null;
    });
    bootstrapFlight.current = { cache, revision: cache.revision, promise };
    return promise;
  }, [readerCache, readerSync]);

  const scheduleBootstrap = useCallback(() => {
    if (bootstrapTimer.current) return;
    bootstrapTimer.current = setTimeout(() => { bootstrapTimer.current = null; void fetchBootstrap(); }, 10_000);
  }, [fetchBootstrap]);

  // A background sync ends once the visible list and the lists a tap opens
  // next are ready, so the turning refresh button means loading is done.
  const syncInBackground = useCallback(() => showSync(fetchBootstrap().then(() => publishSyncedPage.current()).then(() => warmListsRef.current())), [showSync, fetchBootstrap]);

  // Refresh another device's changes when returning to the app, without
  // making every article click run the expensive full-library counts query.
  useEffect(() => {
    if (!readerCache) return;
    const visible = () => { if (document.visibilityState === 'visible') void syncInBackground(); };
    const sessionChanged = (event: StorageEvent) => {
      if (event.key === 'sfeed_session_token' && event.newValue !== event.oldValue) {
        void readerCache.close().finally(() => window.location.reload());
      }
    };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('storage', sessionChanged);
    return () => { document.removeEventListener('visibilitychange', visible); window.removeEventListener('storage', sessionChanged); };
  }, [readerCache, syncInBackground]);

  const buildArticleQuery = useCallback(() => {
    const qs = new URLSearchParams({
      scope: activeScope,
      unreadOnly: String(unreadOnly),
    });
    if (articleSort === 'oldest') qs.set('sort', 'oldest');
    if (activeScope === 'folder' && activeFolderId) {
      qs.set('folderId', activeFolderId);
    }
    if (activeScope === 'feed' && activeFeedId) {
      qs.set('feedId', activeFeedId);
    }
    if (savedOnly && activeScope !== 'saved') {
      qs.set('savedOnly', 'true');
    }
    if (committedSearch.trim()) {
      qs.set('search', committedSearch.trim());
    }
    return qs;
  }, [activeScope, activeFolderId, activeFeedId, unreadOnly, savedOnly, committedSearch, articleSort]);

  const retainReadRows = unreadOnly && !savedOnly && activeScope !== 'saved';
  const unreadSessions = useMemo(() => new Map<string, UnreadSession>(), [readerCache, isMobile]);
  const unreadSession = useMemo(() => {
    if (!retainReadRows) return new UnreadSession();
    const key = articlePageKey(buildArticleQuery());
    let session = unreadSessions.get(key);
    if (!session) { session = new UnreadSession(); unreadSessions.set(key, session); }
    if (unreadSessions.size > 12) unreadSessions.delete(unreadSessions.keys().next().value!);
    return session;
  }, [unreadSessions, buildArticleQuery, retainReadRows]);
  applySyncedChanges.current = (delta) => {
    const bodies = new Set(delta.articleChangedIds);
    for (const incoming of delta.articles) {
      const previous = articleCache.current.get(incoming.id);
      const article = previous && !bodies.has(incoming.id) ? { ...incoming, content_html: previous.content_html, full_content_html: previous.full_content_html, ai_summary: previous.ai_summary, body_deferred: previous.body_deferred } : incoming;
      if (previous) { articleCache.current.set(article.id, article); setRestoredArticle((item) => item?.id === article.id ? article : item); }
      unreadSessions.forEach((session) => session.patch(article.id, article));
    }
    for (const id of delta.removedIds) { articleCache.current.delete(id); unreadSessions.forEach((session) => session.remove(id)); setSelectedArticleId((selected) => selected === id ? null : selected); }
  };
  useLayoutEffect(() => {
    if (isMobile && mobileSidebarOpen) {
      unreadSessions.forEach((session) => session.clear());
      if (retainReadRows) setArticles((prev) => prev.filter((article) => !article.is_read));
    }
  }, [isMobile, mobileSidebarOpen, unreadSessions, unreadSession, retainReadRows]);

  const fetchArticles = useCallback(async () => {
    const cache = readerCache;
    if (!cache?.active || !readerSync || activeCache.current !== cache) return;
    if (!cache.epoch) {
      const stored = await cache.get<BootstrapResponse>('bootstrap');
      if (!stored?.cacheEpoch) await fetchBootstrap();
    }
    if (!cache.active || activeCache.current !== cache) return;
    const request = ++articleRequestRef.current;
    const token = getStoredToken();
    const current = () => request === articleRequestRef.current && activeCache.current === cache && getStoredToken() === token && token === authenticatedToken.current;
    const qs = buildArticleQuery();
    articleQueryRef.current = qs.toString();
    const ready = readerSync.ready(qs);
    setLoadingArticles(!ready && displayedArticleQuery.current !== qs.toString());
    try {
      const res = ready ?? await readerSync.page(qs, current, () => Promise.allSettled([...stateWrites.current.values()]));
      if (res && current()) {
        displayedArticleQuery.current = qs.toString();
        setArticles(retainReadRows ? unreadSession.merge(res.articles, articleSort) : res.articles);
        setHasMoreArticles(Boolean(res.hasMore));
      }
    } catch { /* cached screens remain usable while offline */ }
    finally { if (current()) setLoadingArticles(false); }
  }, [readerCache, readerSync, buildArticleQuery, retainReadRows, unreadSession, fetchBootstrap, articleSort]);
  publishSyncedPage.current = fetchArticles;

  // The library tabs and every folder's first screen, downloaded one at a time.
  const warmLists = useCallback((alive: () => boolean = () => true) => {
    const cache = readerCache;
    if (!cache || !readerPreloader || preloadVersion?.cache !== cache) return Promise.resolve();
    const queries = preloadArticleQueries(buildArticleQuery(), folders.map((folder) => folder.id));
    const token = authenticatedToken.current;
    const current = () => alive() && document.visibilityState === 'visible' && activeCache.current === cache && getStoredToken() === token && token === authenticatedToken.current;
    if (!queries.length || !current()) return Promise.resolve();
    return readerPreloader.run(queries, preloadVersion.version, async (query) => {
      await Promise.allSettled([...stateWrites.current.values()]);
      if (!current() || !cache.active) throw new Error('Session changed');
      return apiRequest<ArticlePage>(`/api/articles?${query}`);
    }, current);
  }, [readerCache, readerPreloader, preloadVersion, buildArticleQuery, folders]);
  warmListsRef.current = warmLists;

  useEffect(() => {
    if (loadingBootstrap || loadingArticles || refreshingFeeds) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const start = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'visible') timer = setTimeout(() => void warmLists(() => !cancelled), 350);
    };
    start();
    document.addEventListener('visibilitychange', start);
    return () => { cancelled = true; clearTimeout(timer); document.removeEventListener('visibilitychange', start); };
  }, [warmLists, loadingBootstrap, loadingArticles, refreshingFeeds]);

  useEffect(() => {
    if (pendingScroll.current === null || loadingArticles || mobileSidebarOpen || selectedArticleId || articleQueryRef.current !== buildArticleQuery().toString()) return;
    articleListRef.current?.scrollTo({ top: pendingScroll.current });
    pendingScroll.current = null;
  }, [articles, loadingArticles, mobileSidebarOpen, selectedArticleId, buildArticleQuery]);

  const selectedBody = selectedArticleId ? articleCache.current.get(selectedArticleId) : undefined;
  useEffect(() => {
    const known = selectedArticleId ? articleCache.current.get(selectedArticleId) : undefined;
    if (!user || !readerCache || !articleResources || !selectedArticleId || known?.body_load_error) return;
    let active = true;
    const cache = readerCache;
    const load = async () => {
      if (known) {
        const local = await articleResources.hydrate(known);
        if (!local.body_deferred) return local;
      }
      const result = await cache.request(`body:${selectedArticleId}`, () => apiRequest<ArticlePage>(`/api/articles?articleId=${encodeURIComponent(selectedArticleId)}`));
      return result.articles[0];
    };
    void load().then((body) => {
      if (!active || !cache.active || activeCache.current !== cache) return;
      if (!body) { setSelectedArticleId(null); return; }
      const latest = articleCache.current.get(selectedArticleId);
      const article = { ...body, full_content_html: body.full_content_html || latest?.full_content_html || null, is_read: latest?.is_read ?? body.is_read, is_saved: latest?.is_saved ?? body.is_saved, body_deferred: false, body_load_error: false };
      cache.updateFields(article.id, article);
      unreadSessions.forEach((session) => session.patch(article.id, article));
      articleCache.current.set(article.id, article); setRestoredArticle(article);
      setArticles((rows) => rows.map((row) => row.id === article.id ? article : row));
    }).catch(() => {
      if (!active || !cache.active || !known) return;
      const article = { ...known, body_load_error: true };
      articleCache.current.set(article.id, article); setRestoredArticle(article);
      setArticles((rows) => rows.map((row) => row.id === article.id ? article : row));
    });
    return () => { active = false; };
  }, [user?.id, selectedArticleId, selectedBody?.body_deferred, selectedBody?.body_load_error, readerCache, articleResources, unreadSessions]);

  const preloadModes = useMemo(() => new Map(subscriptions.map((sub) => [sub.feed_id, user ? feedViewPreference(user.id, sub.feed_id, sub.view_mode) : 'feed'])), [subscriptions, user?.id, isMobile]);
  const preloadModesRef = useRef(preloadModes); preloadModesRef.current = preloadModes;
  const handlePrepareArticle = useCallback((article: ArticleItem, nearby: () => boolean) => {
    if (!articleResources || selectedArticleId || mobileSidebarOpen || (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
    void articleResources.preload([article], () => document.visibilityState === 'visible' && nearby(), (row) => preloadModesRef.current.get(row.feed_id) || 'feed');
  }, [articleResources, selectedArticleId, mobileSidebarOpen]);
  const preloadStart = selectedArticleId ? articles.findIndex((article) => article.id === selectedArticleId) + 1 : 0;
  const preloadRows = selectedArticleId ? articles.slice(preloadStart, preloadStart + 2) : articles.slice(0, 5);
  const preloadArticleIds = preloadRows.map((article) => `${article.id}:${preloadModes.get(article.feed_id)}`).join(':');
  useEffect(() => {
    if (!articleResources || loadingArticles || loadingBootstrap || refreshingFeeds || mobileSidebarOpen) return;
    if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
    let active = true;
    const current = () => active && document.visibilityState === 'visible';
    // Thumbnail/state writes do not invalidate prepared bodies. The account,
    // list/view selection and cache generation provide the cancellation scope.
    const start = () => { if (current()) void articleResources.preload(preloadRows, current, (article) => preloadModes.get(article.feed_id) || 'feed'); };
    const timer = setTimeout(start, selectedArticleId ? 200 : 500);
    document.addEventListener('visibilitychange', start);
    return () => { active = false; clearTimeout(timer); document.removeEventListener('visibilitychange', start); };
  }, [articleResources, preloadArticleIds, loadingArticles, loadingBootstrap, refreshingFeeds, mobileSidebarOpen, selectedArticleId]);

  const loadMoreArticles = useCallback(async () => {
    const last = articles[articles.length - 1];
    if (!user || !last || !hasMoreArticles || loadingMoreArticles) return;
    setLoadingMoreArticles(true);
    const query = articleQueryRef.current;
    try {
      const qs = new URLSearchParams(query);
      qs.set('before', last.published_at);
      qs.set('beforeId', last.id);
      const res = await apiRequest<{ articles: ArticleItem[]; hasMore?: boolean }>(
        `/api/articles?${qs.toString()}`
      );
      if (articleQueryRef.current !== query) return;
      setArticles((prev) => {
        const seen = new Set(prev.map((a) => a.id));
        const next = [...prev, ...res.articles.filter((a) => !seen.has(a.id))];
        return retainReadRows ? unreadSession.merge(next, articleSort) : next;
      });
      setHasMoreArticles(Boolean(res.hasMore));
    } catch {
      // ignore; the button stays available for another try
    } finally {
      setLoadingMoreArticles(false);
    }
  }, [user, articles, hasMoreArticles, loadingMoreArticles, retainReadRows, unreadSession, articleSort]);

  useEffect(() => {
    if (user) {
      void syncInBackground();
    }
  }, [user, syncInBackground]);

  useEffect(() => {
    if (user) {
      fetchArticles();
    }
  }, [user, fetchArticles]);

  const savePreferences = async (next: Partial<{
    layout: LayoutMode;
    theme: ThemeMode;
    unreadOnly: boolean;
    markReadOnScroll: boolean;
    autoRefreshMinutes: number;
  }>) => {
    if (user) saveDevicePreferences(user.id, next, isMobile ? 'mobile' : 'desktop');
  };

  const handleChangeLayout = (nextLayout: LayoutMode) => {
    setLayout(nextLayout);
    savePreferences({ layout: nextLayout });
  };

  const handleChangeTheme = (nextTheme: ThemeMode) => {
    setTheme(nextTheme);
    savePreferences({ theme: nextTheme });
  };

  const handleChangeMarkReadOnScroll = (enabled: boolean) => {
    setMarkReadOnScroll(enabled);
    void savePreferences({ markReadOnScroll: enabled });
  };
  const handleChangeAutoRefreshMinutes = (minutes: number) => {
    setAutoRefreshMinutes(minutes);
    void savePreferences({ autoRefreshMinutes: minutes });
  };
  useAutoRefresh(Boolean(user), autoRefreshMinutes, async () => {
    if (refreshingFeedsRef.current || !readerCache?.active) return;
    await syncInBackground();
  }, localNotifications);

  const handleSelectScope = (
    scope: ScopeType,
    folderId: string | null = null,
    feedId: string | null = null
  ) => {
    setActiveScope(scope);
    setActiveFolderId(folderId);
    setActiveFeedId(feedId);
    setSelectedArticleId(null);
  };

  const handleSelectLibraryTab = (tab: 'all' | 'unread' | 'saved') => {
    const unread = tab === 'unread';
    setUnreadOnly(unread);
    savePreferences({ unreadOnly: unread });
    handleSelectScope(tab === 'saved' ? 'saved' : 'all');
  };
  const handleSelectDesktopScope = (scope: ScopeType, folderId: string | null = null, feedId: string | null = null) => {
    unreadSessions.forEach((session) => session.clear());
    if (retainReadRows) setArticles((rows) => rows.filter((article) => !article.is_read));
    const unread = desktopLibraryTab === 'unread';
    setUnreadOnly(unread); setSavedOnly(desktopLibraryTab === 'saved' && (scope === 'folder' || scope === 'feed'));
    if (unread !== unreadOnly) void savePreferences({ unreadOnly: unread });
    // The search stays: it narrows whichever list is chosen next until it is cleared.
    handleSelectScope(scope === 'all' && desktopLibraryTab === 'saved' ? 'saved' : scope, folderId, feedId);
  };

  const handleUpdateArticleState = useCallback(
    async (
      article: ArticleItem,
      changes: { isRead?: boolean; isSaved?: boolean },
      persist?: () => Promise<unknown>
    ) => {
      const cache = readerCache;
      if (!cache || loggingOut.current) return;
      const token = authenticatedToken.current;
      article = articleCache.current.get(article.id) ?? article;
      const nextRead =
        typeof changes.isRead === 'boolean' ? changes.isRead : article.is_read;
      const nextSaved =
        typeof changes.isSaved === 'boolean' ? changes.isSaved : article.is_saved;
      const nextArticle = { ...article, is_read: nextRead, is_saved: nextSaved };
      unreadSessions.forEach((session) => session.patch(article.id, { is_read: nextRead, is_saved: nextSaved }));
      if (retainReadRows) unreadSession.update(nextArticle);
      cache.updateArticle(article, nextArticle);
      setCounts((prev) => updateCounts(prev, article, nextArticle));
      setSubscriptions((prev) => prev.map((sub) => updateSubscription(sub, article, nextArticle)));
      articleCache.current.set(article.id, nextArticle);
      setRestoredArticle((prev) => prev?.id === article.id ? nextArticle : prev);

      // Optimistic UI update
      setArticles((prev) => {
        const next = prev.map((a) =>
          a.id === article.id
            ? { ...a, is_read: nextRead, is_saved: nextSaved }
            : a
        );
        if (retainReadRows) return next;
        const savedView = savedOnly || activeScope === 'saved';
        return next.filter((a) => (!savedView || a.is_saved) && (savedView || !unreadOnly || !a.is_read));
      });

      // Preserve the user's toggle order if several updates happen quickly.
      const previous = stateWrites.current.get(article.id);
      if (!previous) confirmedStates.current.set(article.id, article);
      let precedingFailed = false;
      const operation = (previous ?? Promise.resolve()).catch(() => { precedingFailed = true; }).then(() => {
        if (activeCache.current !== cache || getStoredToken() !== token) return;
        if (persist && !precedingFailed) return persist();
        return apiRequest(`/api/articles/${article.id}/state`, {
          method: 'POST',
          body: JSON.stringify(precedingFailed ? { isRead: nextRead, isSaved: nextSaved } : changes),
        });
      });
      stateWrites.current.set(article.id, operation);
      try {
        await operation;
        if (activeCache.current === cache) confirmedStates.current.set(article.id, nextArticle);
      } catch {
        if (activeCache.current !== cache || stateWrites.current.get(article.id) !== operation) return;
        // Revert on failure
        const confirmed = confirmedStates.current.get(article.id) ?? article;
        const latest = articleCache.current.get(article.id) ?? nextArticle;
        const rollback = { ...latest, is_read: confirmed.is_read, is_saved: confirmed.is_saved };
        unreadSessions.forEach((session) => session.patch(article.id, rollback));
        cache.updateArticle(latest, rollback);
        setCounts((prev) => updateCounts(prev, latest, rollback));
        setSubscriptions((prev) => prev.map((sub) => updateSubscription(sub, latest, rollback)));
        articleCache.current.set(article.id, rollback);
        setRestoredArticle((prev) => prev?.id === article.id ? rollback : prev);
        void fetchArticles();
        scheduleBootstrap();
      } finally {
        if (stateWrites.current.get(article.id) === operation) { stateWrites.current.delete(article.id); confirmedStates.current.delete(article.id); }
      }
    },
    [readerCache, scheduleBootstrap, fetchArticles, retainReadRows, unreadSession, unreadSessions, savedOnly, activeScope, unreadOnly]
  );

  const handleScrollRead = (ids: string[]) => {
    const cache = readerCache, token = authenticatedToken.current;
    if (!cache?.active || !markReadOnScroll) return;
    const passed = ids.map((id) => articleCache.current.get(id)).filter((article): article is ArticleItem => Boolean(article && !article.is_read));
    if (!passed.length) return;
    const preceding = passed.map((article) => stateWrites.current.get(article.id)).filter(Boolean);
    let batch: Promise<unknown> | undefined;
    const persist = () => batch ??= Promise.allSettled(preceding).then(() => {
      if (activeCache.current !== cache || getStoredToken() !== token) return;
      return apiRequest('/api/articles/mark-read', { method: 'POST', body: JSON.stringify({ articleIds: passed.map((article) => article.id) }) });
    });
    for (const article of passed) void handleUpdateArticleState(article, { isRead: true }, persist);
  };
  useScrollRead(articleListRef, markReadOnScroll && Boolean(user) && !loadingArticles && !loadingBootstrap && !refreshingFeeds && !(isMobile && (mobileSidebarOpen || selectedArticleId)) && !discoverOpen && !markReadTarget,
    `${user?.id}:${activeScope}:${activeFolderId}:${activeFeedId}:${unreadOnly}:${savedOnly}:${committedSearch}:${layout}`, handleScrollRead);

  const handleSelectArticle = useCallback(
    (article: ArticleItem) => {
      articleCache.current.set(article.id, article);
      setSelectedArticleId(article.id);
      if (!article.is_read) {
        handleUpdateArticleState(article, { isRead: true });
      }
    },
    [handleUpdateArticleState]
  );

  const handleToggleRead = useCallback(
    (article: ArticleItem, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      handleUpdateArticleState(article, { isRead: !article.is_read });
    },
    [handleUpdateArticleState]
  );

  const handleToggleSaved = useCallback(
    (article: ArticleItem, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      handleUpdateArticleState(article, { isSaved: !article.is_saved });
    },
    [handleUpdateArticleState]
  );

  const handleUpdateArticleFields = (
    articleId: string,
    fields: Partial<ArticleItem>
  ) => {
    readerCache?.updateFields(articleId, fields);
    unreadSessions.forEach((session) => session.patch(articleId, fields));
    if (fields.published_at) scheduleBootstrap();
    const cached = articleCache.current.get(articleId);
    if (cached) articleCache.current.set(articleId, { ...cached, ...fields });
    setRestoredArticle((prev) => prev?.id === articleId ? { ...prev, ...fields } : prev);
    setArticles((prev) =>
      prev.map((a) => (a.id === articleId ? { ...a, ...fields } : a))
    );
  };

  // Body views are account preferences. Existing change-only sync carries them
  // to other devices without another polling request or article download.
  const saveFeedViewMode = (feedId: string, viewMode: ArticleViewMode, onlyIfUnset = false) => {
    const cache = readerCache, token = getStoredToken();
    if (!user || !cache?.active) return;
    const key = `view:${feedId}`, previous = stateWrites.current.get(key);
    const current = () => activeCache.current === cache && cache.active && getStoredToken() === token;
    const before = subscriptions.find((sub) => sub.feed_id === feedId)?.view_mode ?? null;
    if (!previous && !onlyIfUnset && before === viewMode) return;
    if (!previous) confirmedFeedViews.current.set(feedId, before);
    const apply = (view: ArticleViewMode | null) => {
      const update = (sub: SubscriptionItem) => sub.feed_id === feedId ? { ...sub, view_mode: view } : sub;
      setSubscriptions((items) => items.map(update));
      cache.updateBootstrap((data) => ({ ...data, subscriptions: data.subscriptions.map(update) }));
    };
    if (!onlyIfUnset) apply(viewMode);
    const work: Promise<void> = (previous ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (!current()) return;
      const result = await apiRequest<{ viewMode: ArticleViewMode }>(`/api/feeds/${feedId}/view-mode`, {
        method: 'PUT', body: JSON.stringify({ viewMode, ...(onlyIfUnset ? { onlyIfUnset: true } : {}) }),
      });
      if (!current()) return;
      confirmedFeedViews.current.set(feedId, result.viewMode);
      if (stateWrites.current.get(key) === work) apply(result.viewMode);
    });
    stateWrites.current.set(key, work);
    void work.catch(() => {
      if (current() && stateWrites.current.get(key) === work) {
        apply(confirmedFeedViews.current.get(feedId) ?? null);
        setNotice('보기 방식을 동기화하지 못했습니다. 다시 선택해 주세요.');
      }
    }).finally(() => {
      if (stateWrites.current.get(key) === work) { stateWrites.current.delete(key); confirmedFeedViews.current.delete(feedId); }
    });
  };
  const handleChangeViewMode = (feedId: string, viewMode: ArticleViewMode) => {
    saveFeedViewMode(feedId, viewMode);
  };

  const handleRefreshFeeds = useCallback(async () => {
    if (refreshingFeedsRef.current || !readerCache?.active) return;
    refreshingFeedsRef.current = true;
    unreadSessions.forEach((session) => session.clear());
    setRefreshingFeeds(true);
    // Read rows above leave the list once it refreshes, so start again from the top.
    articleListRef.current?.scrollTo({ top: 0 });
    try {
      await apiRequest('/api/feeds/refresh', {
        method: 'POST',
        body: JSON.stringify({
          feedId: activeScope === 'feed' ? activeFeedId : undefined,
        }),
      });
      readerCache?.touch();
      await Promise.all([fetchBootstrap(), fetchArticles()]);
      await warmListsRef.current();
    } catch {
      // ignore
    } finally {
      refreshingFeedsRef.current = false;
      setRefreshingFeeds(false);
    }
  }, [readerCache, activeScope, activeFeedId, fetchBootstrap, fetchArticles, unreadSessions]);

  const pullDistance = usePullRefresh(isMobile && Boolean(user) && !selectedArticleId && !discoverOpen && !markReadTarget, refreshingFeeds, handleRefreshFeeds);

  const askMarkRead = (side?: 'above' | 'below', keyboard = false) => {
    setMarkReadError(null);
    setMarkReadTarget({
      scope: activeScope, folderId: activeFolderId, feedId: activeFeedId,
      name: headerInfo.title, search: committedSearch.trim(), savedOnly: savedOnly && activeScope !== 'saved',
      edge: side && selectedArticle ? { articleId: selectedArticle.id, side, older: (side === 'below') === (articleSort === 'newest') } : undefined,
      keyboard,
    });
  };
  const handleMarkAllRead = () => askMarkRead();
  // The keyboard handler binds once and asks with the current list and article.
  const markReadShortcut = useRef<(side?: 'above' | 'below') => void>(() => {});
  markReadShortcut.current = (side) => askMarkRead(side, true);

  const confirmMarkAllRead = async () => {
    if (!markReadTarget || markingAllReadRef.current) return;
    markingAllReadRef.current = true;
    setMarkingAllRead(true);
    setMarkReadError(null);
    readerCache?.touch();
    try {
      await apiRequest('/api/articles/mark-all-read', {
        method: 'POST',
        body: JSON.stringify({
          scope: markReadTarget.scope,
          folderId: markReadTarget.folderId,
          feedId: markReadTarget.feedId,
          search: markReadTarget.search || undefined,
          savedOnly: markReadTarget.savedOnly || undefined,
          [markReadTarget.edge?.older ? 'olderThan' : 'newerThan']: markReadTarget.edge?.articleId,
        }),
      });
      readerCache?.touch();
      await Promise.all([fetchBootstrap(), fetchArticles()]);
      setMarkReadTarget(null);
    } catch {
      setMarkReadError('읽음 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      markingAllReadRef.current = false;
      setMarkingAllRead(false);
    }
  };

  const handleCreateFolder = async (name: string) => {
    readerCache?.touch();
    await apiRequest('/api/folders', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    readerCache?.touch();
    await fetchBootstrap();
  };

  // Deleting a folder or a subscription waits for a confirmation dialog.
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'folder' | 'feed'; id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDeleteFolder = async (folderId: string) => {
    setDeleteError(null);
    setDeleteTarget({ kind: 'folder', id: folderId, name: folders.find((folder) => folder.id === folderId)?.name || '이 폴더' });
  };

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Stops or resumes a feed's new articles while the subscription, its
  // articles and their read/saved states stay.
  const handleToggleFeedUpdates = async (feed: SubscriptionItem) => {
    const paused = !feed.paused_at;
    try {
      const { pausedAt } = await apiRequest<{ pausedAt: string | null }>(`/api/subscriptions/${feed.id}/updates`, { method: 'POST', body: JSON.stringify({ paused }) });
      const mark = <T extends SubscriptionItem>(sub: T): T => sub.id === feed.id ? { ...sub, paused_at: pausedAt } : sub;
      setSubscriptions((prev) => prev.map(mark));
      readerCache?.updateBootstrap((data) => ({ ...data, subscriptions: data.subscriptions.map(mark) }));
      setNotice(paused ? `${feed.title}: 새 글을 그만 받아요. 받은 글은 그대로 남아요.` : `${feed.title}: 새 글을 다시 받아요.`);
      await fetchBootstrap();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : '바꾸지 못했습니다. 다시 시도해 주세요.');
    }
  };

  // A feed's context menu moves it to another folder, or to a new one.
  const [moveTarget, setMoveTarget] = useState<SubscriptionItem | null>(null);
  const [movingFeed, setMovingFeed] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const confirmMoveFeed = async (target: { folderId: string | null } | { newFolder: string }) => {
    if (!moveTarget || movingFeed) return;
    setMovingFeed(true);
    setMoveError(null);
    readerCache?.touch();
    try {
      const folder = 'newFolder' in target
        ? (await apiRequest<{ folder: FolderItem }>('/api/folders', { method: 'POST', body: JSON.stringify({ name: target.newFolder }) })).folder
        : folders.find((item) => item.id === target.folderId) ?? null;
      if ((folder?.id ?? null) !== (moveTarget.folder_id ?? null)) {
        await apiRequest(`/api/subscriptions/${moveTarget.id}`, { method: 'PUT', body: JSON.stringify({ folderId: folder?.id ?? null }) });
      }
      readerCache?.touch();
      await Promise.all([fetchBootstrap(), fetchArticles()]);
      setNotice(`${moveTarget.title}: ${folder ? `‘${folder.name}’ 폴더로` : '미분류로'} 옮겼어요.`);
      setMoveTarget(null);
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : '옮기지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setMovingFeed(false);
    }
  };

  const handleUnsubscribe = async (subscriptionId: string, title: string) => {
    setDeleteError(null);
    setDeleteTarget({ kind: 'feed', id: subscriptionId, name: title });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    readerCache?.touch();
    try {
      if (deleteTarget.kind === 'folder') {
        await apiRequest(`/api/folders/${deleteTarget.id}`, { method: 'DELETE' });
        readerCache?.touch();
        if (activeFolderId === deleteTarget.id) handleSelectScope('all', null, null);
        await fetchBootstrap();
      } else {
        const feedId = subscriptions.find((sub) => sub.id === deleteTarget.id)?.feed_id;
        await apiRequest(`/api/subscriptions/${deleteTarget.id}`, { method: 'DELETE' });
        readerCache?.touch();
        if (activeScope === 'feed' && feedId && activeFeedId === feedId) handleSelectScope('all', null, null);
        await Promise.all([fetchBootstrap(), fetchArticles()]);
      }
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : '삭제하지 못했습니다.');
    } finally {
      setDeleting(false);
    }
  };

  const handleLogout = async () => {
    if (loggingOut.current) return;
    loggingOut.current = true;
    await Promise.allSettled([...stateWrites.current.values()]);
    const flushed = readerCache?.close();
    activeCache.current = null;
    try {
      await apiRequest('/api/user/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setStoredToken(null);
    authenticatedToken.current = null;
    await flushed;
    setUser(null);
    loggingOut.current = false;
    setArticles([]);
    setFolders([]);
    setSubscriptions([]);
    setCounts({ totalUnread: 0, totalArticles: 0, savedCount: 0, todayCount: 0, todayTotal: 0 });
    setActiveScope('all'); setActiveFeedId(null); setActiveFolderId(null); setSearchQuery(''); setSavedOnly(false);
    setMobileSidebarOpen(isMobile);
    setLoadingBootstrap(true);
    setSelectedArticleId(null);
  };

  const selectedArticle = useMemo(
    () => articles.find((a) => a.id === selectedArticleId) || (selectedArticleId ? articleCache.current.get(selectedArticleId) : null) || (restoredArticle?.id === selectedArticleId ? restoredArticle : null) || null,
    [articles, selectedArticleId, restoredArticle]
  );
  useEffect(() => {
    if (!user || !('serviceWorker' in navigator)) return;
    const open = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type === 'sfeed-open-article' && data.account === user.id && typeof data.articleId === 'string' && data.articleId.length <= 200) {
        notificationArticle.current = data.articleId; setSelectedArticleId(data.articleId); setMobileSidebarOpen(false);
      }
    };
    navigator.serviceWorker.addEventListener('message', open);
    return () => navigator.serviceWorker.removeEventListener('message', open);
  }, [user?.id]);
  useEffect(() => {
    if (selectedArticle && notificationArticle.current === selectedArticle.id) {
      notificationArticle.current = null;
      if (!selectedArticle.is_read) void handleUpdateArticleState(selectedArticle, { isRead: true });
    }
  }, [selectedArticle, handleUpdateArticleState]);
  const selectedSubscription = subscriptions.find((sub) => sub.feed_id === selectedArticle?.feed_id);
  const selectedViewMode = user && selectedArticle
    ? feedViewPreference(user.id, selectedArticle.feed_id, selectedSubscription?.view_mode) : 'feed';
  useEffect(() => {
    if (!user || !selectedSubscription || selectedSubscription.view_mode || importedFeedViews.has(selectedSubscription.feed_id)) return;
    const legacy = readFeedPreference(user.id, selectedSubscription.feed_id).view;
    if (legacy !== 'feed' && legacy !== 'reader' && legacy !== 'web') return;
    importedFeedViews.add(selectedSubscription.feed_id);
    // Only initialize an empty shared choice; another device's explicit choice
    // wins even when it was made after this device's cached snapshot.
    saveFeedViewMode(selectedSubscription.feed_id, legacy, true);
  }, [user?.id, selectedSubscription, importedFeedViews]);

  const selectedIndex = useMemo(
    () => articles.findIndex((a) => a.id === selectedArticleId),
    [articles, selectedArticleId]
  );

  const handleNavigateRelative = useCallback(
    (direction: 'prev' | 'next') => {
      if (articles.length === 0) return;
      if (selectedIndex === -1) {
        handleSelectArticle(articles[0]);
        return;
      }
      const nextIdx =
        direction === 'next'
          ? Math.min(articles.length - 1, selectedIndex + 1)
          : Math.max(0, selectedIndex - 1);
      if (nextIdx !== selectedIndex) {
        handleSelectArticle(articles[nextIdx]);
      }
    },
    [articles, selectedIndex, handleSelectArticle]
  );

  const handleCopyLink = useCallback(async (article: ArticleItem) => {
    try {
      await navigator.clipboard.writeText(article.url);
      setNotice('링크를 복사했어요.');
    } catch {
      setNotice('링크를 복사하지 못했어요. 원문을 열어 주소를 복사해 주세요.');
    }
  }, []);

  // Global Keyboard Shortcuts (↑/↓/M/S/R/A/Q/W/C/O/ESC)
  useEffect(() => {
    if (!user || markReadTarget) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // A menu that took the arrow keys has already handled them.
      if (e.defaultPrevented || document.querySelector('dialog[open]')) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      // Letters stay on their keys under a Hangul layout too.
      const key = shortcutKey(e);
      if (key === 'Escape') {
        if (selectedArticleId) setSelectedArticleId(null);
        else if (discoverOpen) setDiscoverOpen(false);
      } else if (e.metaKey || e.ctrlKey || e.altKey) {
        // Cmd/Ctrl+C, R, S, A, Q, W and the rest stay the browser's and the system's.
      } else if (key === 'ArrowDown') {
        e.preventDefault();
        handleNavigateRelative('next');
      } else if (key === 'ArrowUp') {
        e.preventDefault();
        handleNavigateRelative('prev');
      } else if (key === 'm' && selectedArticle) {
        e.preventDefault();
        handleToggleRead(selectedArticle);
      } else if (key === 's' && selectedArticle) {
        e.preventDefault();
        handleToggleSaved(selectedArticle);
      } else if (key === 'r') {
        e.preventDefault();
        handleRefreshFeeds();
      } else if (key === 'a') {
        e.preventDefault();
        markReadShortcut.current();
      } else if ((key === 'q' || key === 'w') && selectedArticle) {
        e.preventDefault();
        markReadShortcut.current(key === 'q' ? 'above' : 'below');
      } else if (key === 'c' && selectedArticle) {
        e.preventDefault();
        void handleCopyLink(selectedArticle);
      } else if (key === 'o' && selectedArticle) {
        e.preventDefault();
        window.open(selectedArticle.url, '_blank', 'noopener,noreferrer');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    user,
    selectedArticleId,
    selectedArticle,
    discoverOpen,
    markReadTarget,
    handleNavigateRelative,
    handleToggleRead,
    handleToggleSaved,
    handleRefreshFeeds,
    handleCopyLink,
  ]);

  const headerInfo = useMemo(() => {
    if (activeScope === 'today') {
      return {
        title: '오늘의 아티클 (Today)',
        subtitle: '최근 24시간 동안 발행된 새로운 소식',
      };
    }
    if (activeScope === 'saved') {
      return {
        title: '나중에 읽기 (Read Later)',
        subtitle: '북마크로 저장해 둔 아티클 모음',
      };
    }
    if (activeScope === 'folder' && activeFolderId) {
      const folder = folders.find((f) => f.id === activeFolderId);
      return {
        title: folder ? folder.name : '폴더',
        subtitle: '카테고리 폴더 내 전체 피드 아티클',
      };
    }
    if (activeScope === 'feed' && activeFeedId) {
      const sub = subscriptions.find((s) => s.feed_id === activeFeedId);
      return {
        title: sub ? sub.title : '피드',
        subtitle: sub?.description || sub?.xml_url || '',
      };
    }
    return {
      title: unreadOnly ? '안 읽은 글' : '전체 피드 (All Feeds)',
      subtitle: `구독 중인 ${subscriptions.length}개 피드의 최신 아티클 스트림`,
    };
  }, [activeScope, activeFolderId, activeFeedId, folders, subscriptions, unreadOnly]);

  if (authChecking) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 text-sm">
        SFeed 워크스페이스를 불러오는 중...
      </div>
    );
  }

  if (!user) {
    return (
      <LoginView
        theme={theme}
        onChangeTheme={handleChangeTheme}
        onLoginSuccess={(loggedInUser) => {
          authenticatedToken.current = getStoredToken();
          openNotificationLink(loggedInUser.id);
          rememberProfile(loggedInUser); applyUser(loggedInUser);
        }}
      />
    );
  }

  const isDark = theme === 'dark';
  const mobileTab: LibraryTab = activeScope === 'saved' || savedOnly ? 'saved' : unreadOnly ? 'unread' : 'all';
  const openMobileDiscover = (tab: 'curated' | 'opml' = 'curated') => { setDiscoverTab(tab); setDiscoverOpen(true); };
  const selectMobileTab = (tab: LibraryTab) => { setSavedOnly(false); handleSelectLibraryTab(tab); setMobileSidebarOpen(false); };
  // The dock tabs filter what is on screen instead of opening another list:
  // on the library they switch which count each feed shows, and inside a
  // folder or feed they filter that list.
  const applyMobileFilter = (tab: LibraryTab) => {
    if (activeScope === 'saved') setActiveScope('all');
    const unread = tab === 'unread';
    setSavedOnly(tab === 'saved');
    if (tab !== 'saved' && unread !== unreadOnly) {
      setUnreadOnly(unread);
      savePreferences({ unreadOnly: unread });
    }
    setSelectedArticleId(null);
  };
  const filterMobileList = (tab: LibraryTab) => {
    if (activeScope === 'folder' || activeScope === 'feed') applyMobileFilter(tab);
    else selectMobileTab(tab);
  };
  const mobileSettings = { theme, onChangeTheme: handleChangeTheme, layout, onChangeLayout: handleChangeLayout, onOpenOpml: () => openMobileDiscover('opml'), sort: articleSort, onChangeSort: setArticleSort, markReadOnScroll, onChangeMarkReadOnScroll: handleChangeMarkReadOnScroll, autoRefreshMinutes, onChangeAutoRefreshMinutes: handleChangeAutoRefreshMinutes, accountId: user.id };

  const contextActions = (target: AppContextTarget): AppContextAction[] => {
    const items: AppContextAction[] = [];
    const openScope = (scope: ScopeType, folderId: string | null = null, feedId: string | null = null) => {
      if (isMobile) { handleSelectScope(scope === 'all' && mobileTab === 'saved' ? 'saved' : scope, folderId, feedId); setMobileSidebarOpen(false); }
      else handleSelectDesktopScope(scope, folderId, feedId);
    };
    if (target.selection) items.push({ id: 'copy-text', label: '선택한 텍스트 복사', run: () => navigator.clipboard.writeText(target.selection!) });
    const article = target.articleId ? articleCache.current.get(target.articleId) : null;
    const feed = target.feedId ? subscriptions.find((sub) => sub.feed_id === target.feedId) : null;
    const folder = target.folderId ? folders.find((item) => item.id === target.folderId) : null;
    if (article) {
      items.push({ id: 'open-article', label: '앱에서 글 열기', run: () => handleSelectArticle(article) },
        { id: 'read', label: article.is_read ? '안 읽음으로 표시' : '읽음으로 표시', run: () => handleUpdateArticleState(articleCache.current.get(article.id) ?? article, { isRead: !(articleCache.current.get(article.id) ?? article).is_read }) },
        { id: 'save', label: article.is_saved ? '저장 취소' : '나중에 읽기', run: () => handleUpdateArticleState(articleCache.current.get(article.id) ?? article, { isSaved: !(articleCache.current.get(article.id) ?? article).is_saved }) });
    } else if (feed) {
      items.push({ id: 'open-feed', label: '피드 글 보기', run: () => openScope('feed', null, feed.feed_id) },
        { id: 'mark-feed', label: '피드 모두 읽음', run: () => { setMarkReadError(null); setMarkReadTarget({ scope: 'feed', feedId: feed.feed_id, folderId: null, name: feed.title, search: '', savedOnly: false }); } },
        { id: 'move-feed', label: '폴더 옮기기…', run: () => { setMoveError(null); setMoveTarget(feed); } },
        { id: 'updates', label: feed.paused_at ? '업데이트 다시 받기' : '업데이트 중지', separator: true, run: () => handleToggleFeedUpdates(feed) },
        { id: 'unsubscribe', label: '구독 취소…', danger: true, run: () => handleUnsubscribe(feed.id, feed.title) });
    } else if (folder) {
      items.push({ id: 'open-folder', label: '폴더 글 보기', run: () => openScope('folder', folder.id) },
        { id: 'mark-folder', label: '폴더 모두 읽음', run: () => { setMarkReadError(null); setMarkReadTarget({ scope: 'folder', folderId: folder.id, feedId: null, name: folder.name, search: '', savedOnly: false }); } },
        { id: 'delete-folder', label: '폴더 삭제…', danger: true, separator: true, run: () => handleDeleteFolder(folder.id) });
    }
    const url = target.link || article?.url || feed?.html_url;
    if (url) items.push({ id: 'open-original', label: '원문 새 탭에서 열기', separator: true, run: () => { window.open(url, '_blank', 'noopener,noreferrer'); } },
      { id: 'copy-link', label: '링크 복사', run: () => navigator.clipboard.writeText(url) });
    if (!article && !feed && !folder) items.push({ id: 'all', label: '전체 글 보기', run: () => openScope('all') },
      { id: 'refresh', label: '피드 새로고침', run: handleRefreshFeeds }, { id: 'add', label: '피드 추가', run: () => openMobileDiscover() });
    return items;
  };

  return (
    <>
      <DesktopContextMenu enabled touch={isMobile} actions={contextActions} />
      <ResizableWorkspace
        key={user.id}
        userId={user.id}
        isDark={isDark}
        inactive={isMobile && mobileSidebarOpen}
        mobileReaderOpen={isMobile && Boolean(selectedArticle)}
        listRef={articleListRef}
        sidebar={
          <Sidebar
            user={user}
            folders={folders}
            subscriptions={subscriptions}
            counts={counts}
            unreadOnly={unreadOnly}
            libraryTab={desktopLibraryTab}
            activeScope={activeScope}
            activeFolderId={activeFolderId}
            activeFeedId={activeFeedId}
            onSelectScope={handleSelectDesktopScope}
            onSelectLibraryTab={setDesktopLibraryTab}
            onOpenDiscover={(tab = 'curated') => {
              setDiscoverTab(tab);
              setDiscoverOpen(true);
            }}
            onCreateFolder={handleCreateFolder}
            onDeleteFolder={handleDeleteFolder}
            onUnsubscribe={handleUnsubscribe}
            onToggleUpdates={handleToggleFeedUpdates}
            onLogout={handleLogout}
            isDark={isDark}
            mobileOpen={false}
            onCloseMobile={() => setMobileSidebarOpen(false)}
          />
        }
        header={
          <>
          <div className="lg:hidden"><MobileHeader hidden={chromeHidden} title={headerInfo.title.replace(/\s*\([^)]*\)/g, '')} search={searchQuery} onSearch={setSearchQuery} onBack={() => setMobileSidebarOpen(true)} onAdd={() => openMobileDiscover()} {...mobileSettings} /></div>
          <div className="hidden lg:block"><HeaderBar
            sort={articleSort}
            onToggleSort={() => setArticleSort((sort) => sort === 'newest' ? 'oldest' : 'newest')}
            accountId={user.id}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            layout={layout}
            onChangeLayout={handleChangeLayout}
            theme={theme}
            onChangeTheme={handleChangeTheme}
            onRefresh={handleRefreshFeeds}
            refreshing={refreshingFeeds}
            syncing={backgroundSyncs > 0}
            onMarkAllRead={handleMarkAllRead}
            onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
            markReadOnScroll={markReadOnScroll}
            onChangeMarkReadOnScroll={handleChangeMarkReadOnScroll}
            autoRefreshMinutes={autoRefreshMinutes}
            onChangeAutoRefreshMinutes={handleChangeAutoRefreshMinutes}
          /></div>
          </>
        }
        reader={
          <ArticleDrawer
            key={selectedArticle?.id || 'empty-reader'}
            article={selectedArticle}
            resources={articleResources}
            accountId={user.id}
            onClose={() => setSelectedArticleId(null)}
            onToggleRead={handleToggleRead}
            onToggleSaved={handleToggleSaved}
            onUpdateArticleFields={handleUpdateArticleFields}
            viewMode={selectedViewMode}
            onChangeViewMode={(mode) => selectedArticle && handleChangeViewMode(selectedArticle.feed_id, mode)}
            onNavigateRelative={handleNavigateRelative}
            onCopyLink={handleCopyLink}
            hasPrev={selectedIndex > 0}
            hasNext={selectedIndex >= 0 && selectedIndex < articles.length - 1}
            isDark={isDark}
          />
        }
        footer={
          <footer
            className={`hidden lg:flex shrink-0 flex-wrap gap-2 items-center justify-between px-8 py-2 border-t text-[11px] ${
              isDark
                ? 'bg-slate-950 border-slate-900 text-slate-500'
                : 'bg-white border-slate-200 text-slate-400'
            }`}
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>
                <strong className="text-slate-400">↑ / ↓</strong> 이전·다음 아티클
              </span>
              <span>
                <strong className="text-slate-400">M</strong> 읽음/안읽음 토글
              </span>
              <span>
                <strong className="text-slate-400">S</strong> 나중에 읽기 북마크
              </span>
              <span>
                <strong className="text-slate-400">R</strong> 피드 새로고침
              </span>
              <span>
                <strong className="text-slate-400">A</strong> 모두 읽음
              </span>
              <span>
                <strong className="text-slate-400">Q / W</strong> 선택 글 위·아래 모두 읽음
              </span>
              <span>
                <strong className="text-slate-400">C</strong> 링크 복사
              </span>
              <span>
                <strong className="text-slate-400">O</strong> 원문 열기
              </span>
              <span>
                <strong className="text-slate-400">ESC</strong> 리더 뷰 닫기
              </span>
            </div>
            <div>Cloudflare Workers · D1 SQLite · Workers AI</div>
          </footer>
        }
      >
        <ArticleList
          accountId={user.id}
          onUpdateArticleFields={handleUpdateArticleFields}
          onPrepareArticle={handlePrepareArticle}
          articles={articles}
          layout={layout}
          selectedArticleId={selectedArticleId}
          onSelectArticle={handleSelectArticle}
          onToggleRead={handleToggleRead}
          onToggleSaved={handleToggleSaved}
          onOpenDiscover={() => {
            setDiscoverTab('curated');
            setDiscoverOpen(true);
          }}
          isDark={isDark}
          loading={loadingArticles || loadingBootstrap}
          hasSubscriptions={subscriptions.length > 0}
          retainReadRows={retainReadRows}
        />
        {hasMoreArticles && articles.length > 0 && !loadingArticles && !loadingBootstrap && (
          <LoadMoreArticles
            loading={loadingMoreArticles}
            isDark={isDark}
            onLoadMore={loadMoreArticles}
          />
        )}
      </ResizableWorkspace>

      {isMobile && <div className="sfeed-mobile-library-host" data-open={mobileSidebarOpen || undefined}><MobileLibrary visible={mobileSidebarOpen} user={user} folders={folders} subscriptions={subscriptions} counts={counts} countTab={mobileTab} onChangeCountTab={applyMobileFilter} onSelectTab={selectMobileTab} onSelectFolder={(id) => { handleSelectScope('folder', id); setMobileSidebarOpen(false); }} onSelectFeed={(id) => { handleSelectScope('feed', null, id); setMobileSidebarOpen(false); }} onAdd={() => openMobileDiscover()} onRefresh={handleRefreshFeeds} refreshing={refreshingFeeds} syncing={backgroundSyncs > 0} onCreateFolder={handleCreateFolder} onDeleteFolder={handleDeleteFolder} onUnsubscribe={handleUnsubscribe} onToggleUpdates={handleToggleFeedUpdates} onLogout={handleLogout} {...mobileSettings} /></div>}
      {isMobile && !selectedArticle && <PullRefreshIndicator distance={pullDistance} refreshing={refreshingFeeds} />}
      {!mobileSidebarOpen && !selectedArticle && <MobileDock hidden={chromeHidden} active={mobileTab} onSelect={filterMobileList} onRefresh={handleRefreshFeeds} refreshing={refreshingFeeds} syncing={backgroundSyncs > 0} onMarkAllRead={handleMarkAllRead} onAdd={() => openMobileDiscover()} />}

      {markReadTarget && (
        <MarkAllReadDialog
          scopeName={markReadTarget.name}
          search={markReadTarget.search}
          savedOnly={markReadTarget.savedOnly}
          side={markReadTarget.edge?.side}
          focusConfirm={markReadTarget.keyboard}
          isDark={isDark}
          busy={markingAllRead}
          error={markReadError}
          onCancel={() => { if (!markingAllRead) setMarkReadTarget(null); }}
          onConfirm={confirmMarkAllRead}
        />
      )}

      {moveTarget && (
        <MoveFeedDialog
          feedTitle={moveTarget.title}
          folders={folders}
          currentFolderId={moveTarget.folder_id ?? null}
          isDark={isDark}
          busy={movingFeed}
          error={moveError}
          onCancel={() => { if (!movingFeed) setMoveTarget(null); }}
          onMove={confirmMoveFeed}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={deleteTarget.kind === 'folder' ? '폴더를 삭제할까요?' : '구독을 취소할까요?'}
          confirmLabel={deleteTarget.kind === 'folder' ? '폴더 삭제' : '구독 취소'}
          busyLabel="삭제 중…"
          tone="danger"
          isDark={isDark}
          busy={deleting}
          error={deleteError}
          onCancel={() => { if (!deleting) setDeleteTarget(null); }}
          onConfirm={confirmDelete}
        >
          {deleteTarget.kind === 'folder' ? (
            <p><strong>{deleteTarget.name}</strong> 폴더를 삭제합니다. 안에 있던 피드 {subscriptions.filter((sub) => sub.folder_id === deleteTarget.id).length}개는 구독을 유지한 채 미분류로 옮겨집니다.</p>
          ) : (
            <p><strong>{deleteTarget.name}</strong> 피드를 목록에서 뺍니다. 나중에 다시 구독하면 지금까지의 글과 읽음·저장 기록이 그대로 돌아옵니다.</p>
          )}
        </ConfirmDialog>
      )}

      {notice && <div className="sfeed-notice" role="status" aria-live="polite">{notice}</div>}

      {/* Discover / Add Feed / OPML Modal */}
      <DiscoverModal
        isOpen={discoverOpen}
        initialTab={discoverTab}
        onClose={() => setDiscoverOpen(false)}
        curatedFeeds={curatedFeeds}
        folders={folders}
        subscriptions={subscriptions}
        onSubscribed={async () => {
          readerCache?.touch();
          await Promise.all([fetchBootstrap(), fetchArticles()]);
        }}
        isDark={isDark}
      />
    </>
  );
};
