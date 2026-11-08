import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import type { SubscriptionItem } from '../client/api';

export function FeedExclusionsDialog({ subscriptions, excluded, onSave, onClose }: {
  subscriptions: SubscriptionItem[]; excluded: string[]; onSave: (ids: string[]) => Promise<void>; onClose: () => void;
}) {
  const [selected, setSelected] = useState(() => new Set(excluded));
  const [search, setSearch] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const ref = useRef<HTMLDialogElement>(null), titleId = useId();
  const feeds = [...new Map(subscriptions.map(feed => [feed.feed_id, feed])).values()]
    .sort((a, b) => (a.custom_title || a.title).localeCompare(b.custom_title || b.title));
  const filtered = feeds.filter(feed => `${feed.custom_title || ''} ${feed.title} ${feed.xml_url}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const count = feeds.filter(feed => selected.has(feed.feed_id)).length;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector('input')?.focus();
    return () => previous?.focus();
  }, []);
  const close = () => { if (!busy) onClose(); };
  return createPortal(<div className="feedex-block-overlay" onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <dialog open ref={ref} className="feedex-block-dialog feedex-exclusions-dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <header className="feedex-block-heading"><div><h2 id={titleId}>전체 글에서 피드 제외</h2><p>선택한 피드는 전체·안 읽음에서 숨깁니다.<br />폴더·개별 피드·저장에서는 계속 볼 수 있습니다.</p></div><button type="button" disabled={busy} aria-label="닫기" onClick={close}><X size={21} /></button></header>
      <label className="feedex-exclusions-search"><Search size={18} /><input placeholder="피드 검색" aria-label="피드 검색" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <div className="feedex-exclusions-count"><span>{count}개 피드 제외</span><button type="button" disabled={busy || !selected.size} onClick={() => setSelected(new Set())}>모두 해제</button></div>
      <div className="feedex-exclusions-list">
        {filtered.map(feed => <label key={feed.feed_id}><input type="checkbox" disabled={busy} checked={selected.has(feed.feed_id)} onChange={event => {
          const next = new Set(selected); event.target.checked ? next.add(feed.feed_id) : next.delete(feed.feed_id); setSelected(next);
        }} /><span>{feed.custom_title || feed.title}<small>{feed.xml_url}</small></span></label>)}
        {!filtered.length && <p>검색 결과가 없습니다.</p>}
      </div>
      {error && <p role="alert">{error}</p>}
      <footer className="feedex-exclusions-actions"><small>같은 계정의 기기에 동기화됩니다.</small><button type="button" disabled={busy} onClick={close}>취소</button><button type="button" disabled={busy} onClick={async () => {
        setBusy(true); setError('');
        try { await onSave([...selected]); onClose(); }
        catch { setError('저장하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.'); }
        finally { setBusy(false); }
      }}>{busy ? '저장 중…' : '적용'}</button></footer>
    </dialog>
  </div>, document.body);
}
