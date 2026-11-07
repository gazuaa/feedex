import { useLayoutEffect, useSyncExternalStore, type RefObject } from 'react';

// 맥 앱 안에서 열렸을 때만 있는 연결. 앱이 WKWebView에 'feedex' 메시지 통로를 만든다.
// 크롬 앱이나 일반 브라우저에는 없다.
export type NativeRect = { x: number; y: number; width: number; height: number };
export type NativeMessage =
  | { type: 'signIn' }
  | { type: 'checkForUpdates' }
  | { type: 'appScale'; action: 'smaller' | 'larger' | 'reset' }
  | { type: 'article'; url: string | null; rect?: NativeRect; zoom?: number; hidden?: boolean }
  | { type: 'openExternal'; url: string };
interface NativeBridge { postMessage(message: NativeMessage): void }
type BridgeHost = { webkit?: { messageHandlers?: { feedex?: Partial<NativeBridge> } } };

export function nativeBridge(host: BridgeHost = globalThis as BridgeHost): NativeBridge | null {
  const handler = host.webkit?.messageHandlers?.feedex;
  return handler && typeof handler.postMessage === 'function' ? handler as NativeBridge : null;
}
export const inNativeApp = (host?: BridgeHost) => Boolean(nativeBridge(host));
/** 맥 앱이 연 시스템 로그인 창(Safari) 안인지. 이 창에서는 로그인한 계정을 맥 앱에 넘기기만 한다. */
export const inNativeSignInWindow = (search = typeof location === 'undefined' ? '' : location.search) => new URLSearchParams(search).has('native-sign-in');

// 웹 보기 자리를 가리는 창들. 맥 앱의 원문 화면은 웹 화면 위에 놓이므로, 이것들이 열리면 원문 화면을 잠시 숨긴다.
export const NATIVE_COVERS = 'dialog[open], [aria-modal="true"], .feedex-desktop-settings[open], .feedex-mobile-settings[open], .feedex-context-menu';

/**
 * 웹 보기 자리의 위치와 덮인 상태. 앱은 이 자리에 로그인이 유지되는 원문 화면을 겹쳐 띄운다.
 * 창이 가려져도 숨기지 않는다. 원문 화면도 함께 가려지고, 숨겼다 다시 띄우면 깜빡이기만 한다.
 */
export function articlePlacement(slot: Pick<Element, 'getBoundingClientRect'>, doc: Pick<Document, 'querySelector'>, url: string, zoom: number): NativeMessage {
  const box = slot.getBoundingClientRect();
  const hidden = box.width < 1 || box.height < 1 || Boolean(doc.querySelector(NATIVE_COVERS));
  return { type: 'article', url, zoom, hidden, rect: { x: Math.round(box.left), y: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) } };
}

/** 웹 보기 자리를 앱에 계속 알린다. 자리가 사라지면 원문 화면을 거두게 한다. */
export function useNativeArticle(slot: RefObject<HTMLElement | null>, url: string | null, zoom: number) {
  useLayoutEffect(() => {
    const bridge = nativeBridge(), element = slot.current;
    if (!bridge) return;
    if (!url || !element) { bridge.postMessage({ type: 'article', url: null }); return; }
    let frame = 0, last = '';
    const send = () => {
      frame = 0;
      const message = articlePlacement(element, document, url, zoom), key = JSON.stringify(message);
      if (key !== last) { last = key; bridge.postMessage(message); }
    };
    // 화면 갱신(requestAnimationFrame)에 맞추면 창이 가려진 동안 멈추므로 짧은 타이머로 모아 보낸다.
    const schedule = () => { if (!frame) frame = window.setTimeout(send, 16); };
    send();
    const resize = new ResizeObserver(schedule);
    resize.observe(element); resize.observe(document.documentElement);
    // 막대가 접히거나 대화상자·메뉴가 열리면 자리나 덮인 상태가 바뀐다.
    const changes = new MutationObserver(schedule);
    changes.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'class', 'style', 'aria-modal', 'data-scroll-hidden'] });
    window.addEventListener('resize', schedule);
    return () => {
      window.clearTimeout(frame); resize.disconnect(); changes.disconnect();
      window.removeEventListener('resize', schedule);
      bridge.postMessage({ type: 'article', url: null });
    };
  }, [slot, url, zoom]);
}

/** 맥 앱이 보낸 실제 배율. 계정 설정이나 기사 글자 크기에 섞어 저장하지 않는다. */
export function nativeAppScale(host: { feedexAppScale?: number } = globalThis as { feedexAppScale?: number }): number {
  const scale = host.feedexAppScale;
  return typeof scale === 'number' && Number.isFinite(scale) && scale >= 0.5 && scale <= 1.5 ? scale : 0.9;
}
const subscribeAppScale = (changed: () => void) => {
  window.addEventListener('feedex-app-scale', changed);
  return () => window.removeEventListener('feedex-app-scale', changed);
};
export const useNativeAppScale = () => useSyncExternalStore(subscribeAppScale, nativeAppScale, () => 0.9);
