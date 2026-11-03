import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Archive, BookOpen, Bookmark, CheckCheck, CheckCircle2, Circle, Copy, ExternalLink, FolderInput, FolderOpen, FolderX, History, Link2, ListFilter, Newspaper, Pause, Pencil, Play, Plus, RefreshCw, Rss, UserRoundMinus, type LucideIcon } from 'lucide-react';
import { bindLongPress } from '../client/longPress';

export interface AppContextTarget { articleId?: string; folderId?: string; feedId?: string; link?: string; selection?: string }
export interface AppContextAction { id: string; label: string; run: () => void | Promise<unknown>; danger?: boolean; separator?: boolean }

const MENU_ICONS: Record<string, LucideIcon> = {
  'copy-text': Copy, 'open-article': BookOpen, read: CheckCircle2, save: Bookmark,
  'block-title': ListFilter, 'edit-builder': Pencil, 'feed-history': History, 'rename-feed': Pencil,
  'open-feed': Newspaper, 'mark-feed': CheckCheck, 'move-feed': FolderInput, updates: Pause,
  unsubscribe: UserRoundMinus, 'open-folder': FolderOpen, 'mark-folder': CheckCheck, 'delete-folder': FolderX,
  'open-original': ExternalLink, 'copy-link': Link2, all: Archive, refresh: RefreshCw, add: Plus,
};
export function contextMenuIcon(item: Pick<AppContextAction, 'id' | 'label'>): LucideIcon {
  if (item.id === 'updates' && item.label.includes('다시')) return Play;
  if (item.id === 'read' && item.label.startsWith('안 읽음')) return Circle;
  return MENU_ICONS[item.id] || Rss;
}

export function DesktopContextMenu({ enabled, touch = false, actions }: { enabled: boolean; touch?: boolean; actions: (target: AppContextTarget) => AppContextAction[] }) {
  const latest = useRef(actions); latest.current = actions;
  const [menu, setMenu] = useState<{ x: number; y: number; items: AppContextAction[] } | null>(null);
  const [notice, setNotice] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!enabled) { setMenu(null); return; }
    const open = (target: Element, x: number, y: number, prevent: () => void) => {
      if (target.closest('input,textarea,select,[contenteditable="true"],dialog')) return;
      if (touch && target.closest('.sfeed-reader-content')) return;
      const context: AppContextTarget = { articleId: target.closest<HTMLElement>('[data-article-id]')?.dataset.articleId,
        folderId: target.closest<HTMLElement>('[data-folder-id]')?.dataset.folderId,
        feedId: target.closest<HTMLElement>('[data-feed-id]')?.dataset.feedId,
        link: target.closest<HTMLAnchorElement>('a[href]')?.href, selection: window.getSelection()?.toString().trim() };
      const items = latest.current(context);
      if (!items.length) return;
      prevent(); previousFocus.current = document.activeElement as HTMLElement | null; setMenu({ x, y, items });
    };
    const context = (event: MouseEvent) => { if (event.target instanceof Element) open(event.target, event.clientX, event.clientY, () => event.preventDefault()); };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      if (event.target instanceof Element) { const box = event.target.getBoundingClientRect(); open(event.target, box.left + 16, box.top + 16, () => event.preventDefault()); }
    };
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setMenu(null); };
    const scroll = (event: Event) => { if (!ref.current?.contains(event.target as Node)) setMenu(null); };
    const close = () => setMenu(null);
    const unbindTouch = touch ? bindLongPress(document, (target, x, y) => open(target, x, y, () => {})) : () => {};
    document.addEventListener('contextmenu', context); document.addEventListener('keydown', keyboard); document.addEventListener('pointerdown', outside);
    document.addEventListener('scroll', scroll, true); window.addEventListener('resize', close); window.addEventListener('blur', close);
    return () => {
      unbindTouch();
      document.removeEventListener('contextmenu', context); document.removeEventListener('keydown', keyboard); document.removeEventListener('pointerdown', outside);
      document.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', close); window.removeEventListener('blur', close);
    };
  }, [enabled, touch]);
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const box = ref.current.getBoundingClientRect(), x = Math.max(8, Math.min(menu.x, window.innerWidth - box.width - 8)), y = Math.max(8, Math.min(menu.y, window.innerHeight - box.height - 8));
    if (x !== menu.x || y !== menu.y) setMenu({ ...menu, x, y });
    ref.current.querySelector<HTMLButtonElement>('button')?.focus();
  }, [menu]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3000); return () => clearTimeout(timer); }, [notice]);
  return <>
    {enabled && menu && <div ref={ref} role="menu" aria-label="FeedEx 메뉴" className="sfeed-context-menu" style={{ left: menu.x, top: menu.y }} onKeyDown={(event) => {
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      // Esc는 메뉴만 닫고 뒤에 열린 글은 닫지 않는다.
      if (event.key === 'Escape' || event.key === 'Tab') { setMenu(null); if (event.key === 'Escape') { event.preventDefault(); previousFocus.current?.focus(); } return; }
      const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : event.key === 'ArrowUp' ? (index + buttons.length - 1) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null;
      if (next !== null) { event.preventDefault(); buttons[next]?.focus(); }
    }}>{menu.items.map((item) => { const Icon = contextMenuIcon(item); return <button key={item.id} type="button" role="menuitem" data-danger={item.danger || undefined} data-separator={item.separator || undefined} onClick={() => {
      setMenu(null);
      try { void Promise.resolve(item.run()).catch(() => setNotice('작업을 완료하지 못했습니다. 다시 시도해 주세요.')); }
      catch { setNotice('작업을 완료하지 못했습니다. 다시 시도해 주세요.'); }
    }}><Icon size={17} strokeWidth={1.8} aria-hidden="true" /><span>{item.label}</span></button>; })}</div>}
    {notice && <div role="status" className="sfeed-context-notice">{notice}</div>}
  </>;
}
