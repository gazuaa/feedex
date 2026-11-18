import React, { useState } from 'react';
import type { OpmlImportFailure } from '../shared/opml';
import { apiRequest } from '../client/api';
import { t, locale } from '../shared/i18n';

interface Props {
  failures: OpmlImportFailure[];
  drafts: Record<string, string>;
  busy: boolean;
  error: string | null;
  onDraft: (url: string, value: string) => void;
  onRetry: (failures: OpmlImportFailure[]) => void;
  onReload: () => void;
  isDark: boolean;
}

export const SavedOpmlFailures: React.FC<Props> = ({
  failures, drafts, busy, error, onDraft, onRetry, onReload, isDark,
}) => {
  const [checks, setChecks] = useState<Record<string, { url: string; message: string }>>({});
  const [checking, setChecking] = useState<string | null>(null);
  const checkFeed = async (failure: OpmlImportFailure) => {
    const originalUrl = failure.item.xmlUrl;
    const url = (drafts[originalUrl] ?? originalUrl).trim();
    setChecking(originalUrl);
    try {
      const result = await apiRequest<{ ok: boolean; title?: string; articles?: number; error?: string }>('/api/opml/check', {
        method: 'POST', body: JSON.stringify({ url }),
      });
      setChecks((current) => ({ ...current, [originalUrl]: { url, message: result.ok ? t(`연결 정상 · ${result.title} · 글 ${result.articles}개`, `Connected · ${result.title} · ${result.articles} articles`) : result.error || t('피드를 읽지 못했습니다.', 'Could not read the feed.') } }));
    } catch (error) {
      setChecks((current) => ({ ...current, [originalUrl]: { url, message: error instanceof Error ? error.message : t('연결을 확인하지 못했습니다.', 'Could not check the connection.') } }));
    } finally { setChecking(null); }
  };
  return (
  <section className={`p-4 rounded-2xl border space-y-3 ${isDark ? 'bg-slate-950/60 border-slate-800' : 'bg-slate-50 border-slate-200'}`} aria-label={t('저장된 가져오기 실패 목록', 'Saved import failures')}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-bold">{t(`저장된 실패 목록 · ${failures.length}개`, `Saved failures · ${failures.length}`)}</h3>
      <button type="button" disabled={busy} onClick={onReload} className="text-xs text-emerald-500 cursor-pointer disabled:opacity-40">{t('목록 새로고침', 'Refresh list')}</button>
    </div>
    <p className="text-xs text-slate-400 leading-relaxed">{t('계정에 저장되어 화면을 닫거나 다른 기기에서 로그인해도 다시 볼 수 있습니다. 주소를 수정해 재시도할 수 있고, 성공한 항목은 이 목록에서 정리됩니다.', 'Saved to your account, so you can see them after closing this screen or on another device. Fix an address and retry; items that succeed are removed.')}</p>
    {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
    {failures.length > 0 ? (
      <>
        <button
          type="button"
          disabled={busy}
          onClick={() => onRetry(failures)}
          className="px-3 py-2 rounded-xl border border-emerald-500/40 text-emerald-500 text-xs cursor-pointer disabled:opacity-40"
        >{t(`저장된 실패 ${failures.length}개 재시도`, `Retry ${failures.length} saved failures`)}</button>
        <details>
          <summary className="text-xs text-rose-400 cursor-pointer">{t('저장된 실패 항목 및 주소 수정', 'Saved failures and address fixes')}</summary>
          <ul className="mt-4 space-y-5">
            {failures.map((failure) => {
              const originalUrl = failure.item.xmlUrl;
              return (
                <li key={originalUrl} className="space-y-2 text-xs">
                  <p className="font-semibold break-words">{failure.item.title}</p>
                  <p className="text-rose-400 leading-relaxed">{failure.error}</p>
                  <p className="text-slate-400">{t(`실패 ${failure.attempts}회`, `Failed ${failure.attempts}×`)} · {new Date(failure.lastFailedAt).toLocaleString(locale())}{failure.item.folderName ? ` · ${failure.item.folderName}` : ''}</p>
                  <input
                    aria-label={t(`${failure.item.title} RSS 주소`, `RSS address for ${failure.item.title}`)}
                    type="url"
                    value={drafts[originalUrl] ?? originalUrl}
                    disabled={busy}
                    onChange={(event) => onDraft(originalUrl, event.target.value)}
                    className={`w-full p-2 rounded-lg border text-xs focus:outline-none focus:border-emerald-500 ${isDark ? 'bg-slate-950 border-slate-700' : 'bg-white border-slate-300'}`}
                  />
                  {failure.suggestedUrl && (
                    <div className="text-slate-400 leading-relaxed">
                      <p className="break-all">{t('확인된 대체 피드', 'Working alternative')}: {failure.suggestedUrl}</p>
                      <p>{t('이전 피드와 발행 범위가 다를 수 있으니 확인 후 선택해 주세요.', 'It may cover different articles than the old feed, so check before using it.')}</p>
                      <button type="button" disabled={busy} onClick={() => onDraft(originalUrl, failure.suggestedUrl!)} className="mt-1 text-emerald-500 cursor-pointer disabled:opacity-40">{t('대체 주소 사용', 'Use this address')}</button>
                    </div>
                  )}
                  <button type="button" disabled={busy} onClick={() => onRetry([failure])} className="text-emerald-500 cursor-pointer disabled:opacity-40">{t('이 피드 다시 시도', 'Retry this feed')}</button>
                  <button type="button" aria-label={t(`${failure.item.title} 연결 확인 ${originalUrl}`, `Check connection for ${failure.item.title} ${originalUrl}`)} disabled={busy || checking !== null} onClick={() => checkFeed(failure)} className="ml-3 text-emerald-500 cursor-pointer disabled:opacity-40">{checking === originalUrl ? t('확인 중…', 'Checking…') : t('연결 확인', 'Check connection')}</button>
                  {checks[originalUrl]?.url === (drafts[originalUrl] ?? originalUrl).trim() && <p role="status" className="text-xs text-slate-400">{checks[originalUrl].message}</p>}
                </li>
              );
            })}
          </ul>
        </details>
      </>
    ) : !error && <p className="text-xs text-slate-400">{t('저장된 실패 항목이 없습니다.', 'No saved failures.')}</p>}
  </section>
  );
};
