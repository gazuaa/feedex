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
import { XPostPanel, type XPostTarget } from './components/XPostPanel';
import { ResizableWorkspace } from './components/ResizableWorkspace';
import { DiscoverModal } from './components/DiscoverModal';
import { MarkAllReadDialog } from './components/MarkAllReadDialog';
import { MoveFeedDialog } from './components/MoveFeedDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { applyTheme, readStoredTheme } from './client/theme';
import { emptiesUnreadList, useMobileViewport, useScrollChrome } from './client/mobile';
import { useTextSize } from './client/textSize';
import { useMobileNavigation } from './client/navigation';
import { NativeHandoff } from './components/NativeHandoff';
import { inNativeSignInWindow } from './client/nativeApp';
import { MobileHeader, MobileDock, type LibraryTab } from './components/MobileChrome';
import { MobileLibrary } from './components/MobileLibrary';
import { ReaderCache, articlePageKey, updateCounts, updateSubscription, type ArticlePage } from './client/readerCache';
import { feedCacheVersion, preloadArticleQueries, ReaderPreloader } from './client/readerPreload';
import { filteredPage, sameListOtherTab } from './client/syncPages';
import { usePullRefresh } from './client/pullRefresh';
import { keepResumePoint, takeResumePoint, watchAppVersion } from './client/appVersion';
import { PullRefreshIndicator } from './components/PullRefreshIndicator';
import { useScrollRead } from './client/scrollRead';
import { readRowsExpired, UnreadSession } from './client/unreadSession';
import { useAutoRefresh } from './client/autoRefresh';
import { DEFAULT_AUTO_REFRESH_MINUTES } from './shared/preferences';
import { isXProfileFeed, isXStatusUrl, xProfile } from './shared/xFeed';
import { xFolderIds, parseXPost } from './client/xTimeline';
import { rememberXAvatars } from './client/xAvatars';
import { ReaderSync } from './client/readerSync';
import { DesktopContextMenu, type AppContextAction, type AppContextTarget } from './components/DesktopContextMenu';
import { ArticleResources } from './client/articleResources';
import { maintainDeviceCache } from './client/deviceContent';
import { readDevicePreferences, saveDevicePreferences, readFeedPreference, feedViewPreference } from './client/devicePreferences';
import { useListAnchor } from './client/listAnchor';
import { notifyNewArticles, useLocalNotifications } from './client/localNotifications';
import { shortcutKey } from './client/shortcutKey';
import { compileArticleBlocks, useArticleBlocks, useArticleBlockAccountSync, syncArticleBlocks, visibleArticleNeighbors } from './client/articleBlocks';
import { RssBuilderEditor } from './components/RssBuilderEditor';
import { FeedHistoryDialog } from './components/FeedHistoryDialog';
import { RenameFeedDialog } from './components/RenameFeedDialog';
import { ArticleBlockDialog } from './components/ArticleBlockDialog';

// 워커는 응답 뒤에 30초까지 일한다. 그 뒤에 받은 글을 한 번 더 맞춘다.
const REFRESH_FOLLOW_UP_MS = 31_000;

