// 데스크톱 앱의 알림은 웹 화면의 브라우저 알림 대신 앱의 전용 통로로 보낸다.
// 맥 앱은 답을 돌려주는 WKWebView 통로를, 윈도우 앱은 번호를 붙인 메시지와 답장을 쓴다.
import { windowsWebView, type BridgeHost, type WindowsWebView } from './nativeApp';

type NotificationTarget = { account: string; articleId: string };
type NativeNotificationMessage =
  | { action: 'status' | 'request' | 'settings' }
  | { action: 'takeOpen'; account: string }
  | ({ action: 'show'; title: string; body: string } & NotificationTarget);
interface NativeNotificationReply { permission?: NotificationPermission; target?: NotificationTarget }
interface NotificationBridge { postMessage(message: NativeNotificationMessage): Promise<NativeNotificationReply> }
type Host = BridgeHost & { webkit?: { messageHandlers?: { feedexNotifications?: Partial<NotificationBridge> } } };
export function nativeNotificationBridge(host: Host = globalThis as Host): NotificationBridge | null {
  const handler = host.webkit?.messageHandlers?.feedexNotifications;
  if (typeof handler?.postMessage === 'function') return handler as NotificationBridge;
  const view = windowsWebView(host);
  return view && typeof view.addEventListener === 'function' ? windowsNotificationBridge(view) : null;
}

type Waiting = { resolve: (reply: NativeNotificationReply) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
const bridges = new WeakMap<WindowsWebView, NotificationBridge>();
let nextRequest = 0;
/** 윈도우 앱: 요청마다 번호를 붙여 보내고, 앱이 같은 번호로 보낸 답을 기다린다. 답이 없으면 10초 뒤에 포기한다. */
function windowsNotificationBridge(view: WindowsWebView): NotificationBridge {
  const known = bridges.get(view);
  if (known) return known;
  const waiting = new Map<number, Waiting>();
  view.addEventListener!('message', ({ data }) => {
    const reply = data as { channel?: unknown; id?: unknown; result?: NativeNotificationReply; error?: unknown } | null;
    if (!reply || reply.channel !== 'notifications' || typeof reply.id !== 'number') return;
    const entry = waiting.get(reply.id);
    if (!entry) return;
    waiting.delete(reply.id); clearTimeout(entry.timer);
    if (reply.error) entry.reject(new Error(String(reply.error))); else entry.resolve(reply.result ?? {});
  });
  const bridge: NotificationBridge = {
    postMessage: (message) => new Promise((resolve, reject) => {
      const id = ++nextRequest;
      const timer = setTimeout(() => { waiting.delete(id); reject(new Error('앱이 알림 요청에 답하지 않았습니다.')); }, 10_000);
      waiting.set(id, { resolve, reject, timer });
      view.postMessage({ channel: 'notifications', id, body: message });
    }),
  };
  bridges.set(view, bridge);
  return bridge;
}

let permission: NotificationPermission = 'default', revision = 0;
let flight: Promise<NotificationPermission> | null = null;
const listeners = new Set<() => void>();
export const nativeNotificationPermission = () => permission;
const update = (next: unknown) => {
  if (next !== 'default' && next !== 'denied' && next !== 'granted') throw new Error('알림 권한을 확인하지 못했습니다.');
  if (permission !== next) { permission = next; listeners.forEach((listener) => listener()); }
  return permission;
};
export function refreshNativeNotificationPermission(): Promise<NotificationPermission> {
  const bridge = nativeNotificationBridge();
  if (!bridge) return Promise.resolve('default');
  if (!flight) {
    const current = revision;
    flight = bridge.postMessage({ action: 'status' }).then((result) => current === revision ? update(result.permission) : permission).finally(() => { flight = null; });
  }
  return flight;
}
export async function requestNativeNotificationPermission(): Promise<NotificationPermission> {
  const bridge = nativeNotificationBridge(); if (!bridge) throw new Error('앱을 업데이트해 주세요.');
  revision++;
  return update((await bridge.postMessage({ action: 'request' })).permission);
}
export function subscribeNativeNotificationPermission(listener: () => void) {
  const refresh = () => { void refreshNativeNotificationPermission().catch(() => {}); };
  listeners.add(listener);
  window.addEventListener('focus', refresh);
  window.addEventListener('feedex-notification-permission', refresh);
  refresh();
  return () => { listeners.delete(listener); window.removeEventListener('focus', refresh); window.removeEventListener('feedex-notification-permission', refresh); };
}
export const openNativeNotificationSettings = () => nativeNotificationBridge()?.postMessage({ action: 'settings' });
