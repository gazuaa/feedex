import { validArticleBlockRule, type ArticleBlockRule } from '../shared/articleBlocks';
import type { D1DatabaseLike } from './types';

interface RuleState { revision: number; rules: ArticleBlockRule[]; deleted: string[] }
export function accountArticleBlocks(preferences: string | null | undefined): RuleState {
  try {
    const state = JSON.parse(preferences || '{}').articleBlocks;
    if (Number.isSafeInteger(state?.revision) && state.revision >= 0 && Array.isArray(state.rules) && state.rules.length <= 100 && state.rules.every(validArticleBlockRule) && Array.isArray(state.deleted) && state.deleted.every((id: unknown) => typeof id === 'string')) return state;
  } catch { /* 이전 계정에는 아직 규칙 항목이 없다. */ }
  return { revision: 0, rules: [], deleted: [] };
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
