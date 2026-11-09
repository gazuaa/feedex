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
  // srcdoc 프레임은 바깥 iframe의 referrerPolicy만으로 내부 영상 요청의 Referer를 없애지 못한다.
  return `<meta name="referrer" content="no-referrer"><script nonce="sfeed-scroll">addEventListener('error',e=>{if(e.target?.tagName==='IMG')e.target.style.display='none'},true);addEventListener('click',e=>{if(e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;const p=e.target.closest('a.photo:not(.video)');if(p){e.preventDefault();const box=p.closest('.media,.quote,article')||document,all=[...box.querySelectorAll('a.photo:not(.video)')],urls=all.map(x=>x.href||x.querySelector('img')?.src||'').filter(Boolean);if(urls.length)parent.postMessage({sfeedXPhotos:{urls,index:Math.max(0,all.indexOf(p))}},'*');return}const a=e.target.closest('a[href]');if(!a||a.hasAttribute('data-x-external'))return;const u=a.href;if(/^https:\\/\\/x\\.com\\/[a-z\\d_]{1,15}\\/status\\/\\d{1,20}$/i.test(u)){e.preventDefault();const q=a.closest('.quote');let t='',n='',h='';if(q){const c=q.querySelector('.text')?.cloneNode(true);if(c){c.querySelectorAll('br').forEach(b=>b.replaceWith('\u2028'));t=(c.textContent||'').replace(/[ \\t]*[\\r\\n]+[ \\t]*/g,'\\n').replace(/[ \\t]*\u2028[ \\t]*/g,'\\n').trim()}n=q.querySelector('.who b')?.textContent?.trim()||'';h=q.querySelector('.who span')?.textContent?.trim()||''}parent.postMessage({sfeedXPost:u,quoteText:t,quoteName:n,quoteHandle:h},'*')}})</script>`
    + (html.includes('data-hls-src=') ? `<script nonce="sfeed-scroll" defer src="${asset(playerUrl)}" data-hls="${asset(hlsUrl)}"></script>` : '')
    + yt;
}

