import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { History, Loader2, Pause, Play, X } from 'lucide-react';
import { apiRequest, getStoredToken, type SubscriptionItem } from '../client/api';
import { DEFAULT_HISTORY_OPTIONS, HISTORY_DAYS, HISTORY_LIMITS, historyDaysLabel, historyLimitLabel, type FeedHistoryOptions, type FeedHistoryProgress, type FeedHistoryResponse } from '../shared/feedHistory';
import { t, locale } from '../shared/i18n';

/** 창이 열려 있는 동안에만 한 쪽씩 진행한다. 닫아도 서버에 저장된 위치는 남는다. */
export function FeedHistoryDialog({ feed, isDark, onClose, onChanged }: { feed: SubscriptionItem; isDark: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const [options, setOptions] = useState<FeedHistoryOptions>(DEFAULT_HISTORY_OPTIONS), [job, setJob] = useState<FeedHistoryProgress | null>(null);
  const [loading, setLoading] = useState(true), [running, setRunning] = useState(false), [stopping, setStopping] = useState(false), [error, setError] = useState('');
  const closing = useRef(false);
  const mounted = useRef(true), active = useRef(false), busy = useRef(false), changed = useRef(false), token = useRef(getStoredToken());
  const dialog = useRef<HTMLDialogElement>(null), titleId = useId();
  const path = `/api/feeds/${encodeURIComponent(feed.feed_id)}/history`;
  const valid = () => mounted.current && token.current === getStoredToken();
  const refresh = async () => { if (changed.current && valid()) { changed.current = false; await onChanged().catch(() => {}); } };
  useEffect(() => {
    const controller = new AbortController(); mounted.current = true;
    void apiRequest<FeedHistoryResponse>(path, { signal: controller.signal }).then(({ job }) => { if (valid()) { setJob(job); if (job) setOptions(job.options); } }).catch(reason => { if (valid() && !controller.signal.aborted) setError(reason.message || t('진행 정보를 불러오지 못했습니다.', 'Could not load the progress.')); }).finally(() => { if (valid()) setLoading(false); });
    const previous = document.activeElement as HTMLElement | null; dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { mounted.current = false; active.current = false; controller.abort(); if (previous?.isConnected) previous.focus(); };
  }, [path]);
  const start = async (restart = false) => {
    if (busy.current || !valid()) return;
    busy.current = true; active.current = true; closing.current = false; setStopping(false); setRunning(true); setError('');
    let previousAdded = job?.added || 0;
    try {
      let { job: next } = await apiRequest<FeedHistoryResponse>(path, { method: 'POST', body: JSON.stringify({ options, restart }) });
      if (valid()) setJob(next);
      while (valid() && active.current && next) {
        setJob(next);
        if (next.status === 'done' || (!['ready', 'error'].includes(next.reason) && !(next.reason === 'rate_limit' && (next.retryAt || 0) <= Date.now()))) break;
        const response: FeedHistoryResponse = await apiRequest<FeedHistoryResponse>(`${path}/step`, { method: 'POST', body: JSON.stringify({ revision: next.revision }) });
        next = response.job;
        if (!valid()) break;
        if (next) { setJob(next); if (next.added > previousAdded) { changed.current = true; previousAdded = next.added; } }
        if (!active.current || !next || next.status === 'done' || next.reason !== 'ready') break;
        await new Promise(resolve => setTimeout(resolve, 1350));
      }
    } catch (reason) { if (valid()) setError(reason instanceof Error ? reason.message : t('글을 불러오지 못했습니다. 다시 이어받을 수 있습니다.', 'Could not load articles. You can resume later.')); }
    finally { busy.current = false; active.current = false; if (valid()) { setRunning(false); setStopping(false); await refresh(); if (valid() && closing.current) onClose(); } }
  };
  const close = () => { if (busy.current) { active.current = false; closing.current = true; setStopping(true); return; } void refresh(); onClose(); };
  const input = `w-full rounded-xl border px-3 py-2.5 ${isDark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50'}`;
  return createPortal(<div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/55 p-4 backdrop-blur-xs" onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <dialog open ref={dialog} aria-modal="true" aria-labelledby={titleId} className={`relative m-0 max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-3xl border p-5 shadow-2xl sm:p-6 ${isDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-900'}`} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')];
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
      }
    }}>
      <header className="flex items-center justify-between gap-3"><h2 id={titleId} className="flex items-center gap-2 text-lg font-bold"><History size={21} className="text-emerald-500" />{t('과거 글 불러오기', 'Load past articles')}</h2><button type="button" aria-label={t('과거 글 불러오기 닫기', 'Close past articles')} onClick={close} className="rounded-lg p-2"><X size={20} /></button></header>
      <p className="mt-2 truncate text-sm text-slate-400">{feed.custom_title || feed.title}</p>
      <p className="mt-4 text-sm leading-relaxed text-slate-500">{t('RSS와 사이트의 공개 목록에서 이전 글을 찾습니다. 이미 있는 글은 건너뛰고, 멈춘 위치부터 이어받습니다.', 'Finds older articles in the RSS feed and the site’s public lists. Articles you already have are skipped, and it resumes where it stopped.')}</p>
      <fieldset disabled={loading || running} className="mt-5 grid grid-cols-2 gap-3 disabled:opacity-60"><label className="space-y-2 text-sm"><span>{t('가져올 기간', 'Period')}</span><select aria-label={t('가져올 기간', 'Period')} value={options.days} className={input} onChange={event => setOptions({ ...options, days: Number(event.target.value) })}>{HISTORY_DAYS.map(days => <option key={days} value={days}>{historyDaysLabel(days)}</option>)}</select></label><label className="space-y-2 text-sm"><span>{t('최대 추가 개수', 'Maximum to add')}</span><select aria-label={t('최대 추가 개수', 'Maximum to add')} value={options.limit} className={input} onChange={event => setOptions({ ...options, limit: Number(event.target.value) })}>{HISTORY_LIMITS.map(limit => <option key={limit} value={limit}>{historyLimitLabel(limit)}</option>)}</select></label><label className="col-span-2 mt-1 flex items-center gap-2 text-sm"><input type="checkbox" checked={options.markRead} onChange={event => setOptions({ ...options, markRead: event.target.checked })} className="h-4 w-4 accent-emerald-500" />{t('추가한 과거 글은 읽음으로 표시', 'Mark added past articles as read')}</label></fieldset>
      {loading ? <p role="status" className="my-6 text-sm text-slate-400">{t('저장된 진행 정보를 확인하는 중…', 'Checking saved progress…')}</p> : job && <section aria-label={t('수집 진행 상황', 'Progress')} aria-live="polite" className={`mt-5 rounded-2xl p-4 ${isDark ? 'bg-slate-800' : 'bg-slate-50'}`}><div className="flex items-baseline justify-between"><strong className="text-xl text-emerald-500">{t(`${job.added.toLocaleString()}개 추가`, `${job.added.toLocaleString()} added`)}</strong><span className="text-xs text-slate-400">{t(`${job.pages}페이지 확인`, `${job.pages} pages checked`)}</span></div><p className="mt-2 text-xs text-slate-500">{t(`${job.checked.toLocaleString()}개 확인 · 중복 ${job.duplicates.toLocaleString()}개`, `${job.checked.toLocaleString()} checked · ${job.duplicates.toLocaleString()} duplicates`)}{job.unknownDates ? t(` · 날짜 미제공 ${job.unknownDates}개`, ` · ${job.unknownDates} without dates`) : ''}</p>{job.oldest && <p className="mt-1 text-xs text-slate-500">{t('가장 오래된 글', 'Oldest article')} · {new Date(job.oldest).toLocaleDateString(locale())}</p>}<p className="mt-3 text-sm leading-relaxed">{stopping ? t('현재 페이지를 저장한 뒤 멈춥니다…', 'Stopping after saving this page…') : !running && job.reason === 'ready' ? t('일시정지했습니다. 저장된 위치에서 이어받을 수 있습니다.', 'Paused. You can resume from where it stopped.') : job.message}</p>{job.retryAt && <p className="mt-2 text-xs text-slate-500">{t(`${new Date(job.retryAt).toLocaleTimeString(locale())} 이후 다시 시도할 수 있습니다.`, `You can try again after ${new Date(job.retryAt).toLocaleTimeString(locale())}.`)}</p>}</section>}
      {error && <p role="alert" className="mt-4 text-sm text-rose-500">{error}</p>}
      <p className="mt-4 text-xs leading-relaxed text-slate-400">{t('이 창이 열려 있을 때만 진행합니다. 사이트가 제공하는 범위까지 가져오며, 날짜 없는 글은 ‘전체 기간’에서 포함됩니다.', 'It only runs while this window is open. It goes back as far as the site allows; articles without dates are included in ‘All time’.')}</p>
      <footer className="mt-5 flex items-center justify-between gap-3">{job && !running ? <button type="button" className="text-xs text-slate-400 underline" onClick={() => void start(true)} disabled={loading}>{t('처음부터 다시 확인', 'Check again from the start')}</button> : <span />}{running ? <button type="button" disabled={stopping} onClick={() => { active.current = false; setStopping(true); }} className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950"><Loader2 size={15} className="animate-spin" /><Pause size={15} />{stopping ? t('저장 중…', 'Saving…') : t('일시정지', 'Pause')}</button> : <button type="button" disabled={loading || job?.status === 'done'} onClick={() => void start()} className="flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-40"><Play size={15} />{job ? job.status === 'done' ? t('확인 완료', 'Done') : t('이어받기', 'Resume') : t('불러오기', 'Load')}</button>}</footer>
    </dialog>
  </div>, document.body);
}
