import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Copy, Loader2, Rss, ExternalLink, X } from 'lucide-react';
import { apiRequest, type FolderItem } from '../client/api';
import type { BuilderAnalysis } from '../shared/rssBuilder';
import { PICK_FIELDS, encodePick, pickerDocument, type PickField, type PickSelection, type PickedItem } from '../shared/rssPicker';
import { SubscribeFolderStep, type FolderChoice } from './SubscribeFolderStep';

const FIELD_LABELS: Record<PickField, string> = { title: '제목', summary: '요약', image: '이미지', date: '날짜' };
const FIELD_HINTS: Record<PickField, string> = {
  title: '페이지에서 글 제목 하나를 누르세요. 같은 모양의 글이 함께 선택됩니다.',
  summary: '초록 테두리로 표시된 글 카드 안에서 요약 문장을 누르세요.',
  image: '글 카드 안의 대표 이미지를 누르세요.',
  date: '글 카드 안의 날짜를 누르세요.',
};
// 고르기 도구가 페이지 사본 안에 칠하는 색과 같다.
const FIELD_DOTS: Record<PickField, string> = { title: 'bg-emerald-500', summary: 'bg-blue-500', image: 'bg-amber-500', date: 'bg-purple-500' };
// <time datetime> 값은 날짜로 보여 주는 편이 읽기 좋다. 다른 글자는 페이지에 찍힌 그대로 보여 준다.
const shownDate = (value: string) => {
  const date = /^\d{4}-\d{2}-\d{2}T/.test(value) ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : value;
};
const FIELD_ACTIVE: Record<PickField, string> = {
  title: 'border-emerald-500 bg-emerald-500/10',
  summary: 'border-blue-500 bg-blue-500/10',
  image: 'border-amber-500 bg-amber-500/10',
  date: 'border-purple-500 bg-purple-500/10',
};

