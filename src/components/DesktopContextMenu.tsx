import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Archive, ArrowDownToLine, ArrowUpToLine, Bookmark, BookOpen, Share2, CheckCheck, CheckCircle2, Circle, Copy, ExternalLink, FolderInput, FolderOpen, FolderX, History, Languages, Link2, ListFilter, Newspaper, Pause, Pencil, Play, Plus, RefreshCw, Rss, UserRoundMinus, type LucideIcon } from 'lucide-react';
import { bindLongPress } from '../client/longPress';
import { t } from '../shared/i18n';
import { GrokLogo } from './GrokLogo';
import { ChatGptLogo } from './ChatGptLogo';

export interface AppContextTarget { articleId?: string; folderId?: string; feedId?: string; link?: string; selection?: string }
export interface AppContextAction { id: string; label: string; run: () => void | Promise<unknown>; danger?: boolean; separator?: boolean;
  /** 휴대폰 시트에서 제목 아래 아이콘 한 줄로 모아 보일 항목과 그때 쓸 짧은 이름. 컴퓨터 메뉴에서는 보통 줄로 보인다. */
  quick?: string }
/** 메뉴 맨 위에 보이는 대상 설명(글 제목과 피드 이름 등). 휴대폰 시트에서만 보인다. */
export interface AppContextHeading { title: string; detail?: string }

const MENU_ICONS: Record<string, LucideIcon> = {
  'copy-text': Copy, read: CheckCircle2, save: Bookmark,
  'block-title': ListFilter, 'edit-builder': Pencil, 'feed-history': History, 'rename-feed': Pencil,
  'open-feed': Newspaper, 'mark-feed': CheckCheck, 'move-feed': FolderInput, updates: Pause,
  unsubscribe: UserRoundMinus, 'open-folder': FolderOpen, 'mark-folder': CheckCheck, 'delete-folder': FolderX,
  'open-original': ExternalLink, 'copy-link': Link2, all: Archive, refresh: RefreshCw, add: Plus,
  'deepl-selection': Languages, 'deepl-article': Languages, 'open-in-app': BookOpen, share: Share2, 'read-above': ArrowUpToLine, 'read-below': ArrowDownToLine, grok: GrokLogo as unknown as LucideIcon, chatgpt: ChatGptLogo as unknown as LucideIcon,
};
export function contextMenuIcon(item: Pick<AppContextAction, 'id' | 'label'>): LucideIcon {
  if (item.id === 'updates' && (item.label.includes('다시') || item.label.startsWith('Resume'))) return Play;
  if (item.id === 'read' && (item.label.startsWith('안 읽음') || item.label.startsWith('Mark as unread'))) return Circle;
  return MENU_ICONS[item.id] || Rss;
}

// 휴대폰 시트 위쪽 빠른 실행 줄에 보일 항목과 순서. 사용자가 편집하면 이 기기에 남긴다.
const QUICK_KEY = 'feedex_quick_actions';
const QUICK_DEFAULT = ['share', 'copy-link', 'grok', 'chatgpt'];
const QUICK_MAX = 5;
function readQuick(): string[] {
  try { const saved = JSON.parse(localStorage.getItem(QUICK_KEY) || 'null'); if (Array.isArray(saved) && saved.every((id) => typeof id === 'string')) return saved.slice(0, QUICK_MAX); } catch { /* 기본값을 쓴다. */ }
  return QUICK_DEFAULT;
}
function saveQuick(ids: string[]) { try { localStorage.setItem(QUICK_KEY, JSON.stringify(ids)); } catch { /* 이번 화면에서만 쓴다. */ } }

/** 구분선(separator)이 붙은 항목에서 새 묶음을 시작한다. 휴대폰 시트는 묶음마다 둥근 카드로 그린다. */
function groups(items: AppContextAction[]) {
  const result: AppContextAction[][] = [];
  for (const item of items) { if (item.separator || !result.length) result.push([item]); else result[result.length - 1].push(item); }
  return result;
}

/**
 * 오른쪽 클릭·길게 누르기 메뉴. 휴대폰에서 길게 누르면 손가락 옆의 작은 상자 대신 화면 아래에서 올라오는 시트로 띄운다.
 * 시트는 폭이 넓어 누르기 쉽고, 맨 위에 어떤 글의 메뉴인지 보여 준다.
 */
