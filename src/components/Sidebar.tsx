import React, { useEffect, useState } from 'react';
import { collapsedFoldersKey, readCollapsedFolders, writeCollapsedFolders } from '../client/folderState';
import {
  Rss,
  Archive,
  Bookmark,
  Plus,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Trash2,
  Pause,
  Play,
  FolderPlus,
  FileCode2,
  LogOut,
  Compass,
  X,
} from 'lucide-react';
import { xFolderIds } from '../client/xTimeline';
import { isXProfileFeed } from '../shared/xFeed';
import { XLogo } from './XTimeline';
import type {
  FolderItem,
  SubscriptionItem,
  ScopeType,
  UserProfile,
  BootstrapResponse,
} from '../client/api';

interface SidebarProps {
  user: UserProfile;
  folders: FolderItem[];
  subscriptions: SubscriptionItem[];
  counts: BootstrapResponse['counts'];
  unreadOnly: boolean;
  libraryTab?: 'all' | 'unread' | 'saved';
  activeScope: ScopeType;
  activeFolderId: string | null;
  activeFeedId: string | null;
  onSelectScope: (
    scope: ScopeType,
    folderId?: string | null,
    feedId?: string | null
  ) => void;
  onSelectLibraryTab: (tab: 'all' | 'unread' | 'saved') => void;
  onOpenDiscover: (initialTab?: 'curated' | 'opml') => void;
  onCreateFolder: (name: string) => Promise<void>;
  onDeleteFolder: (folderId: string) => Promise<void>;
  onUnsubscribe: (subscriptionId: string, title: string) => Promise<void>;
  /** 구독을 끊지 않고 피드의 새 글을 멈추거나 다시 받는다. */
  onToggleUpdates: (feed: SubscriptionItem) => void;
  onLogout: () => void;
  isDark: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  user,
  folders,
  subscriptions,
  counts,
  unreadOnly,
  libraryTab = unreadOnly ? 'unread' : 'all',
  activeScope,
  activeFolderId,
  activeFeedId,
  onSelectScope,
  onSelectLibraryTab,
  onOpenDiscover,
  onCreateFolder,
  onDeleteFolder,
  onUnsubscribe,
  onToggleUpdates,
  onLogout,
  isDark,
  mobileOpen,
  onCloseMobile,
}) => {
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>(() => readCollapsedFolders(user.id));
  useEffect(() => {
    setCollapsedFolders(readCollapsedFolders(user.id));
    const changed = (event: StorageEvent) => { if (event.key === collapsedFoldersKey(user.id) || event.key === null) setCollapsedFolders(readCollapsedFolders(user.id)); };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [user.id]);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const toggleFolderCollapse = (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = { ...collapsedFolders, [folderId]: !collapsedFolders[folderId] };
    setCollapsedFolders(next);
    writeCollapsedFolders(user.id, next);
  };

  const handleCreateFolderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    await onCreateFolder(newFolderName.trim());
    setNewFolderName('');
    setCreatingFolder(false);
  };

  const visibleSubscriptions = libraryTab === 'unread' ? subscriptions.filter((sub) => sub.unread_count > 0) : subscriptions;
  const visibleFolders = libraryTab === 'unread' ? folders.filter((folder) => visibleSubscriptions.some((sub) => sub.folder_id === folder.id)) : folders;
  const uncategorizedSubs = visibleSubscriptions.filter(
    (s) => !s.folder_id || !folders.some((f) => f.id === s.folder_id)
  );
  const getFeedCount = (sub: SubscriptionItem) => libraryTab === 'saved' ? sub.saved_count : libraryTab === 'unread' ? sub.unread_count : sub.total_count;
  const libraryCount = libraryTab === 'saved' ? counts.savedCount : libraryTab === 'unread' ? counts.totalUnread : counts.totalArticles;
  const isAllArticlesActive = activeScope === 'all' || activeScope === 'saved';
  // 안의 피드가 모두 X 계정인 폴더는 일반 폴더와 떼어 X 구역에 둔다.
  const xFolders = xFolderIds(folders, subscriptions);
  const regularFolders = visibleFolders.filter((folder) => !xFolders.has(folder.id));
  const xVisibleFolders = visibleFolders.filter((folder) => xFolders.has(folder.id));

  // 폴더 한 칸과 그 안의 피드. 일반 폴더와 X 폴더가 함께 쓴다.
  const folderBlock = (folder: FolderItem) => {
    const folderSubs = visibleSubscriptions.filter(
      (s) => s.folder_id === folder.id
    );
    const folderCount = folderSubs.reduce(
      (sum, s) => sum + getFeedCount(s),
      0
    );
    const isCollapsed = Boolean(collapsedFolders[folder.id]);
    const isFolderActive =
      activeScope === 'folder' && activeFolderId === folder.id;

    return (
      <div key={folder.id} data-folder-id={folder.id} className="space-y-0.5">
        <div
          onClick={() => {
            onSelectScope('folder', folder.id, null);
            onCloseMobile();
          }}
          className={`group flex items-center justify-between px-2.5 py-1.5 rounded-xl text-sm transition cursor-pointer ${
            isFolderActive
              ? 'bg-emerald-500/15 text-emerald-400 font-semibold'
              : isDark
              ? 'text-slate-300 hover:bg-slate-800/70'
              : 'text-slate-700 hover:bg-slate-200/70'
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              onClick={(e) => toggleFolderCollapse(folder.id, e)}
              aria-label={`${folder.name} ${isCollapsed ? '펼치기' : '접기'}`}
              aria-expanded={!isCollapsed}
              className="p-0.5 rounded hover:bg-slate-700/40 text-slate-400 cursor-pointer"
            >
              {isCollapsed ? (
                <ChevronRight className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
            {xFolders.has(folder.id) ? (
              <XLogo className={`w-3.5 h-3.5 shrink-0 ${isDark ? 'text-white' : 'text-slate-900'}`} />
            ) : isCollapsed ? (
              <Folder className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <FolderOpen className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <span className="truncate">{folder.name}</span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {folderCount > 0 && (
              <span className="text-[11px] text-slate-400 font-medium">
                {folderCount}
              </span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteFolder(folder.id);
              }}
              title="폴더 삭제"
              className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-500 hover:text-rose-400 transition cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {!isCollapsed && (
          <div className="pl-5 space-y-0.5">
            {folderSubs.length === 0 ? (
              <div className="px-3 py-1 text-[11px] text-slate-500">
                비어 있는 폴더
              </div>
            ) : (
              folderSubs.map((sub) => {
                const isFeedActive =
                  activeScope === 'feed' && activeFeedId === sub.feed_id;
                return (
                  <div
                    key={sub.id}
                    data-feed-id={sub.feed_id}
                    onClick={() => {
                      onSelectScope('feed', null, sub.feed_id);
                      onCloseMobile();
                    }}
                    className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition cursor-pointer ${
                      isFeedActive
                        ? 'bg-emerald-500/15 text-emerald-400 font-semibold'
                        : isDark
                        ? 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                        : 'text-slate-600 hover:bg-slate-200/60 hover:text-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {sub.favicon_url ? (
                        <img
                          src={sub.favicon_url}
                          alt=""
                          className={`w-3.5 h-3.5 shrink-0 ${isXProfileFeed(sub.xml_url) ? 'rounded-full' : 'rounded-sm'}`}
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display =
                              'none';
                          }}
                        />
                      ) : (
                        <Rss className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      )}
                      <span className={`truncate ${sub.paused_at ? 'opacity-60' : ''}`}>{sub.title}</span>
                      {sub.paused_at && <Pause role="img" aria-label="업데이트 중지됨" className="w-3 h-3 shrink-0 text-slate-500" />}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {getFeedCount(sub) > 0 && (
                        <span className="text-[11px] text-slate-500">
                          {getFeedCount(sub)}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleUpdates(sub);
                        }}
                        title={sub.paused_at ? '업데이트 다시 받기' : '업데이트 중지'}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-500 hover:text-emerald-400 transition cursor-pointer"
                      >
                        {sub.paused_at ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onUnsubscribe(sub.id, sub.title);
                        }}
                        title="구독 취소"
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-500 hover:text-rose-400 transition cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      <aside
        id="feed-channel-pane"
        aria-label="피드 채널"
        className={`sfeed-sidebar fixed lg:static inset-y-0 left-0 z-50 w-72 min-h-0 shrink-0 flex flex-col overflow-hidden border-r lg:border-r-0 transition-transform duration-200 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } ${
          isDark
            ? 'bg-slate-900/95 border-slate-800/80 text-slate-200'
            : 'bg-slate-50 border-slate-200 text-slate-800'
        }`}
      >
        {/* 위쪽 로고와 피드 추가 버튼 */}
        <div className="p-4 shrink-0 flex items-center justify-between">
          <div
            onClick={() => {
              onSelectScope('all', null, null);
              onCloseMobile();
            }}
            className="flex items-center gap-2.5 cursor-pointer"
          >
            <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center shadow-sm shadow-emerald-500/30">
              <Rss className="w-4 h-4 text-slate-950 stroke-[2.5]" />
            </div>
            <span
              className={`text-lg font-bold tracking-tight ${
                isDark ? 'text-white' : 'text-slate-900'
              }`}
            >
              SFeed
            </span>
          </div>

          <button
            type="button"
            aria-label="피드 채널 닫기"
            onClick={onCloseMobile}
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-3 mb-3 shrink-0">
          <button
            type="button"
            onClick={() => {
              onOpenDiscover('curated');
              onCloseMobile();
            }}
            className="w-full py-2.5 px-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 shadow-sm shadow-emerald-500/20 transition cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>피드 추가 · 추천 탐색</span>
          </button>
        </div>

        <nav aria-label="글 보기" className={`mx-3 mb-4 grid grid-cols-3 shrink-0 gap-1 rounded-xl border p-1 ${isDark ? 'bg-slate-950/50 border-slate-800' : 'bg-slate-100 border-slate-200'}`}>
          {([
            { id: 'all', label: '전체', icon: Archive, count: counts.totalArticles },
            { id: 'unread', label: '안 읽음', icon: null, count: counts.totalUnread },
            { id: 'saved', label: '저장', icon: Bookmark, count: counts.savedCount },
          ] as const).map((tab) => {
            const selected = libraryTab === tab.id;
            const Icon = tab.icon;
            return <button key={tab.id} type="button" aria-pressed={selected} onClick={() => { onSelectLibraryTab(tab.id); }} className={`min-w-0 flex flex-col items-center gap-1 rounded-lg py-2 text-xs font-semibold transition cursor-pointer ${selected ? isDark ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white text-emerald-700 shadow-sm' : isDark ? 'text-slate-400 hover:bg-slate-800 hover:text-white' : 'text-slate-600 hover:bg-white hover:text-slate-950'}`}><span className="inline-flex items-center gap-1">{Icon ? <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <span aria-hidden="true" className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center"><span className="h-2 w-2 rounded-full bg-current" /></span>}<span>{tab.label}</span></span></button>;
          })}
        </nav>

        <div className="mx-3 mb-4">
          <button
            type="button"
            aria-current={isAllArticlesActive ? 'page' : undefined}
            onClick={() => { onSelectScope('all', null, null); onCloseMobile(); }}
            className={`sfeed-desktop-all-articles flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition cursor-pointer ${isAllArticlesActive ? 'border-transparent bg-emerald-500/15 text-emerald-400 font-semibold' : isDark ? 'border-slate-800 hover:bg-slate-800' : 'border-slate-200 hover:bg-white'}`}
          ><Archive size={17} className={isAllArticlesActive ? 'text-emerald-400' : 'text-emerald-500'} /><span>전체 글</span><span className="ml-auto text-xs text-slate-400">{libraryCount.toLocaleString('ko-KR')}</span><ChevronRight size={15} /></button>
        </div>

        {/* 스크롤되는 내비게이션 트리 */}
        <div aria-label="구독 피드 채널" role="navigation" tabIndex={0} className="sfeed-channel-list flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 space-y-5 pb-4">
          {/* X 구역: X 계정만 담은 폴더 */}
          {xVisibleFolders.length > 0 && (
            <section aria-label="X 계정">
              <div className="flex items-center gap-1.5 px-2 mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                <XLogo className="w-3 h-3" />
                <span>X 계정 ({subscriptions.filter((sub) => sub.folder_id && xFolders.has(sub.folder_id)).length})</span>
              </div>
              <div className="space-y-1.5">{xVisibleFolders.map(folderBlock)}</div>
            </section>
          )}

          {/* 폴더와 피드 영역 */}
          <div>
            <div className="flex items-center justify-between px-2 mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                피드 및 폴더 ({subscriptions.length})
              </span>
              <button
                type="button"
                onClick={() => setCreatingFolder((v) => !v)}
                title="새 폴더 만들기"
                className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                <span>폴더 추가</span>
              </button>
            </div>

            {creatingFolder && (
              <form onSubmit={handleCreateFolderSubmit} className="mb-2.5 px-1">
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    placeholder="새 폴더 이름..."
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    autoFocus
                    className={`flex-1 px-2.5 py-1.5 rounded-lg text-xs border focus:outline-none focus:border-emerald-500 ${
                      isDark
                        ? 'bg-slate-950 border-slate-700 text-white'
                        : 'bg-white border-slate-300 text-slate-900'
                    }`}
                  />
                  <button
                    type="submit"
                    className="px-2.5 py-1.5 rounded-lg bg-emerald-500 text-slate-950 text-xs font-semibold cursor-pointer"
                  >
                    생성
                  </button>
                </div>
              </form>
            )}

            <div className="space-y-1.5">
              {regularFolders.map(folderBlock)}

              {/* 미분류 구독 */}
              {uncategorizedSubs.length > 0 && (
                <div className="pt-1 space-y-0.5">
                  <div className="px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                    미분류 피드
                  </div>
                  {uncategorizedSubs.map((sub) => {
                    const isFeedActive =
                      activeScope === 'feed' && activeFeedId === sub.feed_id;
                    return (
                      <div
                        key={sub.id}
                                data-feed-id={sub.feed_id}
                        onClick={() => {
                          onSelectScope('feed', null, sub.feed_id);
                          onCloseMobile();
                        }}
                        className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition cursor-pointer ${
                          isFeedActive
                            ? 'bg-emerald-500/15 text-emerald-400 font-semibold'
                            : isDark
                            ? 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                            : 'text-slate-600 hover:bg-slate-200/60 hover:text-slate-900'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {sub.favicon_url ? (
                            <img
                              src={sub.favicon_url}
                              alt=""
                              className={`w-3.5 h-3.5 shrink-0 ${isXProfileFeed(sub.xml_url) ? 'rounded-full' : 'rounded-sm'}`}
                            />
                          ) : (
                            <Rss className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          )}
                          <span className={`truncate ${sub.paused_at ? 'opacity-60' : ''}`}>{sub.title}</span>
                          {sub.paused_at && <Pause role="img" aria-label="업데이트 중지됨" className="w-3 h-3 shrink-0 text-slate-500" />}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {getFeedCount(sub) > 0 && (
                            <span className="text-[11px] text-slate-500">
                              {getFeedCount(sub)}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleUpdates(sub);
                            }}
                            title={sub.paused_at ? '업데이트 다시 받기' : '업데이트 중지'}
                            className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-500 hover:text-emerald-400 transition cursor-pointer"
                          >
                            {sub.paused_at ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onUnsubscribe(sub.id, sub.title);
                            }}
                            title="구독 취소"
                            className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-500 hover:text-rose-400 transition cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 빠른 도구 영역 */}
          <div className="pt-2 border-t border-slate-800/40 space-y-1">
            <button
              type="button"
              onClick={() => {
                onOpenDiscover('curated');
                onCloseMobile();
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer ${
                isDark
                  ? 'text-slate-400 hover:bg-slate-800/70 hover:text-white'
                  : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
              }`}
            >
              <Compass className="w-4 h-4 text-emerald-400" />
              <span>추천 피드 카탈로그</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onOpenDiscover('opml');
                onCloseMobile();
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition cursor-pointer ${
                isDark
                  ? 'text-slate-400 hover:bg-slate-800/70 hover:text-white'
                  : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
              }`}
            >
              <FileCode2 className="w-4 h-4 text-blue-400" />
              <span>OPML 가져오기 / 내보내기</span>
            </button>
          </div>
        </div>

        {/* 사용자 바닥글 */}
        <div
          className={`sfeed-sidebar-footer p-3 shrink-0 border-t flex items-center justify-between gap-2 ${
            isDark ? 'border-slate-800/80 bg-slate-950/50' : 'border-slate-200 bg-slate-100/70'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src={
                user.picture ||
                `https://api.dicebear.com/9.x/glass/svg?seed=${encodeURIComponent(
                  user.email
                )}`
              }
              alt={user.name}
              className="w-8 h-8 rounded-full bg-slate-800 shrink-0"
            />
            <div className="min-w-0">
              <div
                className={`text-xs font-semibold truncate ${
                  isDark ? 'text-slate-100' : 'text-slate-900'
                }`}
              >
                {user.name}
              </div>
              <div className="text-[11px] text-slate-400 truncate">
                {user.email}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onLogout}
            title="로그아웃 / 계정 전환"
            className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800/40 transition cursor-pointer shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>
    </>
  );
};
