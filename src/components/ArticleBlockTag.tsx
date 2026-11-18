import { t } from '../shared/i18n';
export function ArticleBlockTag({ blocked }: { blocked: boolean }) {
  return blocked ? <span className="feedex-block-tag" title={t('제목 차단 규칙에 해당하는 글', 'Matches a title block rule')}>{t('차단됨', 'Blocked')}</span> : null;
}
