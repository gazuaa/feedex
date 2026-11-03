import { useSyncExternalStore } from 'react';
import type { ArticleItem } from './api';

export interface ArticleBlockRule {
  id: string;
  name: string;
  feedId: string | null;
  feedTitle: string;
  all: string[];
  any: string[];
  enabled: boolean;
  createdAt: string;
}
export type BlockArticle = Pick<ArticleItem, 'title' | 'feed_id'>;
const EMPTY: readonly ArticleBlockRule[] = [];
const snapshots = new Map<string, { raw: string | null; rules: readonly ArticleBlockRule[] }>();
const listeners = new Set<() => void>();
const key = (account: string) => `sfeed_article_blocks_v1:${account}`;
const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

export function parseBlockTerms(text: string): string[] {
  const terms = new Map<string, string>();
  for (const term of text.split(/[,\n]/).map((term) => term.trim()).filter(Boolean)) if (!terms.has(normalize(term))) terms.set(normalize(term), term);
  return [...terms.values()];
}
export function blockRuleError(rule: Pick<ArticleBlockRule, 'name' | 'all' | 'any'>): string | null {
  if (!rule.name.trim() || rule.name.length > 120) return '규칙 이름을 120자 이내로 입력해 주세요.';
  if (!rule.all.length && !rule.any.length) return '제목에 포함할 표현을 하나 이상 입력해 주세요.';
  if (rule.all.length > 12 || rule.any.length > 12) return '각 조건에는 표현을 12개까지 넣을 수 있습니다.';
  if ([...rule.all, ...rule.any].some((term) => !normalize(term) || term.length > 100)) return '각 표현은 1~100자로 입력해 주세요.';
  return null;
}
function validRule(value: unknown): value is ArticleBlockRule {
  if (!value || typeof value !== 'object') return false;
  const rule = value as ArticleBlockRule;
  return typeof rule.id === 'string' && rule.id.length > 0 && rule.id.length <= 100
    && typeof rule.name === 'string' && (rule.feedId === null || (typeof rule.feedId === 'string' && rule.feedId.length > 0 && rule.feedId.length <= 200))
    && typeof rule.feedTitle === 'string' && rule.feedTitle.length <= 200 && typeof rule.enabled === 'boolean'
    && typeof rule.createdAt === 'string' && Number.isFinite(Date.parse(rule.createdAt))
    && Array.isArray(rule.all) && Array.isArray(rule.any) && [...rule.all, ...rule.any].every((term) => typeof term === 'string')
    && !blockRuleError(rule);
}
export function readArticleBlocks(account: string): readonly ArticleBlockRule[] {
  if (!account) return EMPTY;
  let raw: string | null;
  try { raw = localStorage.getItem(key(account)); } catch { return snapshots.get(account)?.rules || EMPTY; }
  const previous = snapshots.get(account);
  if (previous?.raw === raw) return previous.rules;
  let rules: ArticleBlockRule[] = [];
  try {
    const parsed = raw && raw.length <= 350_000 ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length <= 100) rules = [...new Map(parsed.filter(validRule).map((rule) => [rule.id, rule])).values()];
  } catch { /* 손상된 기기 설정은 기사 전체를 숨기는 조건으로 바꾸지 않는다. */ }
  const result = rules.length ? rules : EMPTY;
  snapshots.set(account, { raw, rules: result });
  return result;
}
function writeArticleBlocks(account: string, rules: readonly ArticleBlockRule[]) {
  if (!account) throw new Error('로그인한 계정을 확인해 주세요.');
  if (rules.length > 100 || rules.some((rule) => !validRule(rule))) throw new Error('차단 규칙을 확인해 주세요. 규칙은 100개까지 저장할 수 있습니다.');
  const raw = JSON.stringify(rules);
  if (raw.length > 350_000) throw new Error('규칙의 전체 길이가 너무 깁니다. 표현이나 규칙 수를 줄여 주세요.');
  try { localStorage.setItem(key(account), raw); }
  catch { throw new Error('이 기기에 규칙을 저장하지 못했습니다. 브라우저의 저장 공간과 설정을 확인해 주세요.'); }
  snapshots.set(account, { raw, rules: [...rules] });
  listeners.forEach((listener) => listener());
}
export function saveArticleBlock(account: string, rule: ArticleBlockRule) {
  const rules = readArticleBlocks(account), exists = rules.some((item) => item.id === rule.id);
  writeArticleBlocks(account, exists ? rules.map((item) => item.id === rule.id ? rule : item) : [...rules, rule]);
}
export function removeArticleBlock(account: string, id: string) {
  writeArticleBlocks(account, readArticleBlocks(account).filter((rule) => rule.id !== id));
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => { listeners.delete(listener); window.removeEventListener('storage', listener); };
}
export function useArticleBlocks(account: string) {
  return useSyncExternalStore(subscribe, () => readArticleBlocks(account), () => EMPTY);
}

