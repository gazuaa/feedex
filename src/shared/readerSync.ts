import type { ArticleItem, FolderItem, SubscriptionItem } from '../client/api';

export interface ReaderSyncCursor {
  sequence: number;
  checkedAt: number;
  nextBoundary: number;
  account: string;
  blockRevision?: number;
}
export type SubscriptionMetadata = Omit<SubscriptionItem, 'total_count' | 'unread_count' | 'saved_count'>;
export type SubscriptionCounts = Pick<SubscriptionItem, 'feed_id' | 'total_count' | 'unread_count' | 'saved_count'>;
export interface ReaderSyncDelta {
  cursor: ReaderSyncCursor;
  changed: boolean;
  reset?: boolean;
  articles: ArticleItem[];
  articleChangedIds: string[];
  newArticleIds?: string[];
  removedIds: string[];
  subscriptionCounts: SubscriptionCounts[];
  subscriptions?: SubscriptionMetadata[];
  folders?: FolderItem[];
  today?: { todayCount: number; todayTotal: number };
}
