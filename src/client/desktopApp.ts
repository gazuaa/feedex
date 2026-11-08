import { useSyncExternalStore } from 'react';

export type DesktopApp = 'mac' | 'windows';

// 브라우저는 데스크톱 앱이 설치됐는지 알려 주지 않고, 앱이 없으면 앱 주소를 열어도 아무 반응이 없다.
// 그래서 이 브라우저에서 앱이 실제로 열렸거나, 앱의 로그인 창으로 이 브라우저가 쓰인 적이 있을 때만 '앱으로 열기'를 앞에 둔다.
const key = (app: DesktopApp) => `sfeed:desktop-app:${app}`;
const listeners = new Set<() => void>();
const storage = (): Pick<Storage, 'getItem' | 'setItem'> | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

export function knownDesktopApp(app: DesktopApp): boolean {
  try { return storage()?.getItem(key(app)) === '1'; } catch { return false; }
}
export function rememberDesktopApp(app: DesktopApp) {
  try { storage()?.setItem(key(app), '1'); } catch { /* 저장하지 못하면 다음에도 설치 안내부터 보여 준다 */ }
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => { listeners.delete(listener); window.removeEventListener('storage', listener); };
};
export function useKnownDesktopApp(app: DesktopApp | null): boolean {
  // 이 앱은 서버에서 그리지 않으므로 서버용 값도 같은 저장소를 읽는다(테스트의 정적 렌더링도 같은 결과를 본다).
  const read = () => Boolean(app && knownDesktopApp(app));
  return useSyncExternalStore(subscribe, read, read);
}

type LaunchHost = Pick<Window, 'addEventListener' | 'removeEventListener' | 'setTimeout' | 'clearTimeout'> & {
  location: { href: string };
  document: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
};
/** 앱이 열렸는지 기다리는 시간. 브라우저의 '열까요?' 창도 이 안에 뜬다. */
export const LAUNCH_WAIT_MS = 1500;

/**
 * 앱 주소를 열고 앱이 열렸는지 본다. 앱이 열리거나 브라우저가 '앱을 열까요?'를 물으면 페이지가 포커스를 잃는다.
 * 기다리는 동안 그런 일이 없으면 앱이 없는 것으로 보고 onMissing을 부른다. 열린 것이 보이면 이 브라우저에 기억해 둔다.
 */
export function launchDesktopApp(app: DesktopApp, address: string, onMissing: () => void, host: LaunchHost = window): () => void {
  let left = false;
  const mark = () => { left = true; };
  const cleanup = () => {
    host.removeEventListener('blur', mark); host.removeEventListener('pagehide', mark);
    host.document.removeEventListener('visibilitychange', mark);
    host.clearTimeout(timer);
  };
  host.addEventListener('blur', mark); host.addEventListener('pagehide', mark);
  host.document.addEventListener('visibilitychange', mark);
  const timer = host.setTimeout(() => {
    cleanup();
    if (left || host.document.visibilityState === 'hidden') rememberDesktopApp(app); else onMissing();
  }, LAUNCH_WAIT_MS);
  host.location.href = address;
  return cleanup;
}
