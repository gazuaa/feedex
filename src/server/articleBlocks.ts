import { normalizeBlockTitle, validArticleBlockRule, type ArticleBlockRule } from '../shared/articleBlocks';
import type { D1DatabaseLike } from './types';

interface RuleState { revision: number; rules: ArticleBlockRule[]; deleted: string[] }
export function accountArticleBlocks(preferences: string | null | undefined): RuleState {
  try {
    const state = JSON.parse(preferences || '{}').articleBlocks;
    if (Number.isSafeInteger(state?.revision) && state.revision >= 0 && Array.isArray(state.rules) && state.rules.length <= 100 && state.rules.every(validArticleBlockRule) && Array.isArray(state.deleted) && state.deleted.every((id: unknown) => typeof id === 'string')) return state;
  } catch { /* 이전 계정에는 아직 규칙 항목이 없다. */ }
  return { revision: 0, rules: [], deleted: [] };
}

export async function articleBlockCountFilter(db: D1DatabaseLike, userId: string, rules: readonly ArticleBlockRule[]) {
  const enabled = rules.filter((rule) => rule.enabled).map((rule) => ({
    feedId: rule.feedId,
    all: rule.all.map(normalizeBlockTitle),
    any: rule.any.map(normalizeBlockTitle),
  }));
  // affected: 이 구독(s)의 피드에 규칙이 걸려 있어 차단한 글을 빼고 세야 하는지. 저장한 피드 글 수를 쓸 때 쓴다.
  if (!enabled.length) return { cte: '', params: [], visible: '1=1', affected: '0' };

  // 기존 글이나 외부 가져오기가 남긴 제목도 목록과 동일한 방식으로 정규화한다.
  const feedIds = enabled.some((rule) => rule.feedId === null) ? null : JSON.stringify([...new Set(enabled.map((rule) => rule.feedId))]);
  for (;;) {
    const { results } = await db.prepare(`SELECT a.id,a.title FROM subscriptions s
      CROSS JOIN articles a ON a.feed_id=s.feed_id AND a.block_title IS NULL
      WHERE s.user_id=? ${feedIds === null ? '' : 'AND s.feed_id IN (SELECT value FROM json_each(?))'} LIMIT 400`)
      .bind(userId, ...(feedIds === null ? [] : [feedIds])).all<{ id: string; title: string }>();
    if (!results.length) break;
    await db.prepare(`WITH titles AS (
      SELECT json_extract(value,'$[0]') id, json_extract(value,'$[1]') title, json_extract(value,'$[2]') normalized
      FROM json_each(?)
    )
    UPDATE articles SET block_title=titles.normalized FROM titles
    WHERE articles.id=titles.id AND articles.title=titles.title AND articles.block_title IS NULL`)
      .bind(JSON.stringify(results.map(({ id, title }) => [id, title, normalizeBlockTitle(title)]))).run();
  }

  return {
    cte: `WITH block_rules AS MATERIALIZED (
      SELECT json_extract(value,'$.feedId') AS feed_id,
        json_extract(value,'$.all') AS all_terms, json_extract(value,'$.any') AS any_terms
      FROM json_each(?)
    )`,
    params: [JSON.stringify(enabled)],
    affected: `(s.feed_id IN (SELECT feed_id FROM block_rules WHERE feed_id IS NOT NULL) OR EXISTS(SELECT 1 FROM block_rules WHERE feed_id IS NULL))`,
    visible: `CASE WHEN a.feed_id IN (SELECT feed_id FROM block_rules WHERE feed_id IS NOT NULL)
        OR EXISTS(SELECT 1 FROM block_rules WHERE feed_id IS NULL)
      THEN a.block_title IS NULL OR NOT EXISTS(
        SELECT 1 FROM block_rules r WHERE (r.feed_id IS NULL OR r.feed_id=a.feed_id)
          AND NOT EXISTS(SELECT 1 FROM json_each(r.all_terms) term WHERE instr(a.block_title,term.value)=0)
          AND (json_array_length(r.any_terms)=0
            OR EXISTS(SELECT 1 FROM json_each(r.any_terms) term WHERE instr(a.block_title,term.value)>0))
      ) ELSE 1 END`,
  };
}

export class ArticleBlockError extends Error {}
export async function changeArticleBlocks(db: D1DatabaseLike, userId: string, body: any): Promise<RuleState> {
  if (!body || !['save', 'delete', 'import'].includes(body.action)) throw new ArticleBlockError('차단 규칙 요청을 확인해 주세요.');
  if (body.action === 'save' && !validArticleBlockRule(body.rule)) throw new ArticleBlockError('차단 규칙을 확인해 주세요.');
  if (body.action === 'delete' && (typeof body.id !== 'string' || !body.id || body.id.length > 100)) throw new ArticleBlockError('삭제할 규칙을 확인해 주세요.');
  if (body.action === 'import' && (!Array.isArray(body.rules) || body.rules.length > 100 || !body.rules.every(validArticleBlockRule))) throw new ArticleBlockError('기존 차단 규칙을 확인해 주세요.');
  for (let attempt = 0; attempt < 5; attempt++) {
    const user = await db.prepare('SELECT preferences_json FROM users WHERE id=?').bind(userId).first<{ preferences_json: string }>();
    if (!user) throw new ArticleBlockError('계정을 확인해 주세요.');
    const state = accountArticleBlocks(user.preferences_json), rules = new Map(state.rules.map((rule) => [rule.id, rule])), deleted = new Set(state.deleted);
    if (body.action === 'save') { rules.set(body.rule.id, body.rule); deleted.delete(body.rule.id); }
    if (body.action === 'delete') { rules.delete(body.id); deleted.add(body.id); }
    // 다른 기기의 오래된 로컬 규칙이 수정·삭제된 계정 규칙을 되살리지 않게 한다.
    if (body.action === 'import') for (const rule of body.rules as ArticleBlockRule[]) if (!rules.has(rule.id) && !deleted.has(rule.id)) rules.set(rule.id, rule);
    if (rules.size > 100) throw new ArticleBlockError('차단 규칙은 계정당 100개까지 저장할 수 있습니다.');
    const next = { revision: state.revision + 1, rules: [...rules.values()], deleted: [...deleted] };
    if (JSON.stringify(next.rules).length > 350_000) throw new ArticleBlockError('규칙의 전체 길이가 너무 깁니다. 표현이나 규칙 수를 줄여 주세요.');
    // 규칙만 고치며, 동시에 바뀐 다른 기기의 설정은 덮어쓰지 않는다.
    const result = await db.prepare("UPDATE users SET preferences_json=json_set(CASE WHEN json_valid(preferences_json) THEN preferences_json ELSE '{}' END, '$.articleBlocks', json(?)) WHERE id=? AND preferences_json IS ?")
      .bind(JSON.stringify(next), userId, user.preferences_json).run();
    if (Number(result.meta?.changes) > 0) return next;
  }
  throw new ArticleBlockError('다른 기기에서 규칙을 변경 중입니다. 잠시 후 다시 저장해 주세요.');
}
