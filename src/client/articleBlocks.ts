import { useEffect, useSyncExternalStore } from 'react';
import { apiRequest, getStoredToken, type ArticleItem } from './api';
import { normalizeBlockTitle as normalize, validArticleBlockRule as validRule, type ArticleBlockRule } from '../shared/articleBlocks';
export { parseBlockTerms, blockRuleError, type ArticleBlockRule } from '../shared/articleBlocks';
import { parseBlockTerms } from '../shared/articleBlocks';

export type BlockArticle = Pick<ArticleItem, 'title' | 'feed_id'>;
const EMPTY: readonly ArticleBlockRule[] = [];
const snapshots = new Map<string, { raw: string | null; rules: readonly ArticleBlockRule[] }>();
const listeners = new Set<() => void>();
const memoryOnly = new Set<string>();
const key = (account: string) => `sfeed_article_blocks_v1:${account}`;
export function readArticleBlocks(account: string): readonly ArticleBlockRule[] {
  if (!account) return EMPTY;
  let raw: string | null;
  try { raw = localStorage.getItem(key(account)); } catch { return snapshots.get(account)?.rules || EMPTY; }
  const previous = snapshots.get(account);
  if (memoryOnly.has(account) && previous) return previous.rules;
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
interface AccountRules { rules: ArticleBlockRule[]; revision: number }
const flights = new Map<string, Promise<void>>();
const revisions = new Map<string, number>();
const lastSync = new Map<string, number>();
const syncKey = (account: string) => `sfeed_article_blocks_account_v1:${account}`;

function cacheAccountRules(account: string, state: AccountRules) {
  if ((revisions.get(account) ?? -1) > state.revision) return;
  const raw = JSON.stringify(state.rules);
  // 계정 저장이 끝난 뒤 기기 저장 공간이 부족해도 현재 화면에는 적용한다.
  try { localStorage.setItem(key(account), raw); localStorage.setItem(syncKey(account), '1'); memoryOnly.delete(account); } catch { memoryOnly.add(account); }
  snapshots.set(account, { raw, rules: state.rules.length ? state.rules : EMPTY });
  revisions.set(account, state.revision);
  listeners.forEach((listener) => listener());
}

/** 기존 기기 규칙을 한 번 가져오고, 이후에는 계정의 규칙을 로컬에 보관해 필터링한다. */
export function syncArticleBlocks(account: string, force = false): Promise<void> {
  if (!account) return Promise.resolve();
  const running = flights.get(account); if (running) return running;
  if (!force && Date.now() - (lastSync.get(account) || 0) < 60_000) return Promise.resolve();
  const token = getStoredToken();
  const work = (async () => {
    let migrated = false;
    try { migrated = localStorage.getItem(syncKey(account)) === '1'; } catch { /* 계정에서 다시 확인한다. */ }
    const legacy = migrated ? [] : readArticleBlocks(account);
    const state = await apiRequest<AccountRules>('/api/user/article-blocks', legacy.length ? { method: 'PUT', body: JSON.stringify({ action: 'import', rules: legacy }), signal: AbortSignal.timeout(8000) } : { signal: AbortSignal.timeout(8000) });
    if (getStoredToken() !== token) return;
    cacheAccountRules(account, state); lastSync.set(account, Date.now());
  })().finally(() => { if (flights.get(account) === work) flights.delete(account); });
  flights.set(account, work); return work;
}

export function useArticleBlockAccountSync(account: string) {
  useEffect(() => {
    if (!account) return;
    const sync = () => { if (document.visibilityState === 'visible') void syncArticleBlocks(account, true).catch(() => {}); };
    void syncArticleBlocks(account, true).catch(() => {});
    window.addEventListener('focus', sync); window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', sync);
    const timer = window.setInterval(sync, 300_000);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', sync); window.removeEventListener('online', sync); document.removeEventListener('visibilitychange', sync); };
  }, [account]);
}
async function changeAccountRule(account: string, action: object) {
  if (!account) throw new Error('로그인한 계정을 확인해 주세요.');
  const token = getStoredToken();
  await syncArticleBlocks(account);
  if (getStoredToken() !== token) throw new Error('계정이 변경되었습니다. 다시 로그인해 주세요.');
  const state = await apiRequest<AccountRules>('/api/user/article-blocks', { method: 'PUT', body: JSON.stringify(action), signal: AbortSignal.timeout(8000) });
  if (getStoredToken() !== token) throw new Error('계정이 변경되었습니다. 다시 로그인해 주세요.');
  cacheAccountRules(account, state);
}
export async function saveArticleBlock(account: string, rule: ArticleBlockRule) {
  if (!validRule(rule)) throw new Error('차단 규칙을 확인해 주세요.');
  await changeAccountRule(account, { action: 'save', rule });
}
export async function removeArticleBlock(account: string, id: string) {
  await changeAccountRule(account, { action: 'delete', id });
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => { listeners.delete(listener); window.removeEventListener('storage', listener); };
}
export function useArticleBlocks(account: string) {
  return useSyncExternalStore(subscribe, () => readArticleBlocks(account), () => EMPTY);
}
export function useArticleBlockRevision(account: string) {
  return useSyncExternalStore(subscribe, () => revisions.get(account) ?? 0, () => 0);
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
