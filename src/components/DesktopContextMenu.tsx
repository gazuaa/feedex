import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Archive, ArrowDownToLine, ArrowUpToLine, Bookmark, BookOpen, Share2, CheckCheck, CheckCircle2, Circle, Copy, ExternalLink, FolderInput, FolderOpen, FolderX, History, Languages, Link2, ListFilter, Newspaper, Pause, Pencil, Play, Plus, RefreshCw, Rss, UserRoundMinus, type LucideIcon } from 'lucide-react';
import { bindLongPress } from '../client/longPress';
import { t } from '../shared/i18n';
import { GrokLogo } from './GrokLogo';

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
  'deepl-selection': Languages, 'deepl-article': Languages, 'open-in-app': BookOpen, share: Share2, 'read-above': ArrowUpToLine, 'read-below': ArrowDownToLine, grok: GrokLogo as unknown as LucideIcon,
};
export function contextMenuIcon(item: Pick<AppContextAction, 'id' | 'label'>): LucideIcon {
  if (item.id === 'updates' && (item.label.includes('다시') || item.label.startsWith('Resume'))) return Play;
  if (item.id === 'read' && (item.label.startsWith('안 읽음') || item.label.startsWith('Mark as unread'))) return Circle;
  return MENU_ICONS[item.id] || Rss;
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
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setMenu(null); };
    const scroll = (event: Event) => { if (!ref.current?.contains(event.target as Node)) setMenu(null); };
    const close = () => setMenu(null);
    const unbindTouch = touch ? bindLongPress(document, (target, x, y) => open(target, x, y, () => {}, true)) : () => {};
    document.addEventListener('contextmenu', context); document.addEventListener('keydown', keyboard); document.addEventListener('pointerdown', outside);
    document.addEventListener('scroll', scroll, true); window.addEventListener('resize', close); window.addEventListener('blur', close);
    return () => {
      unbindTouch();
      document.removeEventListener('contextmenu', context); document.removeEventListener('keydown', keyboard); document.removeEventListener('pointerdown', outside);
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
    }}>{menu.heading && <div className="feedex-context-heading"><strong>{menu.heading.title}</strong>{menu.heading.detail && <small>{menu.heading.detail}</small>}</div>}
      {menu.sheet && menu.items.some((item) => item.quick) && <div className="feedex-context-quick">{menu.items.filter((item) => item.quick).map((item) => { const Icon = contextMenuIcon(item); return <button key={item.id} type="button" role="menuitem" aria-label={item.label} onClick={() => choose(item)}><Icon size={20} strokeWidth={1.8} aria-hidden="true" /><span>{item.quick}</span></button>; })}</div>}
      {menu.items.filter((item) => !(menu.sheet && item.quick)).map((item, index) => { const Icon = contextMenuIcon(item); return <button key={item.id} type="button" role="menuitem" data-danger={item.danger || undefined} data-separator={(item.separator && index > 0) || undefined} onClick={() => choose(item)}><Icon size={17} strokeWidth={1.8} aria-hidden="true" /><span>{item.label}</span></button>; })}</div>}
    {notice && <div role="status" className="feedex-context-notice">{notice}</div>}
  </>;
}
