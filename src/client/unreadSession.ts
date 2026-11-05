import type { ArticleItem } from './api';

// 잠깐 다른 앱을 본 정도면 읽은 행을 그대로 둔다. 이보다 오래 떠났거나, 돌아왔을 때 스크롤이
// 맨 위라 읽은 행만 먼저 보이면 새로 읽는 것으로 보고 뺀다.
const READ_ROWS_AWAY_MS = 30_000;
export const readRowsExpired = (awayMs: number, listTop: number) => awayMs >= READ_ROWS_AWAY_MS || listTop < 8;

// 안 읽은 목록은 읽는 동안, 다시 확인하는 중에도 흔들리지 않는다.
// 이 세션은 메모리에만 있고, 기기의 일반 캐시는 여전히 읽은 행을 뺀다.
export class UnreadSession {
  private articles = new Map<string, ArticleItem>();
  merge(incoming: ArticleItem[], sort: 'newest' | 'oldest' = 'newest') {
    for (const article of incoming) {
      const previous = this.articles.get(article.id);
      // 여기서 읽은 글만 남긴다. 이미 읽음으로 온 글은 다른 곳에서 읽은 것이다.
      if (article.is_read && !previous?.is_read) { this.articles.delete(article.id); continue; }
      this.articles.set(article.id, { ...article, is_read: previous?.is_read || article.is_read });
    }
    return [...this.articles.values()].sort((a, b) => (sort === 'oldest' ? -1 : 1) * (b.published_at.localeCompare(a.published_at) || b.id.localeCompare(a.id)));
  }
  update(article: ArticleItem) { this.articles.set(article.id, article); }
  patch(id: string, fields: Partial<ArticleItem>) { const article = this.articles.get(id); if (article) this.articles.set(id, { ...article, ...fields }); }
  /** 동기화로 온 글. 여기서 읽지 않았는데 읽음으로 오면 다른 기기나, 앱이 다시 뜨기 전에 읽은 것이다. */
  synced(article: ArticleItem) {
    const row = this.articles.get(article.id);
    if (!row) return;
    if (article.is_read && !row.is_read) this.articles.delete(article.id);
    else this.articles.set(article.id, { ...row, ...article });
  }
  /** 읽은 행만 뺀다. 더 불러온 안 읽은 행은 그대로라 목록이 줄어 위치를 잃지 않는다. */
  dropRead() { for (const [id, article] of this.articles) if (article.is_read) this.articles.delete(id); }
  clear() { this.articles.clear(); }
  remove(id: string) { this.articles.delete(id); }
}