/** 표현은 정규식이 아닌 일반 문자열이다. 피드별로 묶어 제목 정규화를 한 번만 한다. */
export function compileArticleBlocks(rules: readonly ArticleBlockRule[]): (article: BlockArticle) => boolean {
  const byFeed = new Map<string | null, { all: string[]; any: string[] }[]>();
  for (const rule of rules) if (rule.enabled && validRule(rule)) {
    const list = byFeed.get(rule.feedId) || [];
    list.push({ all: rule.all.map(normalize), any: rule.any.map(normalize) }); byFeed.set(rule.feedId, list);
  }
  if (!byFeed.size) return () => false;
  return (article) => {
    const rules = [...(byFeed.get(null) || []), ...(byFeed.get(article.feed_id) || [])];
    if (!rules.length) return false;
    const title = normalize(article.title);
    return rules.some((rule) => rule.all.every((term) => title.includes(term)) && (!rule.any.length || rule.any.some((term) => title.includes(term))));
  };
}

export function suggestArticleBlock(article: Pick<ArticleItem, 'title' | 'feed_id' | 'feed_title'>): ArticleBlockRule {
  const title = article.title.normalize('NFKC');
  const dailyEtf = /현물\s*ETF/i.test(title) && /하루\s*새/.test(title) && /순유[입출]/.test(title);
  // 숫자가 있는 단어를 경계로 나눠 날짜·금액만 바뀌는 제목의 고정된 부분을 제안한다.
  const fixed: string[] = []; let phrase: string[] = [];
  for (const word of title.split(/\s+/)) {
    if (/\d/.test(word)) { if (phrase.length) fixed.push(phrase.join(' ')); phrase = []; }
    else phrase.push(word);
  }
  if (phrase.length) fixed.push(phrase.join(' '));
  const all = dailyEtf ? ['현물 ETF', '하루새'] : fixed.flatMap(parseBlockTerms).filter((term) => term.length >= 2 && term.length <= 100).slice(0, 12);
  return { id: `block_${crypto.randomUUID()}`, name: dailyEtf ? '현물 ETF 일일 자금 흐름' : `${article.feed_title} 제목 차단`.slice(0, 120),
    feedId: article.feed_id, feedTitle: article.feed_title.slice(0, 200), all: all.length ? all : [title.slice(0, 100)], any: dailyEtf ? ['순유입', '순유출'] : [], enabled: true, createdAt: new Date().toISOString() };
}

/** 숨긴 글을 읽던 중에도 원래 위치에 가장 가까운 보이는 글로 이동한다. */
export function visibleArticleNeighbors<T extends { id: string }>(all: readonly T[], visible: readonly T[], selectedId: string | null): { prev: T | null; next: T | null } {
  const index = all.findIndex((article) => article.id === selectedId);
  if (index < 0) {
    const first = visible[0] || null;
    return { prev: selectedId === null ? first : null, next: first };
  }
  const ids = new Set(visible.map((article) => article.id));
  let prev: T | null = null, next: T | null = null;
  for (let at = index - 1; at >= 0; at--) if (ids.has(all[at].id)) { prev = all[at]; break; }
  for (let at = index + 1; at < all.length; at++) if (ids.has(all[at].id)) { next = all[at]; break; }
  return { prev, next };
}
