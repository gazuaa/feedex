import { useEffect, useRef, useState, type RefObject } from 'react';
import hlsUrl from 'hls.js/dist/hls.light.min.js?url';
import playerUrl from './xFramePlayer.js?url';
import { isXStatusUrl } from '../shared/xFeed';
import { X_THREAD_MARK } from '../shared/xThreadStyle';

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const YT_FRAME_SCRIPT = `<script nonce="sfeed-scroll">{let y;const p=()=>{if(!y)return;const r=y.getBoundingClientRect();parent.postMessage({sfeedYouTubeRect:[r.left,r.top,r.width,r.height]},'*')};addEventListener('click',e=>{const a=e.target.closest('a[data-yt-id]');if(!a||e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;e.preventDefault();y=a;const r=a.getBoundingClientRect();parent.postMessage({sfeedYouTube:{id:a.getAttribute('data-yt-id'),start:Number(a.getAttribute('data-yt-start'))||0,rect:[r.left,r.top,r.width,r.height]}},'*')});addEventListener('scroll',p,{passive:true});addEventListener('resize',p)}</script>`;

/** 영상 재생기는 X 사본과 YouTube 임베드 사본에서만 연결하고, 실제 코드는 재생할 때 불러온다. */
export function xFrameTools(html: string): string {
  const yt = html.includes('data-yt-id=') ? YT_FRAME_SCRIPT : '';
  if (!html.includes(X_THREAD_MARK)) return yt;
  const asset = (path: string) => escape(new URL(path, location.origin).href);
  return `<script nonce="sfeed-scroll">addEventListener('click',e=>{const a=e.target.closest('a[href]');if(!a||a.hasAttribute('data-x-external')||e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;const u=a.href;if(/^https:\\/\\/x\\.com\\/[a-z\\d_]{1,15}\\/status\\/\\d{1,20}$/i.test(u)){e.preventDefault();parent.postMessage({sfeedXPost:u},'*')}})</script>`
    + (html.includes('data-hls-src=') ? `<script nonce="sfeed-scroll" defer src="${asset(playerUrl)}" data-hls="${asset(hlsUrl)}"></script>` : '')
    + yt;
}
export function useXPostFrame(frame: RefObject<HTMLIFrameElement | null>, onOpen?: (url: string) => void) {
  useEffect(() => {
    const message = (event: MessageEvent) => {
      const url = event.data?.sfeedXPost;
      if (event.source === frame.current?.contentWindow && typeof url === 'string' && isXStatusUrl(url)) onOpen?.(url);
    };
    window.addEventListener('message', message);
    return () => window.removeEventListener('message', message);
  }, [frame, onOpen]);
}

export interface ActiveYouTubeEmbed {
  id: string;
  start: number;
  rect: [number, number, number, number];
}

/** 웹 사본 안의 YouTube 카드를 누르면 그 자리 위에 실제 YouTube 플레이어를 포개어 띄운다. */
export function useYouTubeCopyFrame(frame: RefObject<HTMLIFrameElement | null>, webZoom: number, resetKey: string) {
  const [active, setActive] = useState<ActiveYouTubeEmbed | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const rectRef = useRef<[number, number, number, number] | null>(null);
  const zoomRef = useRef(webZoom);
  zoomRef.current = webZoom;

  const applyRect = (rect: [number, number, number, number], zoom: number) => {
    const el = overlayRef.current;
    if (!el) return;
    el.style.left = `${rect[0] * zoom}px`;
    el.style.top = `${rect[1] * zoom}px`;
    el.style.width = `${rect[2] * zoom}px`;
    el.style.height = `${rect[3] * zoom}px`;
  };

  useEffect(() => {
    setActive(null);
    rectRef.current = null;
  }, [resetKey]);

  useEffect(() => {
    if (rectRef.current) applyRect(rectRef.current, webZoom);
  }, [webZoom, active]);

  useEffect(() => {
    const parseRect = (raw: unknown): [number, number, number, number] | null => {
      if (!Array.isArray(raw) || raw.length < 4) return null;
      return [
        Number(raw[0]) || 0,
        Number(raw[1]) || 0,
        Math.max(120, Number(raw[2]) || 560),
        Math.max(68, Number(raw[3]) || 315),
      ];
    };
    const message = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const yt = event.data?.sfeedYouTube;
      if (yt && typeof yt.id === 'string' && /^[\w-]{11}$/.test(yt.id)) {
        const rect = parseRect(yt.rect);
        if (!rect) return;
        rectRef.current = rect;
        setActive({ id: yt.id, start: Math.max(0, Math.floor(Number(yt.start) || 0)), rect });
        applyRect(rect, zoomRef.current);
        return;
      }
      const rect = parseRect(event.data?.sfeedYouTubeRect);
      if (rect) {
        rectRef.current = rect;
        applyRect(rect, zoomRef.current);
      }
    };
    window.addEventListener('message', message);
    return () => window.removeEventListener('message', message);
  }, [frame]);

  return { activeYouTube: active, ytOverlayRef: overlayRef, closeYouTube: () => { setActive(null); rectRef.current = null; } };
}
