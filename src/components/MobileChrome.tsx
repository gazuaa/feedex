import { useLayoutEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { FeedExIcon, FeedExWordmark } from './BrandMark';
import { createPortal } from 'react-dom';
import type { SyncStatus } from '../client/syncStatus';
import { SyncStatusNotice } from './SyncStatusNotice';
import { Archive, ArrowDownUp, ArrowLeft, Bookmark, CheckCheck, ChevronRight, LayoutGrid, LayoutList, AlignJustify, Plus, Search, Settings2, X, FileCode2, SunMoon } from 'lucide-react';
import type { LayoutMode, ThemePreference } from '../client/api';
import { useThemeOptions } from './ThemeSwitch';
import { InstallAppButton } from './PwaInstall';
import { ScrollReadSetting, TextSizeSetting, LanguageSetting, LayoutSetting, AutoRefreshSetting, SettingGroup, SettingRow, type ScrollReadSettingsProps, type RefreshSettingsProps, type SortSettingProps } from './ReadingSettings';
import { LocalNotificationSetting } from './LocalNotificationSetting';
import { CacheSettings } from './CacheSettings';
import { TranslationSetting } from './TranslationSetting';
import { XMirrorStatus } from './XMirrorStatus';
import { ArticleBlockSetting } from './ArticleBlockDialog';
import { RefreshIcon } from './RefreshIcon';
import { t } from '../shared/i18n';

export type LibraryTab = 'all' | 'unread' | 'saved';
export interface MobileSettingsProps extends ScrollReadSettingsProps, RefreshSettingsProps, Partial<SortSettingProps> {
  syncStatus?: SyncStatus;
  accountId?: string;
  onManageArticleBlocks?: () => void;
  theme: ThemePreference;
  onChangeTheme: (theme: ThemePreference) => void;
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
    <header className="feedex-mobile-settings-heading"><h2 id={titleId}>{t('설정', 'Settings')}</h2><button type="button" aria-label={t('설정 닫기', 'Close settings')} onClick={onClose}><X size={22} /></button></header>
    {children}
  </dialog>, document.body);
}

