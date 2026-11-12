import { useLayoutEffect, useSyncExternalStore, type RefObject } from 'react';

// 데스크톱 앱 안에서 열렸을 때만 있는 연결. 크롬 앱이나 일반 브라우저에는 없다.
// 맥 앱은 WKWebView에 'feedex' 메시지 통로를 만들고, 윈도우 앱은 WebView2의 chrome.webview 통로에
// 윈도우 앱이라는 표시(feedexWindowsApp)를 함께 둔다. 두 앱은 같은 메시지를 받는다.
export type NativeRect = { x: number; y: number; width: number; height: number };
export type NativeMessage =
  | { type: 'signIn' }
  | { type: 'checkForUpdates' }
  | { type: 'appScale'; action: 'smaller' | 'larger' | 'reset' }
  | { type: 'article'; url: string | null; rect?: NativeRect; zoom?: number; hidden?: boolean }
  | { type: 'openExternal'; url: string };
interface NativeBridge { postMessage(message: NativeMessage): void }
/** 윈도우 앱이 주고받는 통로. 보낼 때는 어느 통로인지(channel) 붙이고, 답은 message 이벤트로 받는다. */
export interface WindowsWebView {
  postMessage(message: unknown): void;
  addEventListener?(type: 'message', listener: (event: { data: unknown }) => void): void;
}
export type BridgeHost = {
  webkit?: { messageHandlers?: { feedex?: Partial<NativeBridge> } };
  chrome?: { webview?: Partial<WindowsWebView> };
  feedexWindowsApp?: unknown;
};
export type NativePlatform = 'mac' | 'windows';

/** 윈도우 앱의 통로. 앱이 문서마다 넣는 표시가 있을 때만 쓴다. WebView2를 쓰는 다른 프로그램은 해당하지 않는다. */
export function windowsWebView(host: BridgeHost = globalThis as BridgeHost): WindowsWebView | null {
  const view = host.chrome?.webview;
  return host.feedexWindowsApp === true && typeof view?.postMessage === 'function' ? view as WindowsWebView : null;
}
export function nativePlatform(host: BridgeHost = globalThis as BridgeHost): NativePlatform | null {
  if (typeof host.webkit?.messageHandlers?.feedex?.postMessage === 'function') return 'mac';
  return windowsWebView(host) ? 'windows' : null;
}
export function nativeBridge(host: BridgeHost = globalThis as BridgeHost): NativeBridge | null {
  const handler = host.webkit?.messageHandlers?.feedex;
  if (handler && typeof handler.postMessage === 'function') return handler as NativeBridge;
  const view = windowsWebView(host);
  return view ? { postMessage: (message) => view.postMessage({ channel: 'feedex', body: message }) } : null;
}
export const inNativeApp = (host?: BridgeHost) => Boolean(nativeBridge(host));
/** 화면에 쓰는 앱 이름과 운영체제 이름. */
export const nativeAppName = (platform: NativePlatform | null = nativePlatform()) => platform === 'windows' ? '윈도우 앱' : '맥 앱';
export const nativeSystemName = (platform: NativePlatform | null = nativePlatform()) => platform === 'windows' ? 'Windows' : 'macOS';
/** 데스크톱 앱이 연 시스템 로그인 창(맥은 Safari, 윈도우는 기본 브라우저) 안인지. 이 창에서는 로그인한 계정을 앱에 넘기기만 한다. */
export const inNativeSignInWindow = (search = typeof location === 'undefined' ? '' : location.search) => new URLSearchParams(search).has('native-sign-in');
/** 로그인을 넘길 앱. 윈도우 앱은 native-sign-in=windows로 연다. */
export const nativeSignInPlatform = (search = typeof location === 'undefined' ? '' : location.search): NativePlatform => new URLSearchParams(search).get('native-sign-in') === 'windows' ? 'windows' : 'mac';
/**
 * 윈도우 앱이 로그인을 시작할 때 붙인 상태 값. 아무 웹사이트나 앱 주소를 열 수 있으므로, 앱은 이 값이 함께 돌아올 때만
 * 코드를 받는다. 모양이 다르면 넘기지 않는다.
 */