export function RssBuilder({ url, folders, isDark, onBack, onSubscribed, onBusyChange }: { url: string; folders: FolderItem[]; isDark: boolean; onBack: () => void; onSubscribed: () => Promise<void>; onBusyChange: (busy: boolean) => void }) {
  const [analysis, setAnalysis] = useState<BuilderAnalysis | null>(null);
  const [selected, setSelected] = useState(0);
  const [title, setTitle] = useState('');
  // 목록을 고른 뒤에는 다른 구독과 똑같이 폴더 고르기 단계를 거친다.
  const [step, setStep] = useState<'pick' | 'folder'>('pick');
  const [createError, setCreateError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [field, setField] = useState<PickField>('title');
  const [selection, setSelection] = useState<PickSelection | null>(null);
  const [picked, setPicked] = useState<PickedItem[]>([]);
  const [pickedCount, setPickedCount] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const fieldRef = useRef(field);
  fieldRef.current = field;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setAnalysis(null); setSelection(null); setPicked([]); setPickedCount(0); setNotice(null); setField('title'); setStep('pick');
    apiRequest<BuilderAnalysis>('/api/rss-builder/analyse', { method: 'POST', signal: controller.signal, body: JSON.stringify({ url }) })
      .then((result) => { if (!controller.signal.aborted) { setAnalysis(result); setTitle(result.title); setSelected(0); } })
      .catch((err) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '페이지를 분석하지 못했습니다.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, retry]);

  const pickerSource = useMemo(
    () => (analysis?.snapshot ? pickerDocument(analysis.snapshot, analysis.sourceUrl, analysis.groups[0]?.articles[0]?.url ?? null) : null),
    [analysis]
  );
  const sendToPicker = (message: Record<string, unknown>) => frameRef.current?.contentWindow?.postMessage({ source: 'sfeed-app', ...message }, '*');

  useEffect(() => {
    // 페이지 사본은 불투명한 출처에서 돈다. 우리 프레임에서 온 메시지만 믿는다.
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (event.source !== frameRef.current?.contentWindow || data?.source !== 'sfeed-picker') return;
      if (data.type === 'ready') sendToPicker({ type: 'field', field: fieldRef.current });
      if (data.type === 'notice') setNotice(typeof data.message === 'string' ? data.message : null);
      if (data.type === 'selection' && typeof data.selection?.item === 'string' && Array.isArray(data.items)) {
        setSelection(data.selection);
        setPicked(data.items.filter((item: PickedItem) => typeof item?.title === 'string' && typeof item.url === 'string'));
        setPickedCount(Number(data.count) || 0);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const chooseField = (next: PickField) => {
    setField(next);
    setNotice(null);
    sendToPicker({ type: 'field', field: next });
  };

  const inputClass = `w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 ${isDark ? 'bg-slate-950 border-slate-700 text-slate-100' : 'bg-white border-slate-300 text-slate-900'}`;
  const picking = Boolean(pickerSource);
  const group = analysis?.groups[selected];
  const selector = picking ? (selection && pickedCount ? encodePick(selection, Boolean(analysis?.rendered)) : null) : group?.selector ?? null;
  const create = async (choice: FolderChoice) => {
    if (!analysis || !selector) return;
    setCreating(true); onBusyChange(true); setCreateError(null);
    try {
      const result = await apiRequest<{ rssUrl: string }>('/api/rss-builder', { method: 'POST', body: JSON.stringify({ url: analysis.sourceUrl, selector, title: choice.title, folderId: choice.folderId, folderName: choice.folderName }) });
      setCreated(result.rssUrl);
      await onSubscribed();
    } catch (err) { setCreateError(err instanceof Error ? err.message : 'RSS 피드를 만들지 못했습니다.'); }
    finally { setCreating(false); onBusyChange(false); }
  };

  const createButton = (count: number) => <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="text-sm font-semibold">글 미리보기 · {count}개</h4><button type="button" disabled={!selector} onClick={() => { setCreateError(null); setStep('folder'); }} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-4 py-2.5 text-xs font-semibold text-slate-950 cursor-pointer disabled:opacity-50 disabled:cursor-default"><Rss size={14} />구독하기</button></div>;
  const cardBorder = isDark ? 'border-slate-800' : 'border-slate-200';

  const choosingFolder = step === 'folder' && Boolean(analysis) && !created;
  return <>
  {choosingFolder && <SubscribeFolderStep feedTitle={title} siteUrl={analysis!.sourceUrl} folders={folders} isDark={isDark} busy={creating} error={createError} confirmLabel="피드 만들고 구독" onBack={() => setStep('pick')} onConfirm={create} />}
  {/* 폴더를 고르는 동안에는 언마운트하지 않고 숨긴다. 페이지 사본이 고른 목록을 지키게 한다. */}
  <section aria-label="RSS 빌더" className={choosingFolder ? 'hidden' : 'space-y-5'}>
    <button type="button" disabled={creating} onClick={onBack} className="inline-flex items-center gap-1.5 text-xs text-emerald-500 cursor-pointer"><ArrowLeft size={14} />검색 결과로</button>
    <div><h3 className="flex items-center gap-2 text-base font-bold"><Rss size={18} className="text-emerald-500" />RSS 빌더</h3><p className="mt-2 text-xs leading-relaxed text-slate-400">RSS가 없어도 웹사이트의 글 목록으로 피드를 만들 수 있습니다. 페이지에서 수집할 글을 직접 골라 보세요.</p><a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-500 break-all">{url}<ExternalLink size={12} className="shrink-0" /></a></div>
    {loading && <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><Loader2 size={18} className="animate-spin" />웹페이지를 불러오는 중입니다…</div>}
    {error && <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-500">{error}{!analysis && <button type="button" onClick={() => setRetry((n) => n + 1)} className="block mt-3 text-xs font-semibold underline cursor-pointer">다시 분석</button>}</div>}
    {created ? <div role="status" className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4"><h4 className="flex items-center gap-2 font-semibold text-emerald-500"><Check size={16} />RSS 피드를 만들고 구독했습니다</h4><p className="text-xs text-slate-400">새 글은 피드 새로고침과 정기 갱신에 반영됩니다.</p><label className="block text-xs font-semibold">RSS 주소<input readOnly value={created} onFocus={(event) => event.target.select()} className={`${inputClass} mt-2`} /></label><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(created); setCopied(true); } catch { setCopied(false); } }} className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-500 cursor-pointer"><Copy size={14} />{copied ? '복사됨' : 'RSS 주소 복사'}</button></div> : analysis && pickerSource ? <>
      <div className="space-y-2">
        <div role="radiogroup" aria-label="페이지에서 고를 항목" className="flex flex-wrap gap-2">
          {PICK_FIELDS.map((name) => {
            const chosen = name === 'title' ? Boolean(selection) : selection?.[name] !== undefined;
            return <div key={name} className={`inline-flex items-center rounded-xl border text-xs ${field === name ? FIELD_ACTIVE[name] : isDark ? 'border-slate-700' : 'border-slate-200'}`}>
              <button type="button" role="radio" aria-checked={field === name} disabled={creating} onClick={() => chooseField(name)} className="inline-flex items-center gap-1.5 py-1.5 pl-3 pr-2 font-semibold cursor-pointer">
                <span aria-hidden="true" className={`h-2 w-2 rounded-full ${FIELD_DOTS[name]}`} />{FIELD_LABELS[name]}
                <span className="font-normal text-slate-400">{chosen ? name === 'title' ? `${pickedCount}개` : '선택됨' : name === 'title' ? '필수' : '선택 안 함'}</span>
              </button>
              {name !== 'title' && chosen && <button type="button" aria-label={`${FIELD_LABELS[name]} 선택 해제`} disabled={creating} onClick={() => sendToPicker({ type: 'clear', field: name })} className="py-1.5 pr-2 text-slate-400 hover:text-rose-500 cursor-pointer"><X size={12} /></button>}
            </div>;
          })}
        </div>
        <p className="text-xs text-slate-400">{FIELD_HINTS[field]}{field === 'title' && selection ? ' 요약·이미지·날짜는 카드 안에서 자동으로 찾았습니다. 바꾸려면 위에서 항목을 고른 뒤 페이지를 누르세요.' : ''}</p>
        {notice && <p role="status" className="text-xs text-amber-500">{notice}</p>}
        <iframe ref={frameRef} title="웹페이지 미리보기 (눌러서 고르기)" sandbox="allow-scripts" srcDoc={pickerSource} className={`block w-full h-[55vh] min-h-[320px] rounded-xl border bg-white ${cardBorder}`} />
      </div>
      {createButton(pickedCount)}
      <p className="text-[11px] text-slate-400">미리보기만으로는 구독되지 않습니다. 날짜를 고르지 않으면 수집한 시각으로 표시합니다.</p>
      {picked.length ? <ul className="space-y-2">{picked.slice(0, 10).map((article) => <li key={article.url} className={`flex gap-3 rounded-xl border p-3 ${cardBorder}`}>
        {article.image && <img src={article.image} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded-lg object-cover" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
        <div className="min-w-0"><a href={article.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold hover:text-emerald-500">{article.title}</a>{article.summary && <p className="mt-1 line-clamp-2 text-xs text-slate-400">{article.summary}</p>}{article.dateText && <p className="mt-1 text-[11px] text-slate-400">{shownDate(article.dateText)}</p>}</div>
      </li>)}</ul> : <p className="py-6 text-center text-xs text-slate-400">페이지에서 글 제목을 누르면 수집될 글이 여기에 표시됩니다.</p>}
    </> : analysis && group && <>
      {analysis.groups.length > 1 && <fieldset className="space-y-2"><legend className="mb-2 text-sm font-semibold">수집할 글 목록</legend>{analysis.groups.map((candidate, index) => <label key={candidate.selector} className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-xs ${selected === index ? 'border-emerald-500 bg-emerald-500/5' : isDark ? 'border-slate-700' : 'border-slate-200'}`}><input type="radio" name="builder-group" checked={selected === index} disabled={creating} onChange={() => setSelected(index)} className="mt-0.5 accent-emerald-500" /><span className="min-w-0"><strong>{candidate.articles[0]?.title}</strong><span className="mt-1 block text-slate-400">{candidate.articles.length}개 글</span></span></label>)}</fieldset>}
      {createButton(group.articles.length)}
      {analysis.fromSitemap && <p role="note" className={`rounded-xl border p-3 text-xs leading-relaxed ${isDark ? 'border-amber-500/30 bg-amber-500/5 text-amber-200' : 'border-amber-300 bg-amber-50 text-amber-800'}`}>이 사이트는 자동 수집을 막고 있어, 검색엔진용으로 공개한 사이트맵의 글 주소로 피드를 만듭니다. 제목은 주소에서 만들어지고 요약과 이미지는 없습니다. 글은 웹 보기나 새 창에서 읽을 수 있습니다.</p>}
      <p className="text-[11px] text-slate-400">미리보기만으로는 구독되지 않습니다. 발행일은 사이트에서 확인되는 경우에만 표시합니다.</p>
      <ul className="space-y-2">{group.articles.slice(0, 20).map((article) => <li key={article.url} className={`rounded-xl border p-3 ${cardBorder}`}><a href={article.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold hover:text-emerald-500">{article.title}</a><p className="mt-1 text-[11px] text-slate-400">{article.dateSource === 'collected' ? '발행일 미제공' : new Date(article.publishedAt).toLocaleDateString('ko-KR')}</p></li>)}</ul>
    </>}
  </section>
  </>;
}
