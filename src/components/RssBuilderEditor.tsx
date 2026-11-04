import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { apiRequest, type FolderItem } from '../client/api';
import { RssBuilder, type BuilderEdit } from './RssBuilder';

type SavedBuilder = BuilderEdit & { sourceUrl: string };
/** 데스크톱 피드 메뉴와 모바일 길게 누르기에서 같은 수정 화면을 연다. */
export function RssBuilderEditor({ builderId, folders, isDark, onClose, onSaved }: { builderId: string; folders: FolderItem[]; isDark: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [builder, setBuilder] = useState<SavedBuilder | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0), [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDialogElement>(null), titleId = useId();
  useEffect(() => {
    const controller = new AbortController(); setBuilder(null); setError('');
    void apiRequest<SavedBuilder>(`/api/rss-builder/${encodeURIComponent(builderId)}`, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setBuilder(value); })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '피드 설정을 불러오지 못했습니다.'); });
    return () => controller.abort();
  }, [builderId, retry]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/65 backdrop-blur-xs sm:p-4" onClick={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}>
    <dialog open ref={ref} aria-modal="true" aria-labelledby={titleId} className={`relative m-0 flex h-dvh max-h-dvh w-full max-w-5xl flex-col overflow-hidden border-0 p-0 sm:h-auto sm:max-h-[90dvh] sm:rounded-2xl ${isDark ? 'bg-slate-900 text-slate-100' : 'bg-white text-slate-900'}`} onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); if (!busy) onClose(); }
      if (event.key === 'Tab') {
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],iframe')].filter((element) => element.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <header className={`feedex-discover-header flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3 sm:px-6 ${isDark ? 'border-slate-800' : 'border-slate-200'}`}><h2 id={titleId} className="text-base font-bold">RSS 빌더 피드 수정</h2><button type="button" aria-label="RSS 빌더 수정 닫기" disabled={busy} onClick={onClose} className="rounded-lg p-2 disabled:opacity-40"><X size={21} /></button></header>
      <div className="feedex-discover-body min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
        {error ? <div role="alert" className="space-y-3 text-sm text-rose-500"><p>{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)} className="font-semibold underline">다시 불러오기</button></div> : builder ? <RssBuilder key={builder.id} url={builder.sourceUrl} edit={builder} folders={folders} isDark={isDark} onBack={onClose} onSubscribed={onSaved} onBusyChange={setBusy} /> : <p role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400"><Loader2 size={17} className="animate-spin" />저장된 피드 설정을 불러오는 중…</p>}
      </div>
    </dialog>
  </div>, document.body);
}