export function fullXPhotoUrl(url: string): string {
  if (!/^https:\/\/pbs\.twimg\.com\/media\//i.test(url)) return url;
  return url.replace(/([?&])name=(?:small|medium|thumb|tiny|240x240|360x360)(?=&|$)/i, '$1name=large');
}

/** 본문 사진을 새 탭으로 내보내지 않고 앱 안의 모달 뷰어로 크게 보여 준다. */
let activePhotoClose: (() => void) | null = null;

export function openPhotoViewer(rawUrls: string[], startIndex = 0) {
  const urls = rawUrls.filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u)).map(fullXPhotoUrl);
  if (!urls.length || typeof document === 'undefined') return;
  activePhotoClose?.();
  const previous = document.querySelector<HTMLDialogElement>('dialog[data-sfeed-photo-viewer]');
  if (previous) { if (previous.open) previous.close(); previous.remove(); }

  let index = Math.max(0, Math.min(urls.length - 1, Math.floor(startIndex) || 0));
  let zoomed = false;

  const dialog = document.createElement('dialog');
  dialog.setAttribute('data-sfeed-photo-viewer', '');
  dialog.setAttribute('aria-label', '사진 크게 보기');
  dialog.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;height:100dvh;max-width:100vw;max-height:100vh;max-height:100dvh;margin:0;padding:0;border:0;background:rgba(2,6,23,0.92);backdrop-filter:blur(6px);color:#f8fafc;overflow:hidden;display:flex;flex-direction:column;user-select:none;z-index:9999';

  // 홈 화면 앱에서는 화면 위쪽 상태 표시줄·노치 아래로 닫기 단추를 내린다.
  const header = document.createElement('div');
  header.style.cssText = 'height:calc(52px + env(safe-area-inset-top));box-sizing:border-box;padding:env(safe-area-inset-top) calc(16px + env(safe-area-inset-right)) 0 calc(16px + env(safe-area-inset-left));display:flex;align-items:center;justify-content:space-between;gap:12px;flex-shrink:0;background:linear-gradient(to bottom,rgba(2,6,23,0.75),transparent);z-index:2';

  const counter = document.createElement('span');
  counter.setAttribute('data-photo-counter', '');
  counter.style.cssText = 'font-size:14px;font-weight:600;color:#cbd5e1;font-variant-numeric:tabular-nums';

  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;align-items:center;gap:8px';

  const btnStyle = 'height:36px;padding:0 12px;border-radius:9999px;border:1px solid rgba(255,255,255,0.2);background:rgba(15,23,42,0.75);color:#fff;font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center';
  const zoomBtn = document.createElement('button');
  zoomBtn.type = 'button';
  zoomBtn.setAttribute('data-photo-zoom', '');
  zoomBtn.style.cssText = btnStyle;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.setAttribute('data-photo-close', '');
  closeBtn.setAttribute('aria-label', '사진 닫기');
  closeBtn.title = '닫기 (ESC)';
  closeBtn.style.cssText = `${btnStyle};width:36px;padding:0;font-size:16px`;
  closeBtn.textContent = '✕';

  controls.append(zoomBtn, closeBtn);
  header.append(counter, controls);

  const stage = document.createElement('div');
  stage.setAttribute('data-photo-stage', '');
  stage.style.cssText = 'flex:1;min-height:0;width:100%;overflow:auto;display:flex;align-items:center;justify-content:center;padding:8px 16px calc(24px + env(safe-area-inset-bottom))';

  const img = document.createElement('img');
  img.setAttribute('data-photo-img', '');
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  stage.append(img);

  const navBtnStyle = 'position:fixed;top:50%;transform:translateY(-50%);width:44px;height:44px;border-radius:9999px;border:1px solid rgba(255,255,255,0.2);background:rgba(15,23,42,0.75);color:#fff;font-size:26px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;z-index:3';
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.setAttribute('data-photo-prev', '');
  prevBtn.setAttribute('aria-label', '이전 사진');
  prevBtn.style.cssText = `${navBtnStyle};left:16px`;
  prevBtn.textContent = '‹';

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.setAttribute('data-photo-next', '');
  nextBtn.setAttribute('aria-label', '다음 사진');
  nextBtn.style.cssText = `${navBtnStyle};right:16px`;
  nextBtn.textContent = '›';

  const render = () => {
    img.src = urls[index];
    counter.textContent = urls.length > 1 ? `${index + 1} / ${urls.length}` : '';
    zoomBtn.textContent = zoomed ? '화면 맞춤' : '확대 보기';
    stage.style.alignItems = zoomed ? 'flex-start' : 'center';
    img.style.cssText = zoomed
      ? 'width:min(94vw,1080px);max-width:none;max-height:none;height:auto;border-radius:8px;cursor:zoom-out;margin:0 auto;display:block'
      : 'max-width:min(92vw,1200px);max-height:calc(100dvh - 84px - env(safe-area-inset-top) - env(safe-area-inset-bottom));width:auto;height:auto;object-fit:contain;border-radius:8px;cursor:zoom-in;display:block';
    if (urls.length > 1) {
      prevBtn.disabled = index === 0;
      nextBtn.disabled = index === urls.length - 1;
      prevBtn.style.opacity = index === 0 ? '0.25' : '1';
      nextBtn.style.opacity = index === urls.length - 1 ? '0.25' : '1';
      prevBtn.style.cursor = index === 0 ? 'default' : 'pointer';
      nextBtn.style.cursor = index === urls.length - 1 ? 'default' : 'pointer';
    }
  };

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener('popstate', close);
    window.removeEventListener('pagehide', close);
    if (activePhotoClose === close) activePhotoClose = null;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    dialog.remove();
  };
  const step = (delta: number) => {
    const next = index + delta;
    if (next < 0 || next >= urls.length) return;
    index = next;
    zoomed = false;
    stage.scrollTop = 0;
    stage.scrollLeft = 0;
    render();
  };
  const toggleZoom = () => {
    zoomed = !zoomed;
    render();
  };

  closeBtn.addEventListener('click', close);
  zoomBtn.addEventListener('click', toggleZoom);
  img.addEventListener('click', (e) => { e.stopPropagation(); toggleZoom(); });
  stage.addEventListener('click', (e) => { if (e.target === stage) close(); });
  header.addEventListener('click', (e) => { if (e.target === header) close(); });
  prevBtn.addEventListener('click', (e) => { e.stopPropagation(); step(-1); });
  nextBtn.addEventListener('click', (e) => { e.stopPropagation(); step(1); });
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  // 브라우저 기본 닫기나 기록 이동에서도 닫힌 레이어가 목록 위에 남지 않게 한다.
  dialog.addEventListener('close', close);
  window.addEventListener('popstate', close);
  window.addEventListener('pagehide', close);
  activePhotoClose = close;
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); step(1); }
  });

  let touchX = 0, touchY = 0;
  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; }
  }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (zoomed || e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - touchX, dy = e.changedTouches[0].clientY - touchY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
    // 휴대폰에서는 사진을 아래로 끌어내려 닫는다.
    else if (dy > 90 && dy > Math.abs(dx) * 1.5) close();
  }, { passive: true });

  dialog.append(header, stage);
  if (urls.length > 1) dialog.append(prevBtn, nextBtn);
  document.body.append(dialog);
  render();
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  return close;
}

export interface XQuoteHint {
  text: string;
  name?: string;
  handle?: string;
}

export function useXPostFrame(frame: RefObject<HTMLIFrameElement | null>, onOpen?: (url: string, hint?: XQuoteHint) => void, resetKey = '') {
  const open = useRef(onOpen); open.current = onOpen;
  useEffect(() => {
    let closePhoto: (() => void) | undefined;
    const message = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const photos = event.data?.sfeedXPhotos;
      if (photos && Array.isArray(photos.urls)) {
        closePhoto?.(); closePhoto = openPhotoViewer(photos.urls, Number(photos.index) || 0);
        return;
      }
      const url = event.data?.sfeedXPost;
      if (typeof url === 'string' && isXStatusUrl(url)) {
        const text = typeof event.data?.quoteText === 'string' ? event.data.quoteText : '';
        const name = typeof event.data?.quoteName === 'string' ? event.data.quoteName : '';
        const handle = typeof event.data?.quoteHandle === 'string' ? event.data.quoteHandle.replace(/^@/, '') : '';
        open.current?.(url, text ? { text, name, handle } : undefined);
      }
    };
    window.addEventListener('message', message);
    return () => { window.removeEventListener('message', message); closePhoto?.(); };
  }, [frame, resetKey]);
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
