import React, { useEffect, useRef, useState } from 'react';
import { fitPanelWidths, panelLimits, PANEL_DEFAULTS, PANEL_MIN, readPanelWidths, savePanelWidths, type PanelName } from '../client/panelWidths';

interface ResizableWorkspaceProps {
  userId: string;
  isDark: boolean;
  sidebar: React.ReactNode;
  header: React.ReactNode;
  reader: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
  listRef: React.Ref<HTMLElement>;
  inactive?: boolean;
  mobileReaderOpen?: boolean;
}

export function ResizableWorkspace({ userId, isDark, sidebar, header, reader, footer, children, listRef, inactive, mobileReaderOpen }: ResizableWorkspaceProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<HTMLElement>(null);
  const [containerWidth, setContainerWidth] = useState(1280);
  const [preferred, setPreferred] = useState(() => readPanelWidths(userId));
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{ panel: PanelName; pointerId: number; startX: number; startWidth: number; max: number } | null>(null);
  const widths = fitPanelWidths(preferred, containerWidth);
  const limits = panelLimits(containerWidth, widths.channels);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const measure = () => setContainerWidth(shell.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { savePanelWidths(userId, preferred); }, [userId, preferred]);

  const updateWidth = (panel: PanelName, value: number, max = limits[panel]) => {
    setPreferred((current) => ({ ...current, [panel]: Math.min(max, Math.max(PANEL_MIN[panel], Math.round(value))) }));
  };

  const splitter = (panel: PanelName) => <div
    role="separator"
    aria-label={panel === 'channels' ? '채널과 피드 목록 너비 조절' : '피드 목록과 본문 너비 조절'}
    aria-orientation="vertical"
    aria-controls={panel === 'channels' ? 'feed-channel-pane feed-article-list' : 'feed-article-list article-reader-pane'}
    aria-valuemin={PANEL_MIN[panel]}
    aria-valuemax={limits[panel]}
    aria-valuenow={widths[panel]}
    aria-valuetext={`${widths[panel]}픽셀`}
    tabIndex={0}
    title="드래그하여 너비 조절 · 두 번 클릭하여 초기화"
    className="feedex-pane-splitter"
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { panel, pointerId: event.pointerId, startX: event.clientX, startWidth: widths[panel], max: limits[panel] };
      setResizing(true);
    }}
    onPointerMove={(event) => {
      const active = drag.current;
      if (active?.panel === panel && active.pointerId === event.pointerId) updateWidth(panel, active.startWidth + event.clientX - active.startX, active.max);
    }}
    onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); drag.current = null; setResizing(false); }}
    onPointerCancel={() => { drag.current = null; setResizing(false); }}
    onLostPointerCapture={() => { drag.current = null; setResizing(false); }}
    onDoubleClick={() => setPreferred((current) => ({ ...current, [panel]: PANEL_DEFAULTS[panel] }))}
    onKeyDown={(event) => {
      const step = event.shiftKey ? 48 : 16;
      const value = event.key === 'ArrowLeft' ? widths[panel] - step : event.key === 'ArrowRight' ? widths[panel] + step : event.key === 'Home' ? PANEL_MIN[panel] : event.key === 'End' ? limits[panel] : null;
      if (value !== null) { event.preventDefault(); updateWidth(panel, value); }
    }}
  />;

  return <div ref={shellRef} data-inactive={inactive || undefined} aria-hidden={inactive || undefined} data-resizing={resizing || undefined} className={`feedex-shell feedex-workspace h-dvh min-h-0 overflow-hidden ${isDark ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'}`} style={{ '--feedex-channel-width': `${widths.channels}px`, '--feedex-list-width': `${widths.list}px` } as React.CSSProperties}>
    {sidebar}
    {splitter('channels')}
    <div className="feedex-workspace-main flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
      <div className="feedex-workspace-header shrink-0" inert={inactive || mobileReaderOpen || undefined} aria-hidden={mobileReaderOpen || undefined}>{header}</div>
      <div className="feedex-content-panes flex-1 min-w-0 min-h-0 overflow-hidden">
        {/* 모바일 본문이 터치를 받는 동안에도 iOS가 목록의 스크롤 입력 영역을 유지하게 한다. */}
        <main ref={listRef} aria-hidden={mobileReaderOpen || undefined} id="feed-article-list" aria-label="피드 목록" tabIndex={inactive || mobileReaderOpen ? -1 : 0} className="feedex-feed-list min-w-0 min-h-0 overflow-y-auto overscroll-contain" onFocusCapture={mobileReaderOpen ? () => {
          const controls = readerRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], iframe');
          const first = controls && Array.from(controls).find((control) => control.getClientRects().length && !control.closest('[inert]'));
          first?.focus({ preventScroll: true });
        } : undefined}><div inert={inactive || undefined}>{children}</div></main>
        {splitter('list')}
        <aside ref={readerRef} inert={inactive || undefined} id="article-reader-pane" aria-label="글 본문" className="feedex-reader-pane h-full min-w-0 min-h-0 overflow-hidden">{reader}</aside>
      </div>
      {footer}
    </div>
  </div>;
}
