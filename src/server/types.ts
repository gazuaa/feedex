import type { BrowserWorker } from '@cloudflare/puppeteer';

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta?: Record<string, unknown>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run(): Promise<{ success: boolean; meta?: Record<string, unknown> }>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
}

export interface WorkersAILike {
  run(
    model: string,
    inputs: {
      messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
      prompt?: string;
      max_tokens?: number;
      temperature?: number;
    }
  ): Promise<{ response?: string; result?: { response?: string } }>;
}

export interface Env {
  DB: D1DatabaseLike;
  BROWSER?: BrowserWorker;
  AI?: WorkersAILike;
  ASSETS?: {
    fetch(request: Request): Promise<Response>;
  };
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  JWT_SECRET?: string;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  X_SETTINGS_SECRET?: string;
  OWNER_EMAIL?: string;
  AI_MODEL?: string;
  // 확인하지 않은 이메일 로그인(/api/auth/google/quick)을 켠다. 로컬 개발 전용이며 운영에서는 절대 설정하지 않는다.
  ALLOW_QUICK_LOGIN?: string;
}

export interface UserPreferences {
  layout: 'magazine' | 'cards' | 'list';
  theme: 'dark' | 'light';
  unreadOnly: boolean;
  markReadOnScroll: boolean;
  autoRefreshMinutes: number;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  google_id: string | null;
  preferences_json: string;
  created_at: string;
}

export interface FolderRecord {
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
  view_mode: 'feed' | 'reader' | 'web' | null;
}

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
  date_source?: string;
  is_read: boolean;
  is_saved: boolean;
}

export interface CuratedFeed {
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
