import { useRef, useState } from 'react';
import { Archive, ChevronDown, ChevronRight, Folder, FolderPlus, LogOut, Pause, Play, Rss, Trash2 } from 'lucide-react';
import type { BootstrapResponse, FolderItem, SubscriptionItem, UserProfile } from '../client/api';
import { MobileHeader, MobileDock, type LibraryTab, type MobileSettingsProps } from './MobileChrome';
import { InstallCard } from './PwaInstall';
import { useScrollChrome } from '../client/mobile';
import { xFolderIds } from '../client/xTimeline';
import { isXProfileFeed } from '../shared/xFeed';
import { XLogo } from './XTimeline';

export function MobileLibrary({ user, folders, subscriptions, counts, countTab, visible = true, onChangeCountTab, onSelectTab, onSelectFolder, onSelectFeed, onAdd, onRefresh, refreshing, syncing, onCreateFolder, onDeleteFolder, onUnsubscribe, onToggleUpdates, onLogout, ...settings }: MobileSettingsProps & {
  user: UserProfile; folders: FolderItem[]; subscriptions: SubscriptionItem[]; counts: BootstrapResponse['counts'];
  /** 폴더와 피드마다 보여 줄 개수. 하단 탭이 그 자리에서 바꾼다. */
  countTab: LibraryTab; onChangeCountTab: (tab: LibraryTab) => void;
  visible?: boolean;
  onSelectTab: (tab: LibraryTab) => void; onSelectFolder: (id: string) => void; onSelectFeed: (id: string) => void; onAdd: () => void; onRefresh: () => void; refreshing: boolean; syncing?: boolean; onCreateFolder: (name: string) => Promise<void>;
  /** 둘 다 무언가를 지우기 전에 확인을 받는다. */
  onDeleteFolder: (id: string) => void; onUnsubscribe: (subscriptionId: string, title: string) => void; onToggleUpdates: (feed: SubscriptionItem) => void; onLogout: () => void;
}) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  // 터치 화면에는 마우스 올리기가 없으므로, 피드·폴더 지우기는 편집 모드에 둔다.
  const [editing, setEditing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chromeHidden = useScrollChrome(scrollRef, visible && !editing && newFolder === null, `${query}:${countTab}`);
  const total = countTab === 'saved' ? counts.savedCount : countTab === 'unread' ? counts.totalUnread : counts.totalArticles;
  const matches = (value: string) => value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const count = (feed: SubscriptionItem) => countTab === 'saved' ? feed.saved_count : countTab === 'unread' ? feed.unread_count : feed.total_count;
  const visibleSubscriptions = countTab === 'unread' ? subscriptions.filter((feed) => feed.unread_count > 0) : subscriptions;
  const visibleFolders = countTab === 'unread' ? folders.filter((folder) => visibleSubscriptions.some((feed) => feed.folder_id === folder.id)) : folders;
  const deleteButton = (label: string, onDelete: () => void) => <button type="button" className="feedex-mobile-delete" aria-label={label} onClick={onDelete}><Trash2 size={17} /></button>;
  // 편집 모드에서는 구독을 끊지 않고 피드의 새 글을 멈추거나 다시 받을 수도 있다.
  const updatesButton = (feed: SubscriptionItem) => <button type="button" className="feedex-mobile-updates" aria-label={`${feed.title} ${feed.paused_at ? '업데이트 다시 받기' : '업데이트 중지'}`} onClick={() => onToggleUpdates(feed)}>{feed.paused_at ? <Play size={17} /> : <Pause size={17} />}</button>;
  const feedRow = (feed: SubscriptionItem) => <div className="feedex-mobile-row-wrap" key={feed.id} data-feed-id={feed.feed_id}><button className="feedex-mobile-library-row feedex-mobile-feed-row" data-paused={feed.paused_at ? true : undefined} onClick={() => onSelectFeed(feed.feed_id)}>{feed.favicon_url ? <img src={feed.favicon_url} alt="" data-x-avatar={isXProfileFeed(feed.xml_url) || undefined} /> : <Rss size={20} />}<span>{feed.title}</span>{feed.paused_at && <Pause size={14} role="img" aria-label="업데이트 중지됨" className="feedex-mobile-paused" />}<span className="feedex-mobile-count">{count(feed).toLocaleString()}</span>{!editing && <ChevronRight size={17} />}</button>{editing && updatesButton(feed)}{editing && deleteButton(`${feed.title} 구독 취소`, () => onUnsubscribe(feed.id, feed.title))}</div>;
  const ungrouped = visibleSubscriptions.filter((feed) => !feed.folder_id || !folders.some((folder) => folder.id === feed.folder_id));
  // 안의 피드가 모두 X 계정인 폴더는 일반 폴더와 떼어 X 구역에 둔다.
  const xFolders = xFolderIds(folders, subscriptions);
  const shownFolders = visibleFolders.filter((folder) => matches(folder.name) || visibleSubscriptions.some((feed) => feed.folder_id === folder.id && matches(feed.title)));
  const xShown = shownFolders.filter((folder) => xFolders.has(folder.id));
  const folderRow = (folder: FolderItem) => { const feeds = visibleSubscriptions.filter((feed) => feed.folder_id === folder.id); return <div key={folder.id} data-folder-id={folder.id}><div className="feedex-mobile-folder-row"><button className="feedex-mobile-library-row" onClick={() => onSelectFolder(folder.id)}>{xFolders.has(folder.id) ? <XLogo className="feedex-mobile-x-logo" /> : <Folder size={21} />}<span>{folder.name}</span><span className="feedex-mobile-count">{feeds.reduce((sum, feed) => sum + count(feed), 0).toLocaleString()}</span></button>{editing ? deleteButton(`${folder.name} 폴더 삭제`, () => onDeleteFolder(folder.id)) : <button className="feedex-mobile-expand" aria-label={`${folder.name} 피드 ${expanded[folder.id] ? '접기' : '펼치기'}`} aria-expanded={Boolean(expanded[folder.id])} onClick={() => setExpanded((value) => ({ ...value, [folder.id]: !value[folder.id] }))}><ChevronDown size={18} className={expanded[folder.id] ? 'rotate-180' : ''} /></button>}</div>{(expanded[folder.id] || query.trim() || editing) && <div className="feedex-mobile-folder-feeds">{feeds.filter((feed) => matches(feed.title) || matches(folder.name)).map(feedRow)}{feeds.length === 0 && <p className="feedex-mobile-empty">이 폴더에 구독한 피드가 없습니다.</p>}</div>}</div>; };
  return <section className="feedex-mobile-library lg:hidden" aria-label="내 피드">
    <MobileHeader library hidden={chromeHidden} title="FeedEx" search={query} onSearch={setQuery} onAdd={onAdd} {...settings} />
    <div ref={scrollRef} className="feedex-mobile-library-scroll">
      {!query.trim() && <InstallCard />}
      {!query.trim() && <><h2 className="feedex-mobile-section-title">라이브러리</h2><div className="feedex-mobile-library-group"><button className="feedex-mobile-library-row" onClick={() => onSelectTab(countTab)}><Archive size={21} /><span>전체 글</span><span className="feedex-mobile-count">{total.toLocaleString()}</span><ChevronRight size={17} /></button></div></>}
      {xShown.length > 0 && <><h2 className="feedex-mobile-section-title feedex-mobile-x-title"><XLogo className="feedex-mobile-x-logo" />X 계정</h2><div className="feedex-mobile-library-group">{xShown.map(folderRow)}</div></>}
      <div className="feedex-mobile-section-title"><h2>{query.trim() ? '검색 결과' : '폴더'}</h2><span className="feedex-mobile-section-actions">{(folders.length > 0 || subscriptions.length > 0) && <button className="feedex-mobile-edit" aria-pressed={editing} onClick={() => setEditing((value) => !value)}>{editing ? '완료' : '편집'}</button>}<button aria-label="폴더 추가" onClick={() => setNewFolder('')}><FolderPlus size={18} /></button></span></div>
      {newFolder !== null && <form className="feedex-mobile-new-folder" onSubmit={async (event) => { event.preventDefault(); if (!newFolder.trim() || creating) return; setCreating(true); setError(''); try { await onCreateFolder(newFolder.trim()); setNewFolder(null); } catch { setError('폴더를 만들지 못했습니다. 다시 시도해 주세요.'); } finally { setCreating(false); } }}><input aria-label="새 폴더 이름" placeholder="새 폴더 이름" value={newFolder} onChange={(event) => setNewFolder(event.target.value)} autoFocus /><button disabled={creating || !newFolder.trim()}>추가</button><button type="button" disabled={creating} onClick={() => setNewFolder(null)}>취소</button>{error && <p role="alert">{error}</p>}</form>}
      <div className="feedex-mobile-library-group">{shownFolders.filter((folder) => !xFolders.has(folder.id)).map(folderRow)}</div>
      {ungrouped.length > 0 && <><h2 className="feedex-mobile-section-title">미분류 피드</h2><div className="feedex-mobile-library-group">{ungrouped.filter((feed) => matches(feed.title)).map(feedRow)}</div></>}
      {query.trim() && !subscriptions.some((feed) => matches(feed.title)) && !folders.some((folder) => matches(folder.name)) && <p className="feedex-mobile-empty">일치하는 폴더나 피드가 없습니다.</p>}
      {!subscriptions.length && <div className="feedex-mobile-empty"><Rss size={28} /><p>관심 있는 피드를 추가해 보세요.</p><button onClick={onAdd}>피드 찾아보기</button></div>}
      <div className="feedex-mobile-account"><span><strong>{user.name}</strong><small>{user.email}</small></span><button className="feedex-mobile-icon" aria-label="로그아웃 / 계정 전환" onClick={onLogout}><LogOut size={20} /></button></div>
    </div>
    <MobileDock library hidden={chromeHidden} active={countTab} onSelect={onChangeCountTab} onRefresh={onRefresh} refreshing={refreshing} syncing={syncing} onAdd={onAdd} onMarkAllRead={() => {}} />
  </section>;
}
