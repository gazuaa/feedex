import { t } from './i18n';
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
export const normalizeBlockTitle = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

export function parseBlockTerms(text: string): string[] {
  const terms = new Map<string, string>();
  for (const term of text.split(/[,\n]/).map((term) => term.trim()).filter(Boolean)) if (!terms.has(normalizeBlockTitle(term))) terms.set(normalizeBlockTitle(term), term);
  return [...terms.values()];
}
export function blockRuleError(rule: Pick<ArticleBlockRule, 'name' | 'all' | 'any'>): string | null {
  if (!rule.name.trim() || rule.name.length > 120) return t('규칙 이름을 120자 이내로 입력해 주세요.', 'Enter a rule name of up to 120 characters.');
  if (!rule.all.length && !rule.any.length) return t('제목에 포함할 표현을 하나 이상 입력해 주세요.', 'Enter at least one phrase to match in titles.');
  if (rule.all.length > 12 || rule.any.length > 12) return t('각 조건에는 표현을 12개까지 넣을 수 있습니다.', 'Each condition can have up to 12 phrases.');
  if ([...rule.all, ...rule.any].some((term) => !normalizeBlockTitle(term) || term.length > 100)) return t('각 표현은 1~100자로 입력해 주세요.', 'Each phrase must be 1–100 characters.');
  return null;
}
export function validArticleBlockRule(value: unknown): value is ArticleBlockRule {
  if (!value || typeof value !== 'object') return false;
  const rule = value as ArticleBlockRule;
  return typeof rule.id === 'string' && rule.id.length > 0 && rule.id.length <= 100
    && typeof rule.name === 'string' && (rule.feedId === null || (typeof rule.feedId === 'string' && rule.feedId.length > 0 && rule.feedId.length <= 200))
    && typeof rule.feedTitle === 'string' && rule.feedTitle.length <= 200 && typeof rule.enabled === 'boolean'
    && typeof rule.createdAt === 'string' && Number.isFinite(Date.parse(rule.createdAt))
    && Array.isArray(rule.all) && Array.isArray(rule.any) && [...rule.all, ...rule.any].every((term) => typeof term === 'string')
    && !blockRuleError(rule);
}