export function DesktopContextMenu({ enabled, touch = false, actions, heading }: { enabled: boolean; touch?: boolean; actions: (target: AppContextTarget) => AppContextAction[]; heading?: (target: AppContextTarget) => AppContextHeading | null }) {
  const latest = useRef(actions); latest.current = actions;
  const latestHeading = useRef(heading); latestHeading.current = heading;
  const [menu, setMenu] = useState<{ x: number; y: number; items: AppContextAction[]; sheet: boolean; heading: AppContextHeading | null } | null>(null);
  const [notice, setNotice] = useState('');
  const [quickIds, setQuickIds] = useState<string[]>(readQuick);
  const [editingQuick, setEditingQuick] = useState(false);
  const toggleQuick = (id: string) => setQuickIds((ids) => {
    // 개수 제한은 화면에서 막는다(이 기기에 없는 후보는 세지 않는다).
    const next = ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
    saveQuick(next);
    return next;
  });
  const ref = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!enabled) { setMenu(null); return; }
    const open = (target: Element, x: number, y: number, prevent: () => void, sheet = false) => {
      if (target.closest('input,textarea,select,[contenteditable="true"],dialog')) return;
      if (touch && target.closest('.feedex-reader-content')) return;
      const context: AppContextTarget = { articleId: target.closest<HTMLElement>('[data-article-id]')?.dataset.articleId,
        folderId: target.closest<HTMLElement>('[data-folder-id]')?.dataset.folderId,
        feedId: target.closest<HTMLElement>('[data-feed-id]')?.dataset.feedId,
        link: target.closest<HTMLAnchorElement>('a[href]')?.href, selection: window.getSelection()?.toString().trim() };
      const items = latest.current(context);
      if (!items.length) return;
      prevent(); previousFocus.current = document.activeElement as HTMLElement | null; setMenu({ x, y, items, sheet, heading: sheet ? latestHeading.current?.(context) ?? null : null });
    };
    const context = (event: MouseEvent) => { if (event.target instanceof Element) open(event.target, event.clientX, event.clientY, () => event.preventDefault()); };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      if (event.target instanceof Element) { const box = event.target.getBoundingClientRect(); open(event.target, box.left + 16, box.top + 16, () => event.preventDefault()); }
    };
    // 바깥을 눌러 메뉴를 닫으면 그 누름이 뒤에 있는 글이나 버튼을 누르지 않게 이어지는 클릭 한 번을 막는다.
    let swallowUntil = 0;
    const outside = (event: PointerEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      if (ref.current) swallowUntil = Date.now() + 700;
      setMenu(null);
    };
    const swallow = (event: MouseEvent) => { if (Date.now() < swallowUntil) { swallowUntil = 0; event.preventDefault(); event.stopPropagation(); } };
    const scroll = (event: Event) => { if (!ref.current?.contains(event.target as Node)) setMenu(null); };
    const close = () => setMenu(null);
    const unbindTouch = touch ? bindLongPress(document, (target, x, y) => open(target, x, y, () => {}, true)) : () => {};
    document.addEventListener('contextmenu', context); document.addEventListener('keydown', keyboard); document.addEventListener('pointerdown', outside); document.addEventListener('click', swallow, true);
    document.addEventListener('scroll', scroll, true); window.addEventListener('resize', close); window.addEventListener('blur', close);
    return () => {
      unbindTouch();
      document.removeEventListener('contextmenu', context); document.removeEventListener('keydown', keyboard); document.removeEventListener('pointerdown', outside); document.removeEventListener('click', swallow, true);
      document.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', close); window.removeEventListener('blur', close);
    };
  }, [enabled, touch]);
  useLayoutEffect(() => {
    if (!menu || !ref.current || menu.sheet) return;
    const box = ref.current.getBoundingClientRect(), x = Math.max(8, Math.min(menu.x, window.innerWidth - box.width - 8)), y = Math.max(8, Math.min(menu.y, window.innerHeight - box.height - 8));
    if (x !== menu.x || y !== menu.y) setMenu({ ...menu, x, y });
    ref.current.querySelector<HTMLButtonElement>('button')?.focus();
  }, [menu]);
  const choose = (item: AppContextAction) => {
    setMenu(null);
    try { void Promise.resolve(item.run()).catch(() => setNotice(t('작업을 완료하지 못했습니다. 다시 시도해 주세요.', 'Could not finish that. Please try again.'))); }
    catch { setNotice(t('작업을 완료하지 못했습니다. 다시 시도해 주세요.', 'Could not finish that. Please try again.')); }
  };
  // 시트를 띄운 뒤에도 손가락이 눌려 있으면 iOS가 그 자리의 글자를 고르고 복사·번역 막대를 띄운다.
  // 시트가 열린 동안에는 화면 전체에서 글자 선택을 막고, 생긴 선택은 바로 지운다.
  const sheetOpen = Boolean(menu?.sheet);
  useEffect(() => {
    if (!sheetOpen) { setEditingQuick(false); return; }
    const root = document.documentElement;
    const clear = () => { const selection = window.getSelection(); if (selection && !selection.isCollapsed) selection.removeAllRanges(); };
    root.classList.add('feedex-sheet-open');
    clear();
    document.addEventListener('selectionchange', clear);
    return () => { root.classList.remove('feedex-sheet-open'); document.removeEventListener('selectionchange', clear); };
  }, [sheetOpen]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3000); return () => clearTimeout(timer); }, [notice]);
  return <>
    {enabled && menu?.sheet && <div className="feedex-context-backdrop" aria-hidden="true" />}
    {enabled && menu && <div ref={ref} role="menu" aria-label={menu.heading?.title || t('feedex 메뉴', 'feedex menu')} className="feedex-context-menu" data-sheet={menu.sheet || undefined} style={menu.sheet ? undefined : { left: menu.x, top: menu.y }} onKeyDown={(event) => {
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      // Esc는 메뉴만 닫고 뒤에 열린 글은 닫지 않는다.
      if (event.key === 'Escape' || event.key === 'Tab') { setMenu(null); if (event.key === 'Escape') { event.preventDefault(); previousFocus.current?.focus(); } return; }
      const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : event.key === 'ArrowUp' ? (index + buttons.length - 1) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null;
      if (next !== null) { event.preventDefault(); buttons[next]?.focus(); }
    }}>{(() => {
      // 빠른 실행 후보 중 사용자가 고른 것만 고른 순서대로 위쪽 줄에 보인다. 고르지 않은 후보는 시트에 나오지 않는다.
      const candidates = menu.sheet ? menu.items.filter((item) => item.quick) : [];
      const shown = quickIds.map((id) => candidates.find((item) => item.id === id)).filter((item): item is AppContextAction => Boolean(item));
      // 번호와 개수 제한은 이 기기에 있는 후보만 센다(시스템 공유가 없는 브라우저 등).
      return <>
        {menu.heading && <div className="feedex-context-heading"><div><strong>{menu.heading.title}</strong>{menu.heading.detail && <small>{menu.heading.detail}</small>}</div>{candidates.length > 0 && <button type="button" className="feedex-context-edit" aria-pressed={editingQuick} onClick={() => setEditingQuick((value) => !value)}>{editingQuick ? t('완료', 'Done') : t('편집', 'Edit')}</button>}</div>}
        {editingQuick && candidates.length > 0 ? <div className="feedex-context-quick-edit"><p>{t(`위에 보일 항목을 누른 순서대로 골라요 (최대 ${QUICK_MAX}개)`, `Pick the shortcuts to show, in order (up to ${QUICK_MAX})`)}</p><div>{candidates.map((item) => { const Icon = contextMenuIcon(item); const order = shown.indexOf(item); return <button key={item.id} type="button" aria-pressed={order >= 0} disabled={order < 0 && shown.length >= QUICK_MAX} onClick={() => toggleQuick(item.id)}><Icon size={20} strokeWidth={1.8} aria-hidden="true" /><span>{item.quick}</span>{order >= 0 && <b aria-hidden="true">{order + 1}</b>}</button>; })}</div></div>
          : shown.length > 0 && <div className="feedex-context-quick">{shown.map((item) => { const Icon = contextMenuIcon(item); return <button key={item.id} type="button" role="menuitem" aria-label={item.label} onClick={() => choose(item)}><Icon size={20} strokeWidth={1.8} aria-hidden="true" /><span>{item.quick}</span></button>; })}</div>}
      </>;
    })()}
      {menu.sheet ? groups(menu.items.filter((item) => !item.quick)).map((group) => <div key={group[0].id} className="feedex-context-group" role="group">{group.map((item) => { const Icon = contextMenuIcon(item); return <button key={item.id} type="button" role="menuitem" data-danger={item.danger || undefined} onClick={() => choose(item)}><Icon size={19} strokeWidth={1.8} aria-hidden="true" /><span>{item.label}</span></button>; })}</div>)
        : menu.items.map((item, index) => { const Icon = contextMenuIcon(item); return <button key={item.id} type="button" role="menuitem" data-danger={item.danger || undefined} data-separator={(item.separator && index > 0) || undefined} onClick={() => choose(item)}><Icon size={17} strokeWidth={1.8} aria-hidden="true" /><span>{item.label}</span></button>; })}</div>}
    {notice && <div role="status" className="feedex-context-notice">{notice}</div>}
  </>;
}