export const App: React.FC = () => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const articleBlocks = useArticleBlocks(user?.id || '');
  useArticleBlockAccountSync(user?.id || '');
  const isBlockedArticle = useMemo(() => compileArticleBlocks(articleBlocks), [articleBlocks]);
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

  // 처음 불러오는 데이터
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

  // 현재 위치와 필터
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

  // 사용자 설정
  const [layout, setLayout] = useState<LayoutMode>('magazine');
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [desktopLibraryTab, setDesktopLibraryTab] = useState<LibraryTab>('all');
  const [markReadOnScroll, setMarkReadOnScroll] = useState(false);
  const [autoRefreshMinutes, setAutoRefreshMinutes] = useState(DEFAULT_AUTO_REFRESH_MINUTES);
  // 휴대폰 전용: 폴더나 피드 목록 안의 저장 탭은 그 목록을 유지한다.
  const [savedOnly, setSavedOnly] = useState(false);

  // 글 목록과 리더 상태
  const [articles, setArticles] = useState<ArticleItem[]>([]);
  const [showBlockedArticles, setShowBlockedArticles] = useState(false);
  const [xPostTarget, setXPostTarget] = useState<XPostTarget | null>(null);
  const [renameFeed, setRenameFeed] = useState<{ accountId: string; feed: SubscriptionItem } | null>(null);
  const [historyFeed, setHistoryFeed] = useState<{ accountId: string; feed: SubscriptionItem } | null>(null);
  const [builderEditor, setBuilderEditor] = useState<{ accountId: string; id: string } | null>(null);
  const [blockDialog, setBlockDialog] = useState<{ accountId: string; article: ArticleItem | null } | null>(null);
  const { blocked: blockedArticles, visible: unblockedArticles } = useMemo(() => {
    const blocked: ArticleItem[] = [], visible: ArticleItem[] = [];
    for (const article of articles) (isBlockedArticle(article) ? blocked : visible).push(article);
    return { blocked, visible: blocked.length ? visible : articles };
  }, [articles, isBlockedArticle]);
  const blockedArticleIds = useMemo(() => new Set(blockedArticles.map((article) => article.id)), [blockedArticles]);
  const visibleArticles = showBlockedArticles ? articles : unblockedArticles;
  const [loadingArticles, setLoadingArticles] = useState(false);
  const [hasMoreArticles, setHasMoreArticles] = useState(false);
  const [loadingMoreArticles, setLoadingMoreArticles] = useState(false);
  // 지금 보이는 목록의 조회 조건. 그사이 보기가 바뀌었으면 늦게 온 이전 페이지는 버린다.
  const articleQueryRef = useRef('');
  const displayedArticleQuery = useRef('');
  const articleRequestRef = useRef(0);
  const articleListRef = useRef<HTMLElement>(null);
  const pendingScroll = useRef<number | null>(null);
  const articleCache = useRef(new Map<string, ArticleItem>());
  const blockPreviewArticles = useMemo(() => blockDialog ? [...new Map([...articleCache.current.values(), ...articles].map((article) => [article.id, article])).values()] : [], [articles, blockDialog]);
  const [restoredArticle, setRestoredArticle] = useState<ArticleItem | null>(null);
  const [refreshingFeeds, setRefreshingFeeds] = useState(false);
  const refreshingFeedsRef = useRef(false);
  // 앱을 켤 때, 앱으로 돌아올 때, 새로고침 주기마다 하는 동기화는 새로고침 버튼을 돌려서
  // 목록이 저절로 바뀌는 이유를 보여 준다.
  const [backgroundSyncs, setBackgroundSyncs] = useState(0);
  const showSync = useCallback((task: Promise<unknown>) => {
    setBackgroundSyncs((count) => count + 1);
    return task.finally(() => setBackgroundSyncs((count) => count - 1));
  }, []);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);

  // 대화상자와 모바일 사이드바
  const [discoverOpen, setDiscoverOpen] = useState(() => new URLSearchParams(window.location.search).has('x_callback'));
  const [discoverTab, setDiscoverTab] = useState<'curated' | 'opml' | 'x'>(
    new URLSearchParams(window.location.search).has('x_callback') ? 'x' : 'curated'
  );
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches);
  const isMobile = useMobileViewport();
  const chromeHidden = useScrollChrome(articleListRef, isMobile && Boolean(user) && !mobileSidebarOpen && !selectedArticleId, `${activeScope}:${activeFolderId}:${activeFeedId}:${unreadOnly}:${savedOnly}:${searchQuery}`);
  const [textSize] = useTextSize();
  useEffect(() => { document.documentElement.style.setProperty('--feedex-text-scale', String(textSize)); }, [textSize]);
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
    // 목록의 검색어와 저장 필터. 목록에 보이는 글만 읽음 처리하기 위해 둔다.
    search: string;
    savedOnly: boolean;
    // Q / W: 열린 글 위나 아래의 글만 처리한다. `older`는 그쪽이 시간상 더 오래된 쪽인지를 뜻한다.
    edge?: { articleId: string; side: 'above' | 'below'; older: boolean };
    // 키보드로 열었으므로 Enter로 확인한다.
    keyboard?: boolean;
  } | null>(null);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const markingAllReadRef = useRef(false);
  const [markReadError, setMarkReadError] = useState<string | null>(null);

  // 열어 둔 탭과 홈 화면 앱도 다시 화면에 나타날 때 새 배포로 바꾼다(appVersion.ts).
  // 바꾸기 직전에 지금 보던 목록과 글, 스크롤 위치를 남긴다.
  const resumeSource = useRef({ account: '', scope: activeScope, folderId: activeFolderId, feedId: activeFeedId, search: searchQuery, saved: savedOnly, articleId: selectedArticleId });
  resumeSource.current = { account: user?.id ?? '', scope: activeScope, folderId: activeFolderId, feedId: activeFeedId, search: searchQuery, saved: savedOnly, articleId: selectedArticleId };
  // 지금 보던 목록과 글, 스크롤 위치를 이 탭에 남긴다. 새 배포로 바꿀 때와 원문을 읽으러 이 창을 떠날 때 쓴다.
  const saveResumePoint = useCallback((original = false) => {
    const source = resumeSource.current; if (!source.account) return;
    keepResumePoint({ ...source, at: Date.now(), listScroll: articleListRef.current?.scrollTop ?? 0, readerScroll: document.querySelector('.feedex-reader-content')?.scrollTop ?? 0, ...(original ? { original: true } : {}) });
  }, []);
  useEffect(() => watchAppVersion({
    canSwap: () => {
      const focused = document.activeElement;
      const typing = focused instanceof HTMLTextAreaElement || (focused instanceof HTMLElement && focused.isContentEditable)
        || (focused instanceof HTMLInputElement && /^(?:text|search|url|email|password|number|tel)$/.test(focused.type));
      return !typing && !document.querySelector('dialog[open], [aria-modal="true"]') && !stateWrites.current.size && !markingAllReadRef.current;
    },
    beforeSwap: () => saveResumePoint(),
  }), [saveResumePoint]);
  // 원문에서 뒤로 왔을 때 브라우저가 떠나기 전 화면을 그대로 되살렸으면 남겨 둔 자리는 쓰지 않는다.
  // 남겨 두면 나중에 새로 고칠 때 엉뚱하게 그 자리로 돌아간다.
  useEffect(() => {
    const shown = (event: PageTransitionEvent) => { if (event.persisted && user?.id) takeResumePoint(user.id); };
    window.addEventListener('pageshow', shown);
    return () => window.removeEventListener('pageshow', shown);
  }, [user?.id]);

  useEffect(() => {
    if (pendingScroll.current === null) articleListRef.current?.scrollTo({ top: 0 });
  }, [activeScope, activeFolderId, activeFeedId, unreadOnly, savedOnly, searchQuery, articleSort]);

  const forgetListAnchor = useListAnchor(articleListRef, visibleArticles, `${activeScope}:${activeFolderId}:${activeFeedId}:${unreadOnly}:${savedOnly}:${committedSearch}:${articleSort}`);
  useEffect(() => { setShowBlockedArticles(false); }, [user?.id, activeScope, activeFolderId, activeFeedId]);
  useEffect(() => { setBlockDialog(null); setBuilderEditor(null); setHistoryFeed(null); setRenameFeed(null); }, [user?.id]);

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

  // HTML 루트 클래스를 테마와 맞춘다
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
  // 새 버전으로 바꾸느라 새로 고쳤거나 원문을 읽고 돌아왔으면 읽던 목록과 글을 되살린다. 휴대폰은 브라우저 기록(MobileNavigation)이
  // 목록과 글을 되살리므로 글 안 위치만 맞춘다.
  const [resumePlace, setResumePlace] = useState<{ articleId: string | null; list: number; reader: number } | null>(null);
  const resumeChecked = useRef(false);
  useEffect(() => {
    if (!user || authChecking || resumeChecked.current) return;
    resumeChecked.current = true;
    const point = takeResumePoint(user.id); if (!point) return;
    if (!isMobile) {
      setActiveScope(point.scope); setActiveFolderId(point.folderId); setActiveFeedId(point.feedId);
      setSearchQuery(point.search); setSavedOnly(point.saved); setSelectedArticleId(point.articleId);
    }
    setResumePlace({ articleId: point.articleId, list: isMobile ? 0 : point.listScroll, reader: point.articleId ? point.readerScroll : 0 });
  }, [user?.id, authChecking]);
  // 목록과 본문은 따로 받아 차례로 그려진다. 그 위치까지 내려갈 수 있을 만큼 길어지면 맞추고,
  // 5초가 지나면 그만둔다.
  useEffect(() => {
    if (!resumePlace || (resumePlace.articleId && resumePlace.articleId !== selectedArticleId)) return;
    const want = { ...resumePlace }; let tries = 0;
    const reach = (element: HTMLElement | null | undefined, top: number) => {
      if (!top) return true;
      if (!element || element.scrollHeight - element.clientHeight < top) return false;
      element.scrollTo({ top }); return true;
    };
    const timer = setInterval(() => {
      if (reach(articleListRef.current, want.list)) want.list = 0;
      if (reach(document.querySelector<HTMLElement>('.feedex-reader-content'), want.reader)) want.reader = 0;
      if ((!want.list && !want.reader) || ++tries >= 50) { clearInterval(timer); setResumePlace(null); }
    }, 100);
    return () => clearInterval(timer);
  }, [resumePlace, selectedArticleId]);
  useEffect(() => {
    if (!readerCache) return;
    const account = readerCache.account;
    const cleanup = () => void maintainDeviceCache(account);
    cleanup(); const timer = setInterval(cleanup, 3600_000);
    const clear = (event: Event) => { if ((event as CustomEvent).detail === account) readerCache.invalidate(); };
    window.addEventListener('sfeed-cache-cleared', clear);
    return () => { clearInterval(timer); window.removeEventListener('sfeed-cache-cleared', clear); };
  }, [readerCache]);
  // 처음 띄울 때 OAuth 콜백 토큰이나 저장된 토큰을 확인한다
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
      const metadata = new Map(data.subscriptions.map(sub => [sub.feed_id, sub]));
      for (const [id, article] of articleCache.current) {
        const sub = metadata.get(article.feed_id);
        if (!sub) articleCache.current.delete(id);
        else if (article.feed_title !== sub.title) articleCache.current.set(id, { ...article, feed_title: sub.title });
      }
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

  // 백그라운드 동기화는 보이는 목록과 다음에 누를 목록이 준비되면 끝난다.
  // 그래서 새로고침 버튼이 멈추면 불러오기가 끝났다는 뜻이다.
  const syncInBackground = useCallback(() => showSync(syncArticleBlocks(readerCache?.account || '').catch(() => {}).then(() => fetchBootstrap()).then(() => publishSyncedPage.current()).then(() => warmListsRef.current())), [showSync, fetchBootstrap, readerCache]);

  // 앱으로 돌아올 때 다른 기기의 변경을 반영한다. 다만 글을 누를 때마다 비싼
  // 전체 보관함 개수 조회를 돌리지는 않는다.
  const hiddenAt = useRef<number | null>(null);
  const afterAway = useRef<(away: number) => void>(() => {});
  useEffect(() => {
    if (!readerCache) return;
    const visible = () => {
      if (document.visibilityState !== 'visible') { hiddenAt.current ??= Date.now(); return; }
      if (hiddenAt.current !== null) afterAway.current(Date.now() - hiddenAt.current);
      hiddenAt.current = null;
      void syncInBackground();
    };
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
      const article = previous && !bodies.has(incoming.id) && !(previous.body_deferred && !incoming.body_deferred) ? { ...incoming, content_html: previous.content_html, full_content_html: previous.full_content_html, ai_summary: previous.ai_summary, body_deferred: previous.body_deferred } : incoming;
      if (previous) { articleCache.current.set(article.id, article); setRestoredArticle((item) => item?.id === article.id ? article : item); }
      unreadSessions.forEach((session) => session.synced(article));
    }
    for (const id of delta.removedIds) { articleCache.current.delete(id); unreadSessions.forEach((session) => session.remove(id)); setSelectedArticleId((selected) => selected === id ? null : selected); }
  };
  useLayoutEffect(() => {
    if (isMobile && mobileSidebarOpen) {
      unreadSessions.forEach((session) => session.clear());
      if (retainReadRows) setArticles((prev) => prev.filter((article) => !article.is_read));
    }
  }, [isMobile, mobileSidebarOpen, unreadSessions, unreadSession, retainReadRows]);
  // 화면을 잠갔다가 돌아오면 읽은 행을 빼고 맨 위부터 보여 준다. 글을 보던 중이면 돌아갈 목록 위치가
  // 달라지므로 그대로 두고, 읽은 행이 없으면 훑어보던 자리일 수 있으니 옮기지 않는다.
  afterAway.current = (away) => {
    const list = articleListRef.current;
    if (!retainReadRows || selectedArticleId || !readRowsExpired(away, list?.scrollTop ?? 0)) return;
    unreadSessions.forEach((session) => session.dropRead());
    if (!articles.some((article) => article.is_read)) return;
    forgetListAnchor();
    list?.scrollTo({ top: 0 });
    setArticles((rows) => rows.filter((article) => !article.is_read));
  };

  const fetchArticles = useCallback(async (): Promise<void> => {
    const cache = readerCache;
    if (!cache?.active || !readerSync || activeCache.current !== cache) return;
    if (!cache.epoch) {
      const stored = await cache.get<BootstrapResponse>('bootstrap');
      if (!stored?.cacheEpoch) await fetchBootstrap();
    }
    if (!cache.active || activeCache.current !== cache) return;
    // 새로고침처럼 오래 걸리는 작업이 끝난 뒤에 부르면, 그사이 옮긴 목록을 옛 목록이 덮어쓴다.
    if (publishSyncedPage.current !== fetchArticles) return publishSyncedPage.current();
    const request = ++articleRequestRef.current;
    const token = getStoredToken();
    const current = () => request === articleRequestRef.current && activeCache.current === cache && getStoredToken() === token && token === authenticatedToken.current;
    const qs = buildArticleQuery();
    articleQueryRef.current = qs.toString();
    const ready = readerSync.ready(qs);
    // 같은 목록에서 탭만 바꿨으면 이미 받은 글로 새 탭을 먼저 그린다. 맞는 글이 하나도 없을 때만 기다리는 화면을 보인다.
    const draft = !ready && sameListOtherTab(displayedArticleQuery.current, qs) ? filteredPage(qs, articleCache.current.values()) : [];
    if (draft.length) {
      displayedArticleQuery.current = qs.toString();
      setArticles(retainReadRows ? unreadSession.merge(draft, articleSort) : draft);
      setHasMoreArticles(false);
    }
    setLoadingArticles(!ready && displayedArticleQuery.current !== qs.toString());
    try {
      const res = ready ?? await readerSync.page(qs, current, () => Promise.allSettled([...stateWrites.current.values()]));
      if (res && current()) {
        displayedArticleQuery.current = qs.toString();
        setArticles(retainReadRows ? unreadSession.merge(res.articles, articleSort) : res.articles);
        setHasMoreArticles(Boolean(res.hasMore));
      }
    } catch { /* 오프라인이어도 캐시된 화면은 그대로 쓸 수 있다 */ }
    finally { if (current()) setLoadingArticles(false); }
  }, [readerCache, readerSync, buildArticleQuery, retainReadRows, unreadSession, fetchBootstrap, articleSort]);
  publishSyncedPage.current = fetchArticles;

  // 보관함 탭과 모든 폴더의 첫 화면을 하나씩 차례로 받는다.
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
  const preloadStart = selectedArticleId ? visibleArticles.findIndex((article) => article.id === selectedArticleId) + 1 : 0;
  const preloadRows = selectedArticleId ? visibleArticles.slice(preloadStart, preloadStart + 2) : visibleArticles.slice(0, 5);
  const preloadArticleIds = preloadRows.map((article) => `${article.id}:${preloadModes.get(article.feed_id)}`).join(':');
  useEffect(() => {
    if (!articleResources || loadingArticles || loadingBootstrap || refreshingFeeds || mobileSidebarOpen) return;
    if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
    let active = true;
    const current = () => active && document.visibilityState === 'visible';
    // 썸네일·상태 쓰기는 준비된 본문을 무효로 만들지 않는다. 취소 범위는 계정,
    // 목록·보기 선택, 캐시 세대가 정한다.
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
      // 무시한다. 버튼은 다시 시도할 수 있게 남아 있다
    } finally {
      setLoadingMoreArticles(false);
    }
  }, [user, articles, hasMoreArticles, loadingMoreArticles, retainReadRows, unreadSession, articleSort]);

  useEffect(() => {
    if (user) {
      void syncInBackground();
    }
  }, [user, syncInBackground]);

  // 받아 둔 목록은 그리기 전에 바꾼다. 앞 목록이 새 제목 아래에 한 프레임 비치지 않게 한다.
  useLayoutEffect(() => {
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
    // 목록을 고르면 같은 목록이라도 맨 위부터 보여 준다. 그사이 읽은 글이 빠져 예전 위치는 다른 글을 가리킨다.
    pendingScroll.current = null;
    forgetListAnchor();
    articleListRef.current?.scrollTo({ top: 0 });
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
  const handleSelectDesktopScope = (scope: ScopeType, folderId: string | null = null, feedId: string | null = null, tab: LibraryTab = desktopLibraryTab) => {
    unreadSessions.forEach((session) => session.clear());
    if (retainReadRows) setArticles((rows) => rows.filter((article) => !article.is_read));
    const unread = tab === 'unread';
    setUnreadOnly(unread); setSavedOnly(tab === 'saved' && (scope === 'folder' || scope === 'feed'));
    if (unread !== unreadOnly) void savePreferences({ unreadOnly: unread });
    // 검색어는 지우기 전까지 남아서, 다음에 고른 목록도 좁혀 보여 준다.
    handleSelectScope(scope === 'all' && tab === 'saved' ? 'saved' : scope, folderId, feedId);
  };
  // 사이드바 위 탭(전체·안 읽음·저장)은 고른 폴더·피드를 그대로 두고, 그 목록을 새 탭으로 거른다.
  const handleSelectDesktopTab = (tab: LibraryTab) => {
    if (tab === desktopLibraryTab) return;
    setDesktopLibraryTab(tab);
    handleSelectDesktopScope(activeScope === 'saved' ? 'all' : activeScope, activeFolderId, activeFeedId, tab);
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

      // 화면을 먼저 바꾼다
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

      // 여러 번 빠르게 바꿔도 사용자가 누른 순서를 지킨다.
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
        // 실패하면 되돌린다
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
    const passed = ids.map((id) => articleCache.current.get(id)).filter((article): article is ArticleItem => Boolean(article && !article.is_read && (showBlockedArticles || !isBlockedArticle(article))));
    if (!passed.length) return;
    const preceding = passed.map((article) => stateWrites.current.get(article.id)).filter(Boolean);
    let batch: Promise<unknown> | undefined;
    const persist = () => batch ??= Promise.allSettled(preceding).then(() => {
      if (activeCache.current !== cache || getStoredToken() !== token) return;
      return apiRequest('/api/articles/mark-read', { method: 'POST', body: JSON.stringify({ articleIds: passed.map((article) => article.id) }) });
    });
    for (const article of passed) void handleUpdateArticleState(article, { isRead: true }, persist);
  };
  useScrollRead(articleListRef, markReadOnScroll && Boolean(user) && !loadingArticles && !loadingBootstrap && !refreshingFeeds && !(isMobile && (mobileSidebarOpen || selectedArticleId)) && !discoverOpen && !markReadTarget && !blockDialog && !builderEditor && !historyFeed && !renameFeed,
    `${user?.id}:${activeScope}:${activeFolderId}:${activeFeedId}:${unreadOnly}:${savedOnly}:${committedSearch}:${layout}`, handleScrollRead);

  const handleSelectArticle = useCallback(
    (article: ArticleItem) => {
      articleCache.current.set(article.id, article);
      setXPostTarget(null);
      setSelectedArticleId(article.id);
      if (!article.is_read) {
        handleUpdateArticleState(article, { isRead: true });
      }
    },
    [handleUpdateArticleState]
  );

  const handleOpenXPost = (article: ArticleItem, url: string) => {
    if (!isXStatusUrl(url)) return;
    handleSelectArticle(article);
    const quote = parseXPost(article).quote;
    setXPostTarget({ articleId: article.id, url, quote: quote?.href === url ? quote : null });
  };
  useEffect(() => { setXPostTarget(null); }, [user?.id, activeScope, activeFeedId, activeFolderId]);

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

  // 본문 보기는 계정 설정이다. 기존의 변경분 동기화가 따로 조회하거나 글을 받지 않고
  // 다른 기기로 옮겨 준다.
  const saveFeedViewMode = (feedId: string, viewMode: ArticleViewMode, onlyIfUnset = false) => {
    const cache = readerCache, token = getStoredToken();
    if (!user || !cache?.active) return;
    // X 계정은 하나에서 고른 보기를 모든 X 계정이 함께 쓴다. 서버도 같은 규칙으로 저장한다.
    const together = !onlyIfUnset && isXProfileFeed(subscriptions.find((sub) => sub.feed_id === feedId)?.xml_url);
    const feedIds = together ? subscriptions.filter((sub) => isXProfileFeed(sub.xml_url)).map((sub) => sub.feed_id) : [feedId];
    const key = together ? 'view:x' : `view:${feedId}`, previous = stateWrites.current.get(key);
    const current = () => activeCache.current === cache && cache.active && getStoredToken() === token;
    const before = new Map(feedIds.map((id) => [id, subscriptions.find((sub) => sub.feed_id === id)?.view_mode ?? null]));
    if (!previous && !onlyIfUnset && [...before.values()].every((view) => view === viewMode)) return;
    if (!previous) before.forEach((view, id) => confirmedFeedViews.current.set(id, view));
    const apply = (ids: readonly string[], view: (id: string) => ArticleViewMode | null) => {
      const targets = new Set(ids);
      const update = (sub: SubscriptionItem) => targets.has(sub.feed_id) ? { ...sub, view_mode: view(sub.feed_id) } : sub;
      setSubscriptions((items) => items.map(update));
      cache.updateBootstrap((data) => ({ ...data, subscriptions: data.subscriptions.map(update) }));
    };
    if (!onlyIfUnset) apply(feedIds, () => viewMode);
    const work: Promise<void> = (previous ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (!current()) return;
      const result = await apiRequest<{ viewMode: ArticleViewMode; feedIds?: string[] }>(`/api/feeds/${feedId}/view-mode`, {
        method: 'PUT', body: JSON.stringify({ viewMode, ...(onlyIfUnset ? { onlyIfUnset: true } : {}) }),
      });
      if (!current()) return;
      // 서버가 실제로 저장한 X 계정 목록을 따른다. 다른 기기에서 막 구독한 계정도 함께 맞춘다.
      const saved = result.feedIds ?? feedIds;
      feedIds.forEach((id) => confirmedFeedViews.current.set(id, result.viewMode));
      if (stateWrites.current.get(key) === work) {
        apply(saved, () => result.viewMode);
        if (together && saved.length > 1) setNotice(`X 계정 ${saved.length.toLocaleString()}개에 같은 보기를 적용했어요.`);
      }
    });
    stateWrites.current.set(key, work);
    void work.catch(() => {
      if (current() && stateWrites.current.get(key) === work) {
        apply(feedIds, (id) => confirmedFeedViews.current.get(id) ?? null);
        setNotice('보기 방식을 동기화하지 못했습니다. 다시 선택해 주세요.');
      }
    }).finally(() => {
      if (stateWrites.current.get(key) === work) { stateWrites.current.delete(key); feedIds.forEach((id) => confirmedFeedViews.current.delete(id)); }
    });
  };
  const handleChangeViewMode = (feedId: string, viewMode: ArticleViewMode) => {
    saveFeedViewMode(feedId, viewMode);
  };

  // 안 읽음 목록이 붙잡아 두던 읽은 행을 놓는다. 열어 둔 글은 이어서 위아래로 옮겨 갈 수 있게 남긴다.
  const releaseReadRows = useCallback(() => {
    const open = selectedArticleId ? articleCache.current.get(selectedArticleId) : undefined;
    unreadSessions.forEach((session) => { session.clear(); if (open) session.update(open); });
  }, [selectedArticleId, unreadSessions]);

  const refreshFollowUp = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(refreshFollowUp.current), []);
  // quiet면 안내 없이 아이콘만 돌린다. 사용자가 누르지 않은 새로고침에 쓴다.
  const refreshFeeds = useCallback(async (quiet = false) => {
    if (refreshingFeedsRef.current || !readerCache?.active) return;
    refreshingFeedsRef.current = true;
    clearTimeout(refreshFollowUp.current);
    releaseReadRows();
    if (!quiet) setRefreshingFeeds(true);
    // 위쪽의 읽은 행은 새로고침하면 목록에서 빠지므로 맨 위부터 다시 시작한다.
    articleListRef.current?.scrollTo({ top: 0 });
    let counts: Promise<unknown> = Promise.resolve();
    try {
      const [{ pendingFeeds }] = await Promise.all([
        apiRequest<{ pendingFeeds?: number }>('/api/feeds/refresh', {
          method: 'POST',
          body: JSON.stringify({
            feedId: activeScope === 'feed' ? activeFeedId : undefined,
            folderId: activeScope === 'folder' ? activeFolderId : undefined,
          }),
        }),
        syncArticleBlocks(readerCache.account, true).catch(() => {}),
      ]);
      readerCache?.touch();
      // 목록은 금방 오지만 피드별 개수는 더 걸린다. 목록이 바뀌면 안내를 내리고 개수는 뒤에서 받는다.
      counts = fetchBootstrap().catch(() => {});
      await fetchArticles();
      // 남은 피드는 서버가 뒤에서 받는다. 그 시간이 지나면 받은 글을 한 번 더 맞춘다.
      if (pendingFeeds) refreshFollowUp.current = setTimeout(() => { if (readerCache.active && document.visibilityState === 'visible') void syncInBackground(); }, REFRESH_FOLLOW_UP_MS);
    } catch {
      // 무시한다
    } finally {
      refreshingFeedsRef.current = false;
      setRefreshingFeeds(false);
    }
    // 다른 폴더의 첫 화면을 받는 동안에는 아이콘만 돈다. 아이콘이 멈추면 다 받은 것이다.
    void showSync(counts.then(() => warmListsRef.current())).catch(() => {});
  }, [readerCache, activeScope, activeFeedId, activeFolderId, fetchBootstrap, fetchArticles, releaseReadRows, showSync, syncInBackground]);
  const handleRefreshFeeds = useCallback(() => refreshFeeds(), [refreshFeeds]);

  const pullDistance = usePullRefresh(isMobile && Boolean(user) && !selectedArticleId && !discoverOpen && !markReadTarget && !historyFeed && !renameFeed, refreshingFeeds, handleRefreshFeeds);

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
  // 키보드 처리기는 한 번만 연결하고, 지금 목록과 글로 묻는다.
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
      // 방금 읽은 글이 목록에서 바로 빠지게 한다.
      releaseReadRows();
      await Promise.all([fetchBootstrap(), fetchArticles()]);
      setMarkReadTarget(null);
      // 휴대폰에서 빈 목록만 남으면 보관함으로 돌아가 다음 폴더를 고르게 한다.
      if (isMobile && emptiesUnreadList(markReadTarget, unreadOnly, savedOnly)) setMobileSidebarOpen(true);
      // 다 읽었으니 새 글이 있는지 바로 확인한다. 누른 적 없는 새로고침이라 안내는 띄우지 않는다.
      void showSync(refreshFeeds(true));
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

  // 폴더나 구독을 지울 때는 확인 창을 기다린다.
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

  // 피드의 새 글을 멈추거나 다시 받는다. 구독과 그 글, 읽음·저장 상태는 그대로 둔다.
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

  // 피드의 우클릭 메뉴로 다른 폴더나 새 폴더로 옮긴다.
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
      // 무시한다
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
  // X 폴더나 X 계정을 볼 때는 목록을 X 타임라인처럼 그린다.
  const xFolders = useMemo(() => xFolderIds(folders, subscriptions), [folders, subscriptions]);
  // 구독한 X 계정의 피드 아이콘은 그 계정의 프로필 사진이다. 인용·재게시 글의 사진으로도 쓴다.
  useEffect(() => {
    rememberXAvatars(subscriptions.flatMap((sub): [string, string][] => {
      const handle = xProfile(sub.xml_url)?.username;
      return handle && sub.favicon_url && /^https:\/\/pbs\.twimg\.com\/profile_images\//.test(sub.favicon_url) ? [[handle, sub.favicon_url]] : [];
    }));
  }, [subscriptions]);
  const xTimeline = activeScope === 'folder' ? Boolean(activeFolderId && xFolders.has(activeFolderId))
    : activeScope === 'feed' && isXProfileFeed(subscriptions.find((sub) => sub.feed_id === activeFeedId)?.xml_url);
  // X 타임라인은 본문(사진·영상·인용 글)으로 줄을 그린다. 본문 없이 동기화돼 남은 글은 기기 저장본이나 서버에서 한 번에 받아 채운다.
  // 받지 못한 글은 1분 뒤에, 서버에도 없던 글은 다시 부르지 않는다.
  const xBodyRetry = useRef(new Map<string, number>());
  const deferredXIds = xTimeline ? visibleArticles.filter((article) => article.body_deferred && !article.content_html && (xBodyRetry.current.get(article.id) || 0) <= Date.now()).map((article) => article.id).join(',') : '';
  useEffect(() => {
    const cache = readerCache, resources = articleResources;
    if (!deferredXIds || !cache || !resources) return;
    // 목록이 바뀌어도 받은 본문은 그대로 쓴다. 계정이 바뀌었을 때만 버린다.
    const live = () => cache.active && activeCache.current === cache;
    const fill = (bodies: ArticleItem[]) => {
      const changes = new Map<string, Partial<ArticleItem>>();
      for (const body of bodies) {
        const latest = articleCache.current.get(body.id);
        if (!latest?.body_deferred) continue;
        changes.set(body.id, { content_html: body.content_html, full_content_html: body.full_content_html || latest.full_content_html || null, ai_summary: body.ai_summary || latest.ai_summary || null, body_deferred: false, body_load_error: false });
      }
      if (!changes.size) return;
      cache.updateMany(changes);
      for (const [id, fields] of changes) {
        unreadSessions.forEach((session) => session.patch(id, fields));
        const known = articleCache.current.get(id);
        if (known) articleCache.current.set(id, { ...known, ...fields });
      }
      setRestoredArticle((item) => item && changes.has(item.id) ? { ...item, ...changes.get(item.id) } : item);
      setArticles((rows) => rows.map((row) => changes.has(row.id) ? { ...row, ...changes.get(row.id) } : row));
    };
    void (async () => {
      const rows = deferredXIds.split(',').flatMap((id) => articleCache.current.get(id) ?? []);
      const local = (await Promise.all(rows.map((row) => resources.hydrate(row)))).filter((row) => !row.body_deferred);
      if (!live()) return;
      fill(local);
      const found = new Set(local.map((row) => row.id));
      const missing = rows.filter((row) => !found.has(row.id)).map((row) => row.id);
      for (let at = 0; at < missing.length && live(); at += 80) {
        const ids = missing.slice(at, at + 80);
        ids.forEach((id) => xBodyRetry.current.set(id, Infinity));
        try {
          const page = await apiRequest<ArticlePage>(`/api/articles?articleIds=${encodeURIComponent(ids.join(','))}`);
          if (live()) fill(page.articles);
        } catch { ids.forEach((id) => xBodyRetry.current.set(id, Date.now() + 60_000)); }
      }
    })();
  }, [deferredXIds, readerCache, articleResources, unreadSessions]);
  const selectedViewMode = user && selectedArticle
    ? feedViewPreference(user.id, selectedArticle.feed_id, selectedSubscription?.view_mode) : 'feed';
  useEffect(() => {
    if (!user || !selectedSubscription || selectedSubscription.view_mode || importedFeedViews.has(selectedSubscription.feed_id)) return;
    const legacy = readFeedPreference(user.id, selectedSubscription.feed_id).view;
    if (legacy !== 'feed' && legacy !== 'reader' && legacy !== 'web') return;
    importedFeedViews.add(selectedSubscription.feed_id);
    // 비어 있는 공유 선택만 채운다. 다른 기기가 직접 고른 값은 이 기기의 캐시 스냅숏보다
    // 나중에 골랐더라도 그쪽을 따른다.
    saveFeedViewMode(selectedSubscription.feed_id, legacy, true);
  }, [user?.id, selectedSubscription, importedFeedViews]);

  const articleNeighbors = useMemo(
    () => visibleArticleNeighbors(articles, visibleArticles, selectedArticleId),
    [articles, visibleArticles, selectedArticleId]
  );

  const handleNavigateRelative = useCallback(
    (direction: 'prev' | 'next') => {
      const next = articleNeighbors[direction];
      if (next) handleSelectArticle(next);
    },
    [articleNeighbors, handleSelectArticle]
  );

  const handleCopyLink = useCallback(async (article: ArticleItem) => {
    try {
      await navigator.clipboard.writeText(article.url);
      setNotice('링크를 복사했어요.');
    } catch {
      setNotice('링크를 복사하지 못했어요. 원문을 열어 주소를 복사해 주세요.');
    }
  }, []);

  // 전체 키보드 단축키 (↑/↓/M/S/R/A/Q/W/C/O/ESC)
  useEffect(() => {
    if (!user || markReadTarget) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // 방향키를 쓰는 메뉴가 이미 처리한 키는 넘긴다.
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

      // 한글 자판에서도 글자 단축키는 키 자리를 따른다.
      const key = shortcutKey(e);
      if (key === 'Escape') {
        if (selectedArticleId) setSelectedArticleId(null);
        else if (discoverOpen) setDiscoverOpen(false);
      } else if (e.metaKey || e.ctrlKey || e.altKey) {
        // Cmd/Ctrl+C, R, S, A, Q, W 등은 브라우저와 시스템 기능으로 남긴다.
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
        FeedEx 워크스페이스를 불러오는 중...
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

  // 맥 앱이 연 시스템 로그인 창이면 이 계정을 맥 앱에 넘길지만 묻는다.
  if (inNativeSignInWindow()) {
    return <NativeHandoff email={user.email} isDark={theme === 'dark'} onUseAnother={() => { void handleLogout(); }} />;
  }

  const isDark = theme === 'dark';
  const mobileTab: LibraryTab = activeScope === 'saved' || savedOnly ? 'saved' : unreadOnly ? 'unread' : 'all';
  const openMobileDiscover = (tab: 'curated' | 'opml' = 'curated') => { setDiscoverTab(tab); setDiscoverOpen(true); };
  const selectMobileTab = (tab: LibraryTab) => { setSavedOnly(false); handleSelectLibraryTab(tab); setMobileSidebarOpen(false); };
  // 하단 탭은 다른 목록을 여는 대신 화면에 보이는 것을 거른다. 보관함에서는 피드마다
  // 보여 줄 개수를 바꾸고, 폴더나 피드 안에서는 그 목록을 거른다.
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
  const onManageArticleBlocks = () => setBlockDialog({ accountId: user.id, article: null });
  const mobileSettings = { theme, onChangeTheme: handleChangeTheme, layout, onChangeLayout: handleChangeLayout, onOpenOpml: () => openMobileDiscover('opml'), sort: articleSort, onChangeSort: setArticleSort, markReadOnScroll, onChangeMarkReadOnScroll: handleChangeMarkReadOnScroll, autoRefreshMinutes, onChangeAutoRefreshMinutes: handleChangeAutoRefreshMinutes, accountId: user.id, onManageArticleBlocks };

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
      items.push({ id: 'block-title', label: '비슷한 글 숨기기…', separator: true, run: () => setBlockDialog({ accountId: user.id, article }) });
    } else if (feed) {
      if (feed.builder_id) items.push({ id: 'edit-builder', label: 'RSS 빌더 피드 수정…', run: () => setBuilderEditor({ accountId: user.id, id: feed.builder_id! }) });
      items.push({ id: 'rename-feed', label: '피드 이름 수정…', run: () => setRenameFeed({ accountId: user.id, feed }) });
      items.push({ id: 'feed-history', label: '과거 글 불러오기…', run: () => setHistoryFeed({ accountId: user.id, feed }) });
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
            onSelectLibraryTab={handleSelectDesktopTab}
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
            onManageArticleBlocks={onManageArticleBlocks}
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
          xPostTarget && selectedArticle?.id === xPostTarget.articleId ? <XPostPanel key={`${selectedArticle.id}:${xPostTarget.url}`} accountId={user.id} source={selectedArticle} target={xPostTarget} onBack={() => setXPostTarget(null)} isDark={isDark} /> : <ArticleDrawer
            key={selectedArticle?.id || 'empty-reader'}
            article={selectedArticle}
            resources={articleResources}
            accountId={user.id}
            onClose={() => setSelectedArticleId(null)}
            onOpenXPost={(url) => selectedArticle && handleOpenXPost(selectedArticle, url)}
            onToggleRead={handleToggleRead}
            onToggleSaved={handleToggleSaved}
            onUpdateArticleFields={handleUpdateArticleFields}
            viewMode={selectedViewMode}
            onChangeViewMode={(mode) => selectedArticle && handleChangeViewMode(selectedArticle.feed_id, mode)}
            onNavigateRelative={handleNavigateRelative}
            onCopyLink={handleCopyLink}
            onNotice={setNotice}
            onLeaveForOriginal={() => saveResumePoint(true)}
            hasPrev={Boolean(articleNeighbors.prev)}
            hasNext={Boolean(articleNeighbors.next)}
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
        {articleBlocks.some((rule) => rule.enabled) && (showBlockedArticles || blockedArticles.length > 0 || visibleArticles.length > 0 || loadingArticles || loadingBootstrap) && <div className="feedex-block-bar"><span title="피드와 폴더의 숫자는 차단 전 전체 글 기준입니다.">{showBlockedArticles ? `차단 대상 ${blockedArticles.length}개 표시 중` : `불러온 글 중 ${blockedArticles.length}개 숨김`}</span><button type="button" aria-pressed={showBlockedArticles} onClick={() => setShowBlockedArticles((value) => !value)}>{showBlockedArticles ? '차단 적용' : '숨긴 글 보기'}</button><button type="button" onClick={onManageArticleBlocks}>규칙 관리</button></div>}
        {!showBlockedArticles && blockedArticles.length > 0 && !visibleArticles.length && !loadingArticles && !loadingBootstrap ? <div className="feedex-block-empty"><p>이 페이지의 글이 모두 차단 규칙에 해당합니다.</p><p>숨긴 글을 보거나 이전 글을 더 불러올 수 있습니다.</p><button type="button" onClick={() => setShowBlockedArticles(true)}>숨긴 글 보기</button></div> : <ArticleList
          accountId={user.id}
          onUpdateArticleFields={handleUpdateArticleFields}
          onPrepareArticle={handlePrepareArticle}
          articles={visibleArticles}
          layout={layout}
          selectedArticleId={selectedArticleId}
          onSelectArticle={handleSelectArticle}
          blockedArticleIds={blockedArticleIds}
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
          timeline={xTimeline}
        />}
        {hasMoreArticles && articles.length > 0 && !loadingArticles && !loadingBootstrap && (
          <LoadMoreArticles
            auto={visibleArticles.length > 0}
            loading={loadingMoreArticles}
            isDark={isDark}
            onLoadMore={loadMoreArticles}
          />
        )}
      </ResizableWorkspace>
      {renameFeed?.accountId === user.id && <RenameFeedDialog key={`${user.id}:${renameFeed.feed.id}`} feed={renameFeed.feed} isDark={isDark} onClose={() => setRenameFeed(null)} onRenamed={async value => {
        const feedId = renameFeed.feed.feed_id;
        const renamed = (sub: SubscriptionItem) => sub.feed_id === feedId ? { ...sub, title: value.title, custom_title: value.customTitle } : sub;
        setSubscriptions(previous => previous.map(renamed));
        setArticles(previous => previous.map(article => article.feed_id === feedId ? { ...article, feed_title: value.title } : article));
        for (const [id, article] of articleCache.current) if (article.feed_id === feedId) articleCache.current.set(id, { ...article, feed_title: value.title });
        readerCache?.updateBootstrap(data => ({ ...data, subscriptions: data.subscriptions.map(renamed) }));
        readerCache?.touch(); await fetchBootstrap(); await fetchArticles(); setNotice('피드 이름을 저장했어요.');
      }} />}
      {historyFeed?.accountId === user.id && <FeedHistoryDialog key={`${user.id}:${historyFeed.feed.feed_id}`} feed={historyFeed.feed} isDark={isDark} onClose={() => setHistoryFeed(null)} onChanged={async () => { readerCache?.touch(); await Promise.all([fetchBootstrap(), fetchArticles()]); }} />}
      {builderEditor?.accountId === user.id && <RssBuilderEditor key={`${user.id}:${builderEditor.id}`} builderId={builderEditor.id} folders={folders} isDark={isDark} onClose={() => setBuilderEditor(null)} onSaved={async () => { readerCache?.touch(); await Promise.all([fetchBootstrap(), fetchArticles()]); }} />}
      {blockDialog?.accountId === user.id && <ArticleBlockDialog key={`${user.id}:${blockDialog.article?.id || 'manage'}`} accountId={user.id} article={blockDialog.article} articles={blockPreviewArticles} subscriptions={subscriptions} onClose={() => setBlockDialog(null)} onApplied={() => setNotice('차단 규칙을 저장했어요.')} />}

      {isMobile && <div className="feedex-mobile-library-host" data-open={mobileSidebarOpen || undefined}><MobileLibrary visible={mobileSidebarOpen} user={user} folders={folders} subscriptions={subscriptions} counts={counts} countTab={mobileTab} onChangeCountTab={applyMobileFilter} onSelectTab={selectMobileTab} onSelectFolder={(id) => { handleSelectScope('folder', id); setMobileSidebarOpen(false); }} onSelectFeed={(id) => { handleSelectScope('feed', null, id); setMobileSidebarOpen(false); }} onAdd={() => openMobileDiscover()} onRefresh={handleRefreshFeeds} refreshing={refreshingFeeds} syncing={backgroundSyncs > 0} onCreateFolder={handleCreateFolder} onDeleteFolder={handleDeleteFolder} onUnsubscribe={handleUnsubscribe} onToggleUpdates={handleToggleFeedUpdates} onLogout={handleLogout} {...mobileSettings} /></div>}
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

      {notice && <div className="feedex-notice" role="status" aria-live="polite">{notice}</div>}

      {/* 피드 찾기 / 피드 추가 / OPML 창 */}
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
