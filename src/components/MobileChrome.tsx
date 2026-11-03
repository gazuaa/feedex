import { useRef } from 'react';
import { Archive, ArrowDownUp, ArrowLeft, Bookmark, CheckCheck, LayoutGrid, LayoutList, AlignJustify, Plus, Rss, Search, Settings2, Sun, Moon, X, FileCode2 } from 'lucide-react';
import type { LayoutMode, ThemeMode } from '../client/api';
import { InstallAppButton } from './PwaInstall';
import { ScrollReadSetting, TextSizeSetting, LayoutSetting, AutoRefreshSetting, SettingGroup, SettingRow, type ScrollReadSettingsProps, type RefreshSettingsProps, type SortSettingProps } from './ReadingSettings';
import { LocalNotificationSetting } from './LocalNotificationSetting';
import { CacheSettings } from './CacheSettings';
import { RefreshIcon } from './RefreshIcon';
import { useOutsideDismiss } from '../client/outsideDismiss';

export type LibraryTab = 'all' | 'unread' | 'saved';
export interface MobileSettingsProps extends ScrollReadSettingsProps, RefreshSettingsProps, Partial<SortSettingProps> {
  accountId?: string;
  theme: ThemeMode;
  onChangeTheme: (theme: ThemeMode) => void;
  layout: LayoutMode;
  onChangeLayout: (layout: LayoutMode) => void;
  onOpenOpml: () => void;
}

export function MobileSettings({ theme, onChangeTheme, layout, onChangeLayout, onOpenOpml, library, markReadOnScroll, onChangeMarkReadOnScroll, autoRefreshMinutes, onChangeAutoRefreshMinutes, accountId }: MobileSettingsProps & { library?: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => { if (ref.current) ref.current.open = false; };
  useOutsideDismiss(ref);
  return <details ref={ref} className="sfeed-mobile-settings" onKeyDown={(event) => { if (event.key === 'Escape') { close(); ref.current?.querySelector('summary')?.focus(); } }}>
    <summary aria-label="보기 설정" className="sfeed-mobile-icon"><Settings2 size={21} /></summary>
    <div className="sfeed-mobile-settings-panel">
      <SettingGroup title="보기">
        <SettingRow label="화면"><div className="sfeed-segmented" role="group" aria-label="화면">{(['light', 'dark'] as const).map((value) => { const Icon = value === 'light' ? Sun : Moon; return <button key={value} aria-label={value === 'light' ? '낮 모드' : '밤 모드'} aria-pressed={theme === value} onClick={() => onChangeTheme(value)}><Icon size={17} /></button>; })}</div></SettingRow>
        <TextSizeSetting />
        {!library && <LayoutSetting layout={layout} onChangeLayout={(value) => { onChangeLayout(value); close(); }} />}
      </SettingGroup>
      {!library && <SettingGroup title="읽기"><ScrollReadSetting markReadOnScroll={markReadOnScroll} onChangeMarkReadOnScroll={onChangeMarkReadOnScroll} /></SettingGroup>}
      <SettingGroup title="새 글"><AutoRefreshSetting autoRefreshMinutes={autoRefreshMinutes} onChangeAutoRefreshMinutes={onChangeAutoRefreshMinutes} />{accountId && <LocalNotificationSetting accountId={accountId} />}</SettingGroup>
      {accountId && <SettingGroup title="이 기기"><CacheSettings accountId={accountId} /></SettingGroup>}
      <SettingGroup title="기타">
        <button type="button" onClick={() => { close(); onOpenOpml(); }}><FileCode2 size={17} />OPML 가져오기 / 내보내기</button>
        <InstallAppButton />
      </SettingGroup>
    </div>
  </details>;
}

// 글 정렬은 설정 메뉴에 숨기지 않고 설정 버튼 왼쪽에 둔다. 누를 때마다 최신순과 오래된순을 바꾼다.
export function MobileHeader({ title, library, hidden, search, onSearch, onBack, onAdd, sort, onChangeSort, ...settings }: MobileSettingsProps & { title: string; library?: boolean; hidden?: boolean; search: string; onSearch: (value: string) => void; onBack?: () => void; onAdd: () => void }) {
  return <header className="sfeed-mobile-header" data-scroll-hidden={hidden || undefined} inert={hidden || undefined} aria-hidden={hidden || undefined}>
    <div className="sfeed-mobile-heading">
      {library ? <span className="sfeed-mobile-brand-icon"><Rss size={21} strokeWidth={2.4} /></span> : <button className="sfeed-mobile-icon" onClick={onBack} aria-label="내 피드로 돌아가기"><ArrowLeft size={22} /></button>}
      <h1>{title}</h1>
      <div className="sfeed-mobile-header-actions">{!library && sort && onChangeSort && <button type="button" className="sfeed-mobile-sort" onClick={() => onChangeSort(sort === 'oldest' ? 'newest' : 'oldest')} aria-label={`정렬: ${sort === 'oldest' ? '오래된순, 최신순으로 전환' : '최신순, 오래된순으로 전환'}`}><ArrowDownUp size={15} aria-hidden="true" /><span>{sort === 'oldest' ? '오래된순' : '최신순'}</span></button>}<MobileSettings library={library} {...settings} /><button className="sfeed-mobile-icon" onClick={onAdd} aria-label="피드 추가"><Plus size={23} /></button></div>
    </div>
    <label className="sfeed-mobile-search"><Search size={18} aria-hidden="true" /><input type="search" aria-label={library ? '폴더 및 피드 검색' : '글 검색'} placeholder={library ? '폴더 또는 피드 검색' : '글 검색'} value={search} onChange={(event) => onSearch(event.target.value)} autoComplete="off" />{search && <button aria-label="검색어 지우기" onClick={() => onSearch('')}><X size={18} /></button>}</label>
  </header>;
}

export function MobileDock({ active, onSelect, onRefresh, refreshing, syncing = false, onMarkAllRead, library, onAdd, hidden }: { /** 보관함에서는 null이다. 보관함은 목록이 아니기 때문이다. */ active: LibraryTab | null; onSelect: (tab: LibraryTab) => void; onRefresh: () => void; refreshing: boolean; /** 백그라운드 동기화. 아이콘은 돌지만 전체 새로고침을 막지는 않는다. */ syncing?: boolean; onMarkAllRead: () => void; library?: boolean; onAdd: () => void; hidden?: boolean }) {
  return <nav aria-label="모바일 글 탐색" className="sfeed-mobile-dock lg:hidden" data-scroll-hidden={hidden || undefined} inert={hidden || undefined} aria-hidden={hidden || undefined}>
    <button aria-label="피드 새로고침" aria-busy={refreshing || syncing || undefined} onClick={onRefresh}><RefreshIcon size={21} spinning={refreshing || syncing} /></button>
    <div className="sfeed-mobile-dock-tabs">{([{ id: 'all', label: '전체', Icon: Archive }, { id: 'unread', label: '안 읽음', Icon: null }, { id: 'saved', label: '저장', Icon: Bookmark }] as const).map(({ id, label, Icon }) => <button key={id} aria-label={label} aria-pressed={active === id} onClick={() => onSelect(id)}>{Icon ? <Icon size={21} /> : <span className="sfeed-unread-dot" />}<span>{label}</span></button>)}</div>
    <button aria-label={library ? '피드 추가' : '모두 읽음'} onClick={library ? onAdd : onMarkAllRead}>{library ? <Plus size={23} /> : <CheckCheck size={22} />}</button>
  </nav>;
}
