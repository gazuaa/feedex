import { xFrameTools } from './xPostFrame';
import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';
const query = '(max-width: 1023px)';
const subscribe = (callback: () => void) => { const media = window.matchMedia(query); media.addEventListener('change', callback); return () => media.removeEventListener('change', callback); };
export const useMobileViewport = () => useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);

// 방향을 바꾸기 전에 움직임을 쌓는다. iOS 고무줄 스크롤은 잘라 내서
// 가장자리에서 튕겨도 막대가 깜빡이지 않게 한다.
export function scrollChrome(previous: { top: number; travel: number; hidden: boolean }, top: number, max: number, locked = false) {
  const next = Math.max(0, Math.min(max, top));
  const delta = next - previous.top;
  const travel = Math.sign(delta) === Math.sign(previous.travel) ? previous.travel + delta : delta;
  return { top: next, travel, hidden: locked || next < 24 ? false : travel > 18 ? true : travel < -12 ? false : previous.hidden };
}
/** `frame`은 자기 스크롤 위치를 알려 주는 웹 사본이다(framedCopy 참고). `ref`가 비었을 때 쓴다. */
export function useScrollChrome(ref: RefObject<HTMLElement | null>, enabled: boolean, resetKey = '', frame?: RefObject<HTMLIFrameElement | null>) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(false);
    const element = ref.current, copy = frame?.current;
    if (!enabled || (!element && !copy)) return;
    let position = { top: element?.scrollTop ?? 0, travel: 0, hidden: false }, viewport = element?.clientHeight ?? 0;
    const move = (top: number, max: number, height: number) => {
      // 아래쪽 막대가 접히면 화면이 커지며 위치가 당겨 올라가는데, 이것은 위로 다시 스크롤한 것이 아니다.
      const resized = height !== viewport;
      viewport = height;
      if (resized && top >= max - 1) { position = { ...position, top: Math.max(0, top), travel: 0 }; return; }
      const shell = (element ?? copy)!.closest('.feedex-mobile-library, .feedex-workspace');
      const locked = Boolean(document.querySelector('dialog[open]') || shell?.querySelector('.feedex-mobile-settings[open]')) || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '');
      position = scrollChrome(position, top, max, locked);
      setHidden(position.hidden);
    };
    if (element) {
      const scroll = () => move(element.scrollTop, element.scrollHeight - element.clientHeight, element.clientHeight);
      element.addEventListener('scroll', scroll, { passive: true });
      return () => element.removeEventListener('scroll', scroll);
    }
    const message = (event: MessageEvent) => {
      const sample = event.data?.sfeedScroll;
      if (event.source !== copy!.contentWindow || !Array.isArray(sample)) return;
      move(Number(sample[0]) || 0, Number(sample[1]) || 0, Number(sample[2]) || 0);
    };
    window.addEventListener('message', message);
    return () => window.removeEventListener('message', message);
  }, [ref, frame, enabled, resetKey]);
  return enabled && hidden;
}

// 샌드박스 사본은 앱이 읽을 수 없으므로 사본이 자기 스크롤을 알린다.
// 보안 정책은 이 스크립트만 실행을 허용하고, 사본 자체는 스크립트 없이 둔다.
// 스크립트가 없으면 페이지가 프레임보다 조금 넓게 배치될 수 있다. 사본은 옆으로 움직이지
// 않으므로, 옆으로 끄는 동작은 대신 웹 보기의 밀어서 뒤로 가기 페이저로 간다.
// 어떤 페이지는 스크립트가 있어야만 휴대폰 배치로 바뀐다. 그런 페이지는 휴대폰에서 글이
// 데스크톱 열 옆의 좁은 틈에 놓이는데, 사본은 이를 sfeedSqueezed로 한 번 알린다.
const COPY_PREAMBLE = `<style>html,body{overflow-x:hidden!important}</style><meta http-equiv="Content-Security-Policy" content="script-src 'nonce-sfeed-scroll'"><script nonce="sfeed-scroll">addEventListener('scroll',()=>{const d=document.scrollingElement||document.documentElement;parent.postMessage({sfeedScroll:[d.scrollTop,d.scrollHeight-innerHeight,innerHeight]},'*')},{passive:true});let sfeedSent;const sfeedFit=()=>{let n=0,s=0;for(const p of document.querySelectorAll('p')){const l=p.textContent.trim().length,w=p.getBoundingClientRect().width;if(l>79&&w){n+=l;s+=l*w}}if(!sfeedSent&&innerWidth<700&&n>400&&s/n<innerWidth/2){sfeedSent=1;parent.postMessage({sfeedSqueezed:1},'*')}};addEventListener('load',sfeedFit);setTimeout(sfeedFit,4000)</script>`;
export const framedCopy = (html: string) => html.replace(/^(\s*<!doctype[^>]*>)?(\s*<html[^>]*>)?/i, (start) => start + COPY_PREAMBLE + xFrameTools(html));
