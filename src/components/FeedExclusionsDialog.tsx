import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Folder, Search, X } from 'lucide-react';
import type { FolderItem, SubscriptionItem } from '../client/api';
import { t } from '../shared/i18n';

export function FeedExclusionsDialog({ subscriptions, folders, excluded, onSave, onClose }: {
  subscriptions: SubscriptionItem[]; folders: FolderItem[]; excluded: string[]; onSave: (ids: string[]) => Promise<void>; onClose: () => void;
}) {
  const [selected, setSelected] = useState(() => new Set(excluded));
  const [search, setSearch] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const ref = useRef<HTMLDialogElement>(null), titleId = useId();
  const [expanded, setExpanded] = useState(new Set<string>());
  const [searchCollapsed, setSearchCollapsed] = useState(new Set<string>());
  const feeds = [...new Map(subscriptions.map(feed => [feed.feed_id, feed])).values()]
    .sort((a, b) => (a.custom_title || a.title).localeCompare(b.custom_title || b.title));
  const query = search.trim().toLocaleLowerCase();
  const folderIds = new Set(folders.map(folder => folder.id));
  const groups = [...folders.map(folder => ({ id: folder.id, name: folder.name, feeds: feeds.filter(feed => feed.folder_id === folder.id) })),
    { id: 'unfiled', name: t('미분류', 'Unfiled'), feeds: feeds.filter(feed => !feed.folder_id || !folderIds.has(feed.folder_id)) }]
    .map(group => ({ ...group, visible: group.name.toLocaleLowerCase().includes(query) ? group.feeds : group.feeds.filter(feed => `${feed.custom_title || ''} ${feed.title} ${feed.xml_url}`.toLocaleLowerCase().includes(query)) }))
    .filter(group => group.visible.length > 0);
  const toggleExpanded = (id: string) => {
    const update = (current: Set<string>) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; };
    if (query) setSearchCollapsed(update); else setExpanded(update);
  };
  const count = feeds.filter(feed => selected.has(feed.feed_id)).length;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    // 손가락으로 쓰는 기기에서는 검색칸에 바로 초점을 주면 키보드가 창을 가린다. 창에만 초점을 둔다.
    if (window.matchMedia?.('(pointer: coarse)').matches) ref.current?.focus({ preventScroll: true });
    else ref.current?.querySelector('input')?.focus();
    return () => previous?.focus();
  }, []);
  const close = () => { if (!busy) onClose(); };
  return createPortal(<div className="feedex-block-overlay" onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <dialog open ref={ref} tabIndex={-1} className="feedex-block-dialog feedex-exclusions-dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <header className="feedex-block-heading"><div><h2 id={titleId}>{t('전체 글에서 피드 제외', 'Hide feeds from All articles')}</h2><p>{t('선택한 피드는 전체·안 읽음에서 숨깁니다.', 'Selected feeds are hidden from All and Unread.')}<br />{t('폴더·개별 피드·저장에서는 계속 볼 수 있습니다.', 'You can still see them in folders, the feed itself and Saved.')}</p></div><button type="button" disabled={busy} aria-label={t('닫기', 'Close')} onClick={close}><X size={21} /></button></header>
      <label className="feedex-exclusions-search"><Search size={18} /><input placeholder={t('폴더 또는 피드 검색', 'Search folders or feeds')} aria-label={t('폴더 또는 피드 검색', 'Search folders or feeds')} value={search} onChange={event => { setSearch(event.target.value); setSearchCollapsed(new Set()); }} /></label>
      <div className="feedex-exclusions-count"><span>{t(`${count}개 피드 제외`, `${count} feeds hidden`)}</span><button type="button" disabled={busy || !selected.size} onClick={() => setSelected(new Set())}>{t('모두 해제', 'Clear all')}</button></div>
      <div className="feedex-exclusions-list">
        {groups.map(group => {
          const open = query ? !searchCollapsed.has(group.id) : expanded.has(group.id);
          const excludedCount = group.feeds.filter(feed => selected.has(feed.feed_id)).length;
          return <section className="feedex-exclusions-group" key={group.id}>
            <div className="feedex-exclusions-folder">
              <input type="checkbox" aria-label={t(`${group.name} 폴더 전체 제외`, `Hide all of ${group.name}`)} disabled={busy} checked={excludedCount === group.feeds.length} ref={input => { if (input) input.indeterminate = excludedCount > 0 && excludedCount < group.feeds.length; }} onChange={event => {
                const next = new Set(selected);
                for (const feed of group.feeds) event.target.checked ? next.add(feed.feed_id) : next.delete(feed.feed_id);
                setSelected(next);
              }} />
              <button type="button" aria-expanded={open} aria-controls={`${titleId}-${group.id}`} onClick={() => toggleExpanded(group.id)}>
                <ChevronRight size={16} className={open ? 'is-open' : ''} /><Folder size={18} /><span>{group.name}</span>
                <small title={t(`전체 ${group.feeds.length}개 중 ${excludedCount}개 제외`, `${excludedCount} of ${group.feeds.length} hidden`)}>{excludedCount} / {group.feeds.length}</small>
              </button>
            </div>
            {open && <div id={`${titleId}-${group.id}`} className="feedex-exclusions-feeds">
              {group.visible.map(feed => <label key={feed.feed_id}><input type="checkbox" disabled={busy} checked={selected.has(feed.feed_id)} onChange={event => {
                const next = new Set(selected); event.target.checked ? next.add(feed.feed_id) : next.delete(feed.feed_id); setSelected(next);
              }} /><span>{feed.custom_title || feed.title}<small>{feed.xml_url}</small></span></label>)}
            </div>}
          </section>;
        })}
        {!groups.length && <p>{t('검색 결과가 없습니다.', 'No results.')}</p>}
      </div>
      {error && <p role="alert">{error}</p>}
      <footer className="feedex-exclusions-actions"><small>{t('같은 계정의 기기에 동기화됩니다.', 'Synced to your other devices.')}</small><button type="button" disabled={busy} onClick={close}>{t('취소', 'Cancel')}</button><button type="button" disabled={busy} onClick={async () => {
        setBusy(true); setError('');
        try { await onSave([...selected]); onClose(); }
        catch { setError(t('저장하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.', 'Could not save. Check your connection and try again.')); }
        finally { setBusy(false); }
      }}>{busy ? t('저장 중…', 'Saving…') : t('적용', 'Apply')}</button></footer>
    </dialog>
  </div>, document.body);
}