export function nativeSignInState(search = typeof location === 'undefined' ? '' : location.search): string | null {
  const state = new URLSearchParams(search).get('state');
  return state && /^[0-9a-f]{64}$/.test(state) ? state : null;
}
/** 시스템 로그인 창이 앱으로 돌려보내는 주소. 상태 값이 있으면 그대로 돌려준다. */
export function nativeSignInCallback(code: string, state: string | null) {
  return `feedex-reader://signed-in?code=${encodeURIComponent(code)}${state ? `&state=${state}` : ''}`;
}

// 웹 보기 자리를 가리는 창들. 앱의 원문 화면은 웹 화면 위에 놓이므로, 이것들이 열리면 원문 화면을 잠시 숨긴다.
// 좁은 창에서 쓰는 글 화면 메뉴(본문 도구, 번역·요약, 공유)도 원문 화면 위로 펼쳐지므로 함께 넣는다.
export const NATIVE_COVERS = 'dialog[open], [aria-modal="true"], .feedex-desktop-settings[open], .feedex-mobile-settings[open], .feedex-context-menu, .feedex-desktop-share-menu, .feedex-mobile-reader-menu';

/**
 * 웹 보기 자리의 위치와 덮인 상태. 앱은 이 자리에 로그인이 유지되는 원문 화면을 겹쳐 띄운다.
 * 창이 가려져도 숨기지 않는다. 원문 화면도 함께 가려지고, 숨겼다 다시 띄우면 깜빡이기만 한다.
 */
export function articlePlacement(slot: Pick<Element, 'getBoundingClientRect'>, doc: Pick<Document, 'querySelector'>, url: string, zoom: number): Extract<NativeMessage, { type: 'article' }> {
  const box = slot.getBoundingClientRect();
  const hidden = box.width < 1 || box.height < 1 || Boolean(doc.querySelector(NATIVE_COVERS));
  return { type: 'article', url, zoom, hidden, rect: { x: Math.round(box.left), y: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) } };
}

/** 원문 화면 왼쪽에 알림을 띄울 공간이 있는 경우의 너비. */
export const nativeNoticeLeft = (left: number) => left >= 320 ? `${Math.round(left)}px` : '';
const setNoticePlacement = (rect?: NativeRect) => {
  const root = document.documentElement;
  const slot = rect && rect.width > 0 && rect.height > 0 ? rect : undefined;
  const left = slot ? nativeNoticeLeft(slot.x) : '';
  if (left !== root.style.getPropertyValue('--feedex-native-left')) {
    if (left) root.style.setProperty('--feedex-native-left', left);
    else root.style.removeProperty('--feedex-native-left');
  }
  root.toggleAttribute('data-feedex-native-notice-above', Boolean(slot && !left));
};

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
      setNoticePlacement(message.rect);
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
      setNoticePlacement();
      bridge.postMessage({ type: 'article', url: null });
    };
  }, [slot, url, zoom]);
}

/** 앱이 보낸 실제 배율. 계정 설정이나 기사 글자 크기에 섞어 저장하지 않는다. */
export function nativeAppScale(host: { feedexAppScale?: number } = globalThis as { feedexAppScale?: number }): number {
  const scale = host.feedexAppScale;
  return typeof scale === 'number' && Number.isFinite(scale) && scale >= 0.5 && scale <= 1.5 ? scale : 0.9;
}
const subscribeAppScale = (changed: () => void) => {
  window.addEventListener('feedex-app-scale', changed);
  return () => window.removeEventListener('feedex-app-scale', changed);
};
export const useNativeAppScale = () => useSyncExternalStore(subscribeAppScale, nativeAppScale, () => 0.9);
