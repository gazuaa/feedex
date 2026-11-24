import type { ArticleItem } from './api';
import { xFeedAccount } from './xTimeline';

/*
 * 여러 X 계정이 같은 글을 재게시하면 계정마다 따로 저장돼 목록에 같은 글이 여러 번 나온다.
 * 목록에서는 같은 원글을 하나로 묶고, 재게시한 사람을 모아 보여 준다. 저장된 글은 그대로 두고 화면에서만 묶는다.
 */

/** 원글을 가리키는 열쇠. 재게시 글의 주소는 원글 주소(x.com/작성자/status/번호)다. X 글이 아니면 null. */
export function repostKey(article: Pick<ArticleItem, 'url'>): string | null {
  const id = /^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[a-z\d_]{1,15}\/status\/(\d{1,20})(?:[/?#]|$)/i.exec(article.url || '')?.[1];
  return id ? `x:${id}` : null;
}

/** 이 글을 재게시한 계정 이름. 재게시가 아니면 null. */
function reposter(article: ArticleItem): string | null {
  return /^RT by @[a-z\d_]{1,15}:/i.test(article.title || '') ? xFeedAccount(article).name : null;
}

export interface RepostGroups {
  /** 목록에 보일 행. 묶인 글은 처음 나온 자리에 한 번만 나온다. */
  rows: ArticleItem[];
  /** 묶인 글의 id → 같은 묶음의 모든 글 id(자기 포함). 묶이지 않은 글은 없다. */
  siblings: Map<string, string[]>;
}

export function groupReposts(articles: readonly ArticleItem[]): RepostGroups {
  const groups = new Map<string, ArticleItem[]>();
  for (const article of articles) {
    const key = repostKey(article);
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.push(article); else groups.set(key, [article]);
  }
  const siblings = new Map<string, string[]>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ids = group.map((article) => article.id);
    for (const id of ids) siblings.set(id, ids);
  }
  if (!siblings.size) return { rows: articles as ArticleItem[], siblings };
  const rows: ArticleItem[] = [];
  const placed = new Set<string>();
  for (const article of articles) {
    const key = repostKey(article)!;
    const ids = siblings.get(article.id);
    if (!ids) { rows.push(article); continue; }
    if (placed.has(key)) continue;
    placed.add(key);
    const group = groups.get(key)!;
    const names = [...new Set(group.map(reposter).filter((name): name is string => Boolean(name)))];
    // 하나라도 안 읽었으면 안 읽음, 하나라도 저장했으면 저장으로 보인다.
    rows.push({ ...article, is_read: group.every((item) => item.is_read), is_saved: group.some((item) => item.is_saved), reposters: names });
  }
  return { rows, siblings };
}

/** 화면용으로 묶은 행에서 원래 글로 되돌린다(재게시한 사람 목록을 뺀다). 캐시나 서버에는 이 모양만 보낸다. */
export function withoutReposters(article: ArticleItem): ArticleItem {
  if (!('reposters' in article)) return article;
  const { reposters: _reposters, ...plain } = article;
  return plain;
}
