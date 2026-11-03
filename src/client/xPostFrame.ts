import { useEffect, type RefObject } from 'react';
import hlsUrl from 'hls.js/dist/hls.light.min.js?url';
import playerUrl from './xFramePlayer.js?url';
import { isXStatusUrl } from '../shared/xFeed';
import { X_THREAD_MARK } from '../shared/xThreadStyle';

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
/** 영상 재생기는 X 사본에서만 연결하고, 실제 코드는 재생할 때 불러온다. */
export function xFrameTools(html: string): string {
  if (!html.includes(X_THREAD_MARK)) return '';
  const asset = (path: string) => escape(new URL(path, location.origin).href);
  return `<script nonce="sfeed-scroll">addEventListener('click',e=>{const a=e.target.closest('a[href]');if(!a||a.hasAttribute('data-x-external')||e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;const u=a.href;if(/^https:\\/\\/x\\.com\\/[a-z\\d_]{1,15}\\/status\\/\\d{1,20}$/i.test(u)){e.preventDefault();parent.postMessage({sfeedXPost:u},'*')}})</script>`
    + (html.includes('data-hls-src=') ? `<script nonce="sfeed-scroll" defer src="${asset(playerUrl)}" data-hls="${asset(hlsUrl)}"></script>` : '');
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
