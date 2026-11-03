import { useEffect, useRef, useState } from 'react';
import { apiRequest, getStoredToken, type SubscriptionItem } from '../client/api';
import { ConfirmDialog } from './ConfirmDialog';

export interface RenamedFeed { customTitle: string | null; title: string }
export function RenameFeedDialog({ feed, isDark, onClose, onRenamed }: { feed: SubscriptionItem; isDark: boolean; onClose: () => void; onRenamed: (value: RenamedFeed) => Promise<void> }) {
  const [name, setName] = useState(feed.title), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const mounted = useRef(true), pending = useRef(false), token = useRef(getStoredToken()), input = useRef<HTMLInputElement>(null);
  useEffect(() => { mounted.current = true; input.current?.focus(); input.current?.select(); return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && token.current === getStoredToken();
  const save = async () => {
    if (pending.current || !current()) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      const value = await apiRequest<RenamedFeed>(`/api/subscriptions/${encodeURIComponent(feed.id)}`, { method: 'PUT', body: JSON.stringify({ customTitle: name.trim() || null }) });
      if (!current()) return;
      await onRenamed(value);
      if (current()) onClose();
    } catch (reason) { if (current()) setError(reason instanceof Error ? reason.message : '이름을 저장하지 못했습니다. 다시 시도해 주세요.'); }
    finally { pending.current = false; if (current()) setBusy(false); }
  };
  return <ConfirmDialog title="피드 이름 수정" confirmLabel="저장" busyLabel="저장 중…" isDark={isDark} busy={busy} error={error} onCancel={onClose} onConfirm={() => void save()}>
    <label className="block"><span>피드 이름</span><input ref={input} aria-label="피드 이름" value={name} maxLength={200} disabled={busy} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void save(); } }} className={`mt-2 w-full rounded-xl border px-3 py-2.5 ${isDark ? 'border-slate-700 bg-slate-950' : 'border-slate-300 bg-white'}`} /></label>
    <p className="mt-3 text-xs text-slate-400">내 계정의 모든 기기에 적용됩니다. 비워서 저장하면 원래 피드 이름으로 돌아갑니다.</p>
    {feed.custom_title && <button type="button" disabled={busy} onClick={() => { setName(''); input.current?.focus(); }} className="mt-3 text-xs text-emerald-500 underline">원래 이름 사용</button>}
  </ConfirmDialog>;
}
