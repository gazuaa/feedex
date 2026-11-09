import { useLayoutEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { SyncStatus } from '../client/syncStatus';
import { SyncStatusNotice } from './SyncStatusNotice';
import { Archive, ArrowDownUp, ArrowLeft, Bookmark, CheckCheck, LayoutGrid, LayoutList, AlignJustify, Plus, Rss, Search, Settings2, Sun, Moon, X, FileCode2 } from 'lucide-react';
import type { LayoutMode, ThemeMode } from '../client/api';
import { InstallAppButton } from './PwaInstall';
import { ScrollReadSetting, TextSizeSetting, LayoutSetting, AutoRefreshSetting, SettingGroup, SettingRow, type ScrollReadSettingsProps, type RefreshSettingsProps, type SortSettingProps } from './ReadingSettings';
import { LocalNotificationSetting } from './LocalNotificationSetting';
import { CacheSettings } from './CacheSettings';
import { TranslationSetting } from './TranslationSetting';
import { ArticleBlockSetting } from './ArticleBlockDialog';
import { RefreshIcon } from './RefreshIcon';

export type LibraryTab = 'all' | 'unread' | 'saved';
export interface MobileSettingsProps extends ScrollReadSettingsProps, RefreshSettingsProps, Partial<SortSettingProps> {
  syncStatus?: SyncStatus;
  syncBusy?: boolean;
  accountId?: string;
  onManageArticleBlocks?: () => void;
  theme: ThemeMode;
  onChangeTheme: (theme: ThemeMode) => void;
  layout: LayoutMode;
  onChangeLayout: (layout: LayoutMode) => void;
  onOpenOpml: () => void;
}

function MobileSettingsSheet({ children, onClose, trigger }: { children: ReactNode; onClose: () => void; trigger: RefObject<HTMLButtonElement | null> }) {
  const ref = useRef<HTMLDialogElement>(null), titleId = useId();
  const pressed = useRef(false);
  useLayoutEffect(() => {
    const previous = trigger.current || document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [trigger]);
  return createPortal(<dialog ref={ref} className="feedex-mobile-settings-sheet" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onPointerDown={event => { pressed.current = event.target === event.currentTarget; }} onClick={event => { if (pressed.current && event.target === event.currentTarget) onClose(); pressed.current = false; }}>
    <header className="feedex-mobile-settings-heading"><h2 id={titleId}>설정</h2><button type="button" aria-label="설정 닫기" onClick={onClose}><X size={22} /></button></header>
    {children}
  </dialog>, document.body);
}

export function MobileSettings(props: MobileSettingsProps & { library?: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <div className="feedex-mobile-settings">
    <button ref={trigger} type="button" aria-label="보기 설정" aria-haspopup="dialog" aria-expanded={open} className="feedex-mobile-icon" onClick={() => setOpen(true)}><Settings2 size={21} /></button>
    {open && <MobileSettingsSheet trigger={trigger} onClose={() => setOpen(false)}><MobileSettingsContent {...props} onDismiss={() => setOpen(false)} /></MobileSettingsSheet>}
  </div>;
}

export function MobileSettingsContent({ theme, onChangeTheme, layout, onChangeLayout, onOpenOpml, library, markReadOnScroll, onChangeMarkReadOnScroll, autoRefreshMinutes, onChangeAutoRefreshMinutes, accountId, onManageArticleBlocks, onDismiss }: MobileSettingsProps & { library?: boolean; onDismiss?: () => void }) {
  const close = () => onDismiss?.();
  return <div className="feedex-mobile-settings-panel">
      <SettingGroup title="보기">
        <SettingRow label="화면"><div className="feedex-segmented" role="group" aria-label="화면">{(['light', 'dark'] as const).map((value) => { const Icon = value === 'light' ? Sun : Moon; return <button key={value} aria-label={value === 'light' ? '낮 모드' : '밤 모드'} aria-pressed={theme === value} onClick={() => onChangeTheme(value)}><Icon size={17} /></button>; })}</div></SettingRow>
        <TextSizeSetting />
        {!library && <LayoutSetting layout={layout} onChangeLayout={(value) => { onChangeLayout(value); close(); }} />}
      </SettingGroup>
      {!library && <SettingGroup title="읽기"><ScrollReadSetting markReadOnScroll={markReadOnScroll} onChangeMarkReadOnScroll={onChangeMarkReadOnScroll} /></SettingGroup>}
      <SettingGroup title="새 글"><AutoRefreshSetting autoRefreshMinutes={autoRefreshMinutes} onChangeAutoRefreshMinutes={onChangeAutoRefreshMinutes} />{accountId && <LocalNotificationSetting accountId={accountId} />}</SettingGroup>
      {accountId && onManageArticleBlocks && <SettingGroup title="계정"><ArticleBlockSetting accountId={accountId} onManage={() => { close(); onManageArticleBlocks(); }} /><TranslationSetting /></SettingGroup>}
      {accountId && <SettingGroup title="이 기기"><CacheSettings accountId={accountId} active /></SettingGroup>}
      <SettingGroup title="기타">
        <button type="button" onClick={() => { close(); onOpenOpml(); }}><FileCode2 size={17} />OPML 가져오기 / 내보내기</button>
        <InstallAppButton />
      </SettingGroup>
    </div>;
}

// 글 정렬은 설정 메뉴에 숨기지 않고 설정 버튼 왼쪽에 둔다. 누를 때마다 최신순과 오래된순을 바꾼다.
export function MobileHeader({ title, library, hidden, search, onSearch, onCommitSearch, onBack, onAdd, sort, onChangeSort, syncStatus, syncBusy, ...settings }: MobileSettingsProps & { title: string; library?: boolean; hidden?: boolean; search: string; onSearch: (value: string) => void; onCommitSearch?: (value?: string) => void; onBack?: () => void; onAdd: () => void }) {
  return <header className="feedex-mobile-header" data-scroll-hidden={hidden || undefined} inert={hidden || undefined} aria-hidden={hidden || undefined}>
    <div className="feedex-mobile-heading">
      {library ? <span className="feedex-mobile-brand-icon"><Rss size={19} strokeWidth={2.4} /></span> : <button className="feedex-mobile-icon" onClick={onBack} aria-label="내 피드로 돌아가기"><ArrowLeft size={20} /></button>}
      <h1>{title}</h1>
      <div className="feedex-mobile-header-actions">{!library && sort && onChangeSort && <button type="button" className="feedex-mobile-sort" onClick={() => onChangeSort(sort === 'oldest' ? 'newest' : 'oldest')} aria-label={`정렬: ${sort === 'oldest' ? '오래된순, 최신순으로 전환' : '최신순, 오래된순으로 전환'}`}><ArrowDownUp size={14} aria-hidden="true" /><span>{sort === 'oldest' ? '오래된순' : '최신순'}</span></button>}<MobileSettings library={library} {...settings} /><button className="feedex-mobile-icon" onClick={onAdd} aria-label="피드 추가"><Plus size={21} /></button></div>
    </div>
    <label className="feedex-mobile-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label={library ? '폴더 및 피드 검색' : '글 검색'} placeholder={library ? '폴더 또는 피드 검색' : '글 검색'} value={search} onChange={(event) => onSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onCommitSearch?.(search); }} autoComplete="off" />{search && <button aria-label="검색어 지우기" onClick={() => { onSearch(''); onCommitSearch?.(''); }}><X size={16} /></button>}</label>
    {syncStatus && <SyncStatusNotice status={syncStatus} busy={syncBusy} />}
  </header>;
}

export function MobileDock({ active, onSelect, onRefresh, refreshing, syncing = false, onMarkAllRead, library, onAdd, hidden }: { /** 보관함에서는 null이다. 보관함은 목록이 아니기 때문이다. */ active: LibraryTab | null; onSelect: (tab: LibraryTab) => void; onRefresh: () => void; refreshing: boolean; /** 백그라운드 동기화. 아이콘은 돌지만 전체 새로고침을 막지는 않는다. */ syncing?: boolean; onMarkAllRead: () => void; library?: boolean; onAdd: () => void; hidden?: boolean }) {
  return <nav aria-label="모바일 글 탐색" className="feedex-mobile-dock lg:hidden" data-scroll-hidden={hidden || undefined} inert={hidden || undefined} aria-hidden={hidden || undefined}>
    <button aria-label="피드 새로고침" aria-busy={refreshing || syncing || undefined} onClick={onRefresh}><RefreshIcon size={19} spinning={refreshing || syncing} /></button>
    <div className="feedex-mobile-dock-tabs">{([{ id: 'all', label: '전체', Icon: Archive }, { id: 'unread', label: '안 읽음', Icon: null }, { id: 'saved', label: '저장', Icon: Bookmark }] as const).map(({ id, label, Icon }) => <button key={id} aria-label={label} aria-pressed={active === id} onClick={() => onSelect(id)}>{Icon ? <Icon size={19} /> : <span className="feedex-unread-dot" />}<span>{label}</span></button>)}</div>
    <button aria-label={library ? '피드 추가' : '모두 읽음'} onClick={library ? onAdd : onMarkAllRead}>{library ? <Plus size={20} /> : <CheckCheck size={20} />}</button>
  </nav>;
}
