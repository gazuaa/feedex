import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, FilterX, Plus, ShieldBan, X } from 'lucide-react';
import { SettingLabel } from './SettingLabel';
import { formatPublicationDate, type ArticleItem, type SubscriptionItem } from '../client/api';
import { blockRuleError, compileArticleBlocks, parseBlockTerms, removeArticleBlock, saveArticleBlock, suggestArticleBlock, useArticleBlocks, type ArticleBlockRule } from '../client/articleBlocks';
import { t } from '../shared/i18n';

export function ArticleBlockSetting({ accountId, onManage }: { accountId: string; onManage: () => void }) {
  const rules = useArticleBlocks(accountId);
  return <button type="button" className="feedex-block-setting" onClick={onManage}><SettingLabel icon={ShieldBan}>{t('기사 차단 규칙', 'Article block rules')}</SettingLabel><span className="feedex-setting-value">{t(`${rules.filter((rule) => rule.enabled).length}개`, `${rules.filter((rule) => rule.enabled).length}`)}</span><ChevronRight size={16} aria-hidden="true" /></button>;
}

export function ArticleBlockDialog({ accountId, article, articles, subscriptions, onClose, onApplied }: {
  accountId: string; article: ArticleItem | null; articles: ArticleItem[]; subscriptions: SubscriptionItem[];
  onClose: () => void; onApplied: () => void;
}) {
  const rules = useArticleBlocks(accountId);
  const [draft, setDraft] = useState<ArticleBlockRule | null>(() => article ? suggestArticleBlock(article) : null);
  const [allText, setAllText] = useState(() => draft?.all.join(', ') || '');
  const [anyText, setAnyText] = useState(() => draft?.any.join(', ') || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState<ArticleBlockRule | null>(null);
  const ref = useRef<HTMLDialogElement>(null), titleId = useId();
  const condition = useMemo(() => draft ? { ...draft, all: parseBlockTerms(allText), any: parseBlockTerms(anyText) } : null, [draft, allText, anyText]);
  const validation = condition ? blockRuleError(condition) : null;
  const matches = useMemo(() => {
    if (!condition || validation) return [];
    return articles.filter(compileArticleBlocks([{ ...condition, enabled: true }]));
  }, [articles, condition, validation]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  // 휴대폰에서는 이름 입력창에 자동으로 키보드를 띄우지 않고 제안과 미리보기를 먼저 보여 준다.
  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>('.feedex-block-heading button')?.focus(); }, [draft?.id]);
  const edit = (rule: ArticleBlockRule) => { setDraft({ ...rule }); setAllText(rule.all.join(', ')); setAnyText(rule.any.join(', ')); setError(''); };
  const back = () => { if (article) onClose(); else { setDraft(null); setError(''); } };
  const attempt = async (action: () => void | Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('계정에 규칙을 저장하지 못했습니다. 연결 상태를 확인해 주세요.', 'Could not save the rule to your account. Check your connection.')); }
    finally { setBusy(false); }
  };
  const feeds = [...new Map(subscriptions.map((feed) => [feed.feed_id, feed])).values()];
  return createPortal(<div className="feedex-block-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <dialog open ref={ref} className="feedex-block-dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key === 'Tab') {
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <header className="feedex-block-heading"><div><h2 id={titleId}>{draft ? t('비슷한 글 숨기기', 'Hide similar articles') : t('기사 차단 규칙', 'Article block rules')}</h2><p>{t('같은 계정으로 로그인한 기기에 동기화됩니다.', 'Synced to devices signed in to the same account.')}</p></div><button type="button" aria-label={t('차단 규칙 닫기', 'Close block rules')} onClick={onClose}><X size={21} /></button></header>
      {draft && condition ? <form className="feedex-block-form" onSubmit={(event) => {
        event.preventDefault(); if (validation) return;
        void attempt(async () => { await saveArticleBlock(accountId, condition); onApplied(); if (article) onClose(); else setDraft(null); });
      }}>
        <div className="feedex-block-body">
          <label>{t('규칙 이름', 'Rule name')}<input value={draft.name} maxLength={120} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label>{t('적용 피드', 'Applies to')}<select value={draft.feedId || ''} onChange={(event) => {
            const feed = feeds.find((item) => item.feed_id === event.target.value);
            setDraft({ ...draft, feedId: event.target.value || null, feedTitle: feed?.title || t('모든 피드', 'All feeds') });
          }}><option value="">{t('모든 피드', 'All feeds')}</option>{draft.feedId && !feeds.some((feed) => feed.feed_id === draft.feedId) && <option value={draft.feedId}>{draft.feedTitle}</option>}{feeds.map((feed) => <option key={feed.feed_id} value={feed.feed_id}>{feed.title}</option>)}</select></label>
          <label>{t('모두 포함', 'Contains all')}<textarea rows={2} maxLength={2400} value={allText} onChange={(event) => setAllText(event.target.value)} placeholder={t('현물 ETF, 하루새', 'spot ETF, daily')} /><small>{t('입력한 표현이 모두 있는 제목을 찾습니다. 쉼표나 줄바꿈으로 구분하세요.', 'Finds titles that contain every phrase. Separate with commas or new lines.')}</small></label>
          <label>{t('하나 이상 포함', 'Contains any')}<textarea rows={2} maxLength={2400} value={anyText} onChange={(event) => setAnyText(event.target.value)} placeholder={t('순유입, 순유출', 'inflow, outflow')} /><small>{t('앞 조건과 함께, 이 중 하나가 있는 제목만 찾습니다. 비워 두어도 됩니다.', 'Together with the above, only titles with one of these. Optional.')}</small></label>
          <label className="feedex-block-toggle"><span>{t('규칙 사용', 'Rule on')}</span><input type="checkbox" role="switch" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /></label>
          <section className="feedex-block-preview" aria-label={t('차단 대상 미리보기', 'Preview of blocked articles')}><h3>{t('미리보기', 'Preview')} <span>{t(`${matches.length.toLocaleString()}개`, `${matches.length.toLocaleString()}`)}</span></h3><p>{t('불러온 기사 기준입니다. 같은 조건의 새 글에도 적용됩니다.', 'Based on loaded articles. New articles that match are hidden too.')}</p>
            {validation ? <p>{validation}</p> : matches.length ? <ul>{matches.slice(0, 20).map((item) => <li key={item.id}><strong>{item.title}</strong><small className="feedex-block-preview-meta"><span>{item.feed_title}</span><time dateTime={item.date_source === 'updated' || item.date_source === 'collected' || !Number.isFinite(Date.parse(item.published_at)) ? undefined : item.published_at}>{formatPublicationDate(item)}</time></small></li>)}</ul> : <p>{t('현재 불러온 기사 중 일치하는 제목이 없습니다.', 'No loaded article titles match.')}</p>}
            {matches.length > 20 && <p>{t('앞의 20개만 표시했습니다.', 'Showing the first 20.')}</p>}
          </section>
          <p className="feedex-block-hint">{t('목록과 새 글 알림에서 숨깁니다. 원래 글과 읽음·저장 상태는 유지됩니다. 피드 숫자는 숨김 전 전체 글 기준입니다.', 'Hidden from lists and new-article alerts. Articles keep their read and saved state. Feed counts include hidden articles.')}</p>
          {error && <p role="alert" className="feedex-block-error">{error}</p>}
        </div>
        <footer className="feedex-block-footer"><button type="button" onClick={back}>{t('취소', 'Cancel')}</button><button type="submit" disabled={busy || Boolean(validation)} className="feedex-block-primary">{busy ? t('계정에 저장 중…', 'Saving to your account…') : rules.some((rule) => rule.id === draft.id) ? t('규칙 저장', 'Save rule') : t('차단 규칙 추가', 'Add block rule')}</button></footer>
      </form> : <>
        <div className="feedex-block-body">
          <button type="button" className="feedex-block-add" onClick={() => edit({ id: `block_${crypto.randomUUID()}`, name: t('제목 차단 규칙', 'Title block rule'), feedId: null, feedTitle: t('모든 피드', 'All feeds'), all: [], any: [], enabled: true, createdAt: new Date().toISOString() })}><Plus size={17} />{t('새 규칙 추가', 'New rule')}</button>
          {!rules.length && <p className="feedex-block-hint">{t('기사에서 우클릭하거나 길게 누른 뒤 ‘비슷한 글 숨기기’를 선택해 보세요.', 'Right-click or long-press an article and choose ‘Hide similar articles’.')}</p>}
          <ul className="feedex-block-rules">{rules.map((rule) => <li key={rule.id}>
            <label className="feedex-block-toggle"><span><strong>{rule.name}</strong><small>{rule.feedId ? rule.feedTitle : t('모든 피드', 'All feeds')}</small></span><input type="checkbox" role="switch" aria-label={t(`${rule.name} 사용`, `${rule.name} on`)} checked={rule.enabled} disabled={busy} onChange={(event) => void attempt(() => saveArticleBlock(accountId, { ...rule, enabled: event.target.checked }))} /></label>
            <p>{rule.all.length ? `${t('모두', 'All')}: ${rule.all.join(' · ')}` : ''}{rule.all.length && rule.any.length ? ' / ' : ''}{rule.any.length ? `${t('하나 이상', 'Any')}: ${rule.any.join(' · ')}` : ''}</p>
            <div className="feedex-block-rule-actions"><button type="button" aria-label={t(`${rule.name} 수정`, `Edit ${rule.name}`)} onClick={() => edit(rule)}>{t('수정', 'Edit')}</button><button type="button" aria-label={t(`${rule.name} 삭제`, `Delete ${rule.name}`)} disabled={busy} onClick={() => void attempt(async () => { await removeArticleBlock(accountId, rule.id); setRemoved(rule); })}>{t('삭제', 'Delete')}</button></div>
          </li>)}</ul>
          {removed && <p role="status" className="feedex-block-undo">{t('규칙을 삭제했습니다.', 'Rule deleted.')}<button type="button" disabled={busy} onClick={() => void attempt(async () => { await saveArticleBlock(accountId, removed); setRemoved(null); })}>{t('실행 취소', 'Undo')}</button></p>}
          {error && <p role="alert" className="feedex-block-error">{error}</p>}
        </div>
        <footer className="feedex-block-footer"><button type="button" onClick={onClose}>{t('닫기', 'Close')}</button></footer>
      </>}
    </dialog>
  </div>, document.body);
}
