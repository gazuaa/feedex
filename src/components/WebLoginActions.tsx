import { useEffect, useRef, useState } from 'react';
import { ExternalLink, LogIn, RefreshCw } from 'lucide-react';
import { openOriginalArticle, watchOriginalReturn } from '../client/originalWindow';

export function WebLoginActions({ url, isDark, onReload }: { url: string; isDark: boolean; onReload: () => void }) {
  const [opened, setOpened] = useState(false), [waiting, setWaiting] = useState(false);
  const reload = useRef(onReload); reload.current = onReload;
  useEffect(() => { if (!waiting) return; return watchOriginalReturn(window, document, () => { setWaiting(false); reload.current(); }); }, [waiting]);
  return <div className={`sfeed-web-login flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-2 text-xs ${isDark ? 'border-slate-800 bg-slate-900 text-slate-300' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
    <span className="min-w-0 flex-1 leading-relaxed">{opened ? '로그인 후에도 다시 묻는다면 원문 창에서 계속 읽어 주세요.' : '로그인이 필요한 글은 원문 창에서 로그인하고 읽을 수 있어요.'}</span>
    <div className="flex shrink-0 items-center gap-3"><a href={url} target="_blank" rel="noopener noreferrer" onClick={event => { if (openOriginalArticle(url)) event.preventDefault(); setOpened(true); setWaiting(true); }} className="inline-flex items-center gap-1.5 font-semibold text-emerald-500"><LogIn size={14} aria-hidden="true" />{opened ? '원문 창에서 읽기' : '로그인해서 읽기'}<ExternalLink size={12} aria-hidden="true" /></a>
    {opened && <button type="button" onClick={() => { setWaiting(false); onReload(); }} className="inline-flex items-center gap-1.5"><RefreshCw size={13} aria-hidden="true" />로그인 후 다시 표시</button>}</div>
  </div>;
}
