import type { ReaderSyncCursor } from '../shared/readerSync';
export type LayoutMode = 'magazine' | 'cards' | 'list';
export type ThemeMode = 'dark' | 'light';
export type ScopeType = 'all' | 'today' | 'saved' | 'folder' | 'feed';

export interface UserPreferences {
  layout: LayoutMode;
  theme: ThemeMode;
  unreadOnly: boolean;
  markReadOnScroll: boolean;
  autoRefreshMinutes: number;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  preferences: UserPreferences;
}

export interface FolderItem {
  id: string;
  user_id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
}

export interface SubscriptionItem {
  id: string;
  feed_id: string;
  folder_id: string | null;
  custom_title: string | null;
  xml_url: string;
  html_url: string | null;
  title: string;
  description: string | null;
  favicon_url: string | null;
  last_fetched_at: string | null;
  last_error: string | null;
  unread_count: number;
  total_count: number;
  saved_count: number;
  view_mode?: ArticleViewMode | null;
  /** 피드의 새 글을 받지 않는 동안 값이 있다. 0004가 적용되기 전에는 없다. */
  paused_at?: string | null;
}

// RSS 리더가 주는 본문 보기: 피드 본문, 원문 페이지에서 뽑은 전체 기사,
// 또는 원문 페이지 그대로.
export type ArticleViewMode = 'feed' | 'reader' | 'web';

export interface ArticleItem {
  id: string;
  feed_id: string;
  feed_title: string;
  feed_favicon: string | null;
  feed_html_url: string | null;
  folder_id: string | null;
  folder_name: string | null;
  guid: string;
  title: string;
  url: string;
  author: string | null;
  summary: string | null;
  content_html: string | null;
  full_content_html: string | null;
  ai_summary: string | null;
  thumbnail_url: string | null;
  published_at: string;
  date_source?: 'original' | 'feed' | 'updated' | 'collected';
  is_read: boolean;
  is_saved: boolean;
  body_deferred?: boolean;
  body_load_error?: boolean;
}

export interface CuratedFeedItem {
  id: string;
  title: string;
  xmlUrl: string;
  htmlUrl: string;
  description: string;
  category: string;
  folderSuggest: string;
  language: 'KO' | 'EN';
  tags: string[];
}

export interface BootstrapResponse {
  syncCursor?: ReaderSyncCursor;
  cacheEpoch?: string;
  folders: FolderItem[];
  subscriptions: SubscriptionItem[];
  counts: {
    totalUnread: number;
    totalArticles: number;
    savedCount: number;
    todayCount: number;
    todayTotal: number;
  };
  curatedFeeds: CuratedFeedItem[];
}

export interface FeedPreviewResponse {
  feed: { title: string; xmlUrl: string; htmlUrl: string | null; description: string | null };
  articles: {
    title: string;
    url: string;
    summary: string | null;
    publishedAt: string;
    dateSource?: ArticleItem['date_source'];
  }[];
}

const SESSION_STORAGE_KEY = 'sfeed_session_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(SESSION_STORAGE_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) {
    localStorage.setItem(SESSION_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem('sfeed_verified_profile');
  }
}

export function rememberProfile(user: UserProfile) {
  try { localStorage.setItem('sfeed_verified_profile', JSON.stringify({ token: getStoredToken(), user })); } catch {}
}
export function rememberedProfile(token: string): UserProfile | null {
  try { const saved = JSON.parse(localStorage.getItem('sfeed_verified_profile') || 'null'); return saved?.token === token && saved.user?.id ? saved.user : null; } catch { return null; }
}
export class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) errorMsg = data.error;
    } catch {
      // 무시한다
    }
    throw new ApiError(errorMsg, res.status);
  }

  return res.json() as Promise<T>;
}

export function formatRelativeTime(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    const diffMs = Date.now() - date.getTime();
    const diffMinutes = Math.floor(diffMs / 60_000);
    if (diffMinutes < 1) return '방금 전';
    if (diffMinutes < 60) return `${diffMinutes}분 전`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}시간 전`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}일 전`;
    // 지난해 이전의 글은 연도를 붙여야 한다. 안 그러면 2018년 글이 올해 글로 읽힌다.
    return date.toLocaleDateString('ko-KR', {
      ...(date.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }),
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

export function formatArticleDate(article: Pick<ArticleItem, 'published_at' | 'date_source'>): string {
  if (article.date_source === 'updated' || article.date_source === 'collected') return '발행일 미제공';
  return formatRelativeTime(article.published_at);
}
