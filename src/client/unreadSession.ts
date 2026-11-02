import type { ArticleItem } from './api';

// 안 읽은 목록은 읽는 동안, 다시 확인하는 중에도 흔들리지 않는다.
// 이 세션은 메모리에만 있고, 기기의 일반 캐시는 여전히 읽은 행을 뺀다.
export class UnreadSession {
  private articles = new Map<string, ArticleItem>();
  merge(incoming: ArticleItem[], sort: 'newest' | 'oldest' = 'newest') {
    for (const article of incoming) {
      const previous = this.articles.get(article.id);
      this.articles.set(article.id, { ...article, is_read: previous?.is_read || article.is_read });
    }
    return [...this.articles.values()].sort((a, b) => (sort === 'oldest' ? -1 : 1) * (b.published_at.localeCompare(a.published_at) || b.id.localeCompare(a.id)));
  }
  update(article: ArticleItem) { this.articles.set(article.id, article); }
  patch(id: string, fields: Partial<ArticleItem>) { const article = this.articles.get(id); if (article) this.articles.set(id, { ...article, ...fields }); }
  clear() { this.articles.clear(); }
  remove(id: string) { this.articles.delete(id); }
}
