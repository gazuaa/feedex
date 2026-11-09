import React from 'react';
import {
  Search,
  CheckCheck,
  ArrowDownUp,
  Menu,
  X,
} from 'lucide-react';
import type { LayoutMode, ThemeMode } from '../client/api';
import { InstallAppButton } from './PwaInstall';
import { ThemeSwitch } from './ThemeSwitch';
import { RefreshIcon } from './RefreshIcon';
import { DesktopReadingSettings, type DesktopSettingsProps } from './ReadingSettings';

interface HeaderBarProps extends DesktopSettingsProps {
  sort: 'newest' | 'oldest';
  onToggleSort: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onCommitSearch?: (q?: string) => void;
  layout: LayoutMode;
  onChangeLayout: (layout: LayoutMode) => void;
  theme: ThemeMode;
  onChangeTheme: (theme: ThemeMode) => void;
  onRefresh: () => void;
  refreshing: boolean;
  /** 백그라운드 동기화 중에는 아이콘이 돌지만 버튼은 계속 누를 수 있다. */
  syncing?: boolean;
  onMarkAllRead: () => void;
  onOpenMobileSidebar: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  sort,
  onToggleSort,
  accountId,
  onManageArticleBlocks,
  searchQuery,
  onSearchChange,
  onCommitSearch,
  layout,
  onChangeLayout,
  theme,
  onChangeTheme,
  onRefresh,
  refreshing,
  syncing = false,
  onMarkAllRead,
  onOpenMobileSidebar,
  markReadOnScroll,
  onChangeMarkReadOnScroll,
  autoRefreshMinutes,
  onChangeAutoRefreshMinutes,
}) => {
  const isDark = theme === 'dark';

  return (
    <header
      className={`feedex-header shrink-0 z-30 border-b backdrop-blur-md py-3.5 transition-colors ${
        isDark
          ? 'bg-slate-950/85 border-slate-800/80 text-slate-100'
          : 'bg-white/90 border-slate-200 text-slate-900'
      }`}
    >
      <div className="feedex-header-sections">
        <div className="feedex-list-controls flex min-w-0 items-center gap-2 px-4">
        {/* 모바일 메뉴 */}
        <button
          type="button"
          aria-label="피드 채널 열기"
          onClick={onOpenMobileSidebar}
          className={`lg:hidden shrink-0 p-2 rounded-lg border cursor-pointer ${
            isDark
              ? 'border-slate-800 text-slate-300 hover:bg-slate-900'
              : 'border-slate-200 text-slate-700 hover:bg-slate-100'
          }`}
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* 검색, 정렬, 읽음 처리 조절기는 목록 영역을 따라간다. */}
        <div className="flex flex-1 min-w-0 items-center gap-2">
          {/* 키워드 검색 입력창 */}
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onCommitSearch?.(searchQuery); }}
              placeholder="키워드 검색 (제목, 요약, 피드, 작성자)..."
              className={`w-full pl-9 pr-7 py-1.5 rounded-xl text-xs border transition focus:outline-none focus:border-emerald-500 ${
                isDark
                  ? 'bg-slate-900 border-slate-800 text-slate-100 placeholder-slate-500'
                  : 'bg-slate-100 border-slate-200 text-slate-900 placeholder-slate-400'
              }`}
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="검색어 지우기"
                onClick={() => { onSearchChange(''); onCommitSearch?.(''); }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button type="button" onClick={onToggleSort} aria-label={`정렬: ${sort === 'oldest' ? '오래된순, 최신순으로 전환' : '최신순, 오래된순으로 전환'}`} title="클릭하여 최신순 / 오래된순 전환" className="feedex-sort-button"><ArrowDownUp size={16} /><span>{sort === 'oldest' ? '오래된순' : '최신순'}</span></button>

          {/* 모두 읽음 */}
          <button
            type="button"
            onClick={onMarkAllRead}
            title="현재 목록 모두 읽음 처리 (단축키: A, 선택한 글 위·아래만: Q·W)"
            aria-label="모두 읽음"
            className={`shrink-0 p-2 rounded-xl border flex items-center transition cursor-pointer ${
              isDark
                ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <CheckCheck className="w-4 h-4 text-emerald-400" />
          </button>

        </div>
        </div>
          <div aria-hidden="true" className="feedex-header-divider" />
          <div className="feedex-global-controls flex shrink-0 items-center justify-end gap-2 px-4">
            <DesktopReadingSettings accountId={accountId} onManageArticleBlocks={onManageArticleBlocks} layout={layout} onChangeLayout={onChangeLayout} markReadOnScroll={markReadOnScroll} onChangeMarkReadOnScroll={onChangeMarkReadOnScroll} autoRefreshMinutes={autoRefreshMinutes} onChangeAutoRefreshMinutes={onChangeAutoRefreshMinutes} />
            <InstallAppButton />
            {/* 피드 새로고침 */}
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              title="피드 새로고침 (단축키: R)"
              className={`p-2 rounded-xl border transition cursor-pointer ${
                isDark
                  ? 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                  : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <RefreshIcon
                spinning={refreshing || syncing}
                className="w-4 h-4 data-[spinning]:text-emerald-400"
              />
            </button>

            <ThemeSwitch theme={theme} onChange={onChangeTheme} />
          </div>
      </div>
    </header>
  );
};