export function MobileSettings(props: MobileSettingsProps & { library?: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <div className="feedex-mobile-settings">
    <button ref={trigger} type="button" aria-label={t('보기 설정', 'Settings')} aria-haspopup="dialog" aria-expanded={open} className="feedex-mobile-icon" onClick={() => setOpen(true)}><Settings2 size={21} /></button>
    {open && <MobileSettingsSheet trigger={trigger} onClose={() => setOpen(false)}><MobileSettingsContent {...props} onDismiss={() => setOpen(false)} /></MobileSettingsSheet>}
  </div>;
}

export function MobileSettingsContent({ theme, onChangeTheme, layout, onChangeLayout, onOpenOpml, library, markReadOnScroll, onChangeMarkReadOnScroll, autoRefreshMinutes, onChangeAutoRefreshMinutes, accountId, onManageArticleBlocks, onDismiss }: MobileSettingsProps & { library?: boolean; onDismiss?: () => void }) {
  const close = () => onDismiss?.();
  const themeOptions = useThemeOptions();
  return <div className="feedex-mobile-settings-panel">
      <SettingGroup title={t('보기', 'View')}>
        <SettingRow label={t('화면 모드', 'Appearance')} icon={SunMoon}><div className="feedex-segmented" role="group" aria-label={t('화면 모드', 'Appearance')}>{themeOptions.map(({ value, label, Icon }) => <button key={value} aria-label={label} title={label} aria-pressed={theme === value} onClick={() => onChangeTheme(value)}><Icon size={17} /></button>)}</div></SettingRow>
        <LanguageSetting />
        <TextSizeSetting />
        {!library && <LayoutSetting layout={layout} onChangeLayout={(value) => { onChangeLayout(value); close(); }} />}
      </SettingGroup>
      <SettingGroup title={t('읽기', 'Reading')}>{!library && <ScrollReadSetting markReadOnScroll={markReadOnScroll} onChangeMarkReadOnScroll={onChangeMarkReadOnScroll} />}<AutoRefreshSetting autoRefreshMinutes={autoRefreshMinutes} onChangeAutoRefreshMinutes={onChangeAutoRefreshMinutes} />{accountId && <LocalNotificationSetting accountId={accountId} />}</SettingGroup>
      {accountId && onManageArticleBlocks && <SettingGroup title={t('계정', 'Account')}><ArticleBlockSetting accountId={accountId} onManage={() => { close(); onManageArticleBlocks(); }} /></SettingGroup>}
      {accountId && <><SettingGroup title={t('번역·요약', 'Translation & summary')}><TranslationSetting key={accountId} /></SettingGroup><SettingGroup title={t('관리', 'Admin')}><XMirrorStatus /></SettingGroup></>}
      {accountId && <SettingGroup title={t('이 기기', 'This device')}><CacheSettings accountId={accountId} active /></SettingGroup>}
      <SettingGroup title={t('기타', 'More')}>
        <button type="button" className="feedex-setting-action" onClick={() => { close(); onOpenOpml(); }}><FileCode2 size={18} aria-hidden="true" /><span>{t('OPML 가져오기 / 내보내기', 'Import / export OPML')}</span><ChevronRight size={16} aria-hidden="true" /></button>
        <InstallAppButton row />
      </SettingGroup>
    </div>;
}

// 글 정렬은 설정 메뉴에 숨기지 않고 설정 버튼 왼쪽에 둔다. 누를 때마다 최신순과 오래된순을 바꾼다.
export function MobileHeader({ title, library, hidden, search, onSearch, onCommitSearch, onBack, onAdd, sort, onChangeSort, syncStatus, ...settings }: MobileSettingsProps & { title: string; library?: boolean; hidden?: boolean; search: string; onSearch: (value: string) => void; onCommitSearch?: (value?: string) => void; onBack?: () => void; onAdd: () => void }) {
  return <header className="feedex-mobile-header" data-scroll-hidden={hidden || undefined} inert={hidden || undefined} aria-hidden={hidden || undefined}>
    <div className="feedex-mobile-heading">
      {library ? <FeedExIcon className="feedex-mobile-brand-icon" /> : <button className="feedex-mobile-icon" onClick={onBack} aria-label={t('내 피드로 돌아가기', 'Back to my feeds')}><ArrowLeft size={20} /></button>}
      {/* 보관함 머리에는 이름 대신 글자 로고를 쓴다. */}
      <h1>{library ? <FeedExWordmark height={19} title={title} /> : title}</h1>
      <div className="feedex-mobile-header-actions">{!library && sort && onChangeSort && <button type="button" className="feedex-mobile-sort" onClick={() => onChangeSort(sort === 'oldest' ? 'newest' : 'oldest')} aria-label={sort === 'oldest' ? t('정렬: 오래된순, 최신순으로 전환', 'Sort: oldest first, switch to newest first') : t('정렬: 최신순, 오래된순으로 전환', 'Sort: newest first, switch to oldest first')}><ArrowDownUp size={14} aria-hidden="true" /><span>{sort === 'oldest' ? t('오래된순', 'Oldest') : t('최신순', 'Newest')}</span></button>}<MobileSettings library={library} {...settings} /><button className="feedex-mobile-icon" onClick={onAdd} aria-label={t('피드 추가', 'Add feed')}><Plus size={21} /></button></div>
    </div>
    <label className="feedex-mobile-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label={library ? t('폴더 및 피드 검색', 'Search folders and feeds') : t('글 검색', 'Search articles')} placeholder={library ? t('폴더 또는 피드 검색', 'Search folders or feeds') : t('글 검색', 'Search articles')} value={search} onChange={(event) => onSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onCommitSearch?.(search); }} autoComplete="off" />{search && <button aria-label={t('검색어 지우기', 'Clear search')} onClick={() => { onSearch(''); onCommitSearch?.(''); }}><X size={16} /></button>}</label>
    {syncStatus && <SyncStatusNotice status={syncStatus} />}
  </header>;
}

export function MobileDock({ active, onSelect, onRefresh, refreshing, syncing = false, onMarkAllRead, library, onAdd, hidden }: { /** 보관함에서는 null이다. 보관함은 목록이 아니기 때문이다. */ active: LibraryTab | null; onSelect: (tab: LibraryTab) => void; onRefresh: () => void; refreshing: boolean; /** 백그라운드 동기화. 아이콘은 돌지만 전체 새로고침을 막지는 않는다. */ syncing?: boolean; onMarkAllRead: () => void; library?: boolean; onAdd: () => void; hidden?: boolean }) {
  return <nav aria-label={t('모바일 글 탐색', 'Article navigation')} className="feedex-mobile-dock lg:hidden" data-scroll-hidden={hidden || undefined} inert={hidden || undefined} aria-hidden={hidden || undefined}>
    <button aria-label={t('피드 새로고침', 'Refresh feeds')} aria-busy={refreshing || syncing || undefined} onClick={onRefresh}><RefreshIcon size={19} spinning={refreshing || syncing} /></button>
    <div className="feedex-mobile-dock-tabs">{([{ id: 'all', label: t('전체', 'All'), Icon: Archive }, { id: 'unread', label: t('안 읽음', 'Unread'), Icon: null }, { id: 'saved', label: t('저장', 'Saved'), Icon: Bookmark }] as const).map(({ id, label, Icon }) => <button key={id} aria-label={label} aria-pressed={active === id} onClick={() => onSelect(id)}>{Icon ? <Icon size={19} /> : <span className="feedex-unread-dot" />}<span>{label}</span></button>)}</div>
    <button aria-label={library ? t('피드 추가', 'Add feed') : t('모두 읽음', 'Mark all as read')} onClick={library ? onAdd : onMarkAllRead}>{library ? <Plus size={20} /> : <CheckCheck size={20} />}</button>
  </nav>;
}
