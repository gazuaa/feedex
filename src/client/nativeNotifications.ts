// macOS 알림은 WKWebView의 브라우저 알림 대신 앱의 전용 통로로 보낸다.
type NotificationTarget = { account: string; articleId: string };
type NativeNotificationMessage =
  | { action: 'status' | 'request' | 'settings' }
  | { action: 'takeOpen'; account: string }
  | ({ action: 'show'; title: string; body: string } & NotificationTarget);
interface NativeNotificationReply { permission?: NotificationPermission; target?: NotificationTarget }
interface NotificationBridge { postMessage(message: NativeNotificationMessage): Promise<NativeNotificationReply> }
type Host = { webkit?: { messageHandlers?: { feedexNotifications?: Partial<NotificationBridge> } } };
export function nativeNotificationBridge(host: Host = globalThis as Host): NotificationBridge | null {
  const handler = host.webkit?.messageHandlers?.feedexNotifications;
  return typeof handler?.postMessage === 'function' ? handler as NotificationBridge : null;
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
  const bridge = nativeNotificationBridge(); if (!bridge) throw new Error('맥 앱을 업데이트해 주세요.');
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
