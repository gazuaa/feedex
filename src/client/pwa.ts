import { useSyncExternalStore } from 'react';
import { inNativeApp, inNativeSignInWindow } from './nativeApp';

export function installPlatform(userAgent: string, maxTouchPoints = 0): 'ios' | 'android' | 'mac-safari' | 'desktop' {
  if (/iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(userAgent)) return 'android';
  if (/Macintosh/.test(userAgent) && /Safari/.test(userAgent) && !/Chrome|Chromium|Edg|Brave/.test(userAgent)) return 'mac-safari';
  return 'desktop';
}

// 다른 브라우저로는 공개 앱 주소만 넘긴다. 로그인 토큰이나 지금 페이지의
// 비공개 경로·쿼리 정보는 절대 넘기지 않는다.
export const installAddress = (address: string) => new URL('/', address).href;

export function isIOSSafari(browser: { userAgent: string; maxTouchPoints?: number; standalone?: boolean; brave?: unknown }): boolean {
  const named = /CriOS|FxiOS|EdgiOS|OPiOS|Brave|Whale|SamsungBrowser|NAVER|DaumApps|KAKAOTALK|Instagram|FBAN|FBAV|Line/i.test(browser.userAgent);
  return installPlatform(browser.userAgent, browser.maxTouchPoints) === 'ios' && typeof browser.standalone !== 'undefined' && !named && !browser.brave;
}

// MUUSED와 같은 넘기기 방식: 동기적으로 이동하기 전에 복사를 시작해서
// Safari 스킴이 사용자의 탭을 유지하게 한다. 브라우저 전환이 보장되지는 않으므로
// 페이지를 떠나는 이벤트가 없을 때만 직접 하는 방법을 보여 준다.
export function openInSafari(onStuck: (copied: boolean) => void): () => void {
  const address = installAddress(window.location.href);
  let copied = false;
  let left = false;
  const markLeft = () => { left = true; };
  try { void navigator.clipboard?.writeText(address).then(() => { copied = true; }).catch(() => {}); } catch { /* 직접 복사하는 방법은 그대로 쓸 수 있다 */ }
  document.addEventListener('visibilitychange', markLeft, { once: true });
  window.addEventListener('pagehide', markLeft, { once: true });
  const cleanup = () => { document.removeEventListener('visibilitychange', markLeft); window.removeEventListener('pagehide', markLeft); clearTimeout(timer); };
  const timer = setTimeout(() => { cleanup(); if (!left) onStuck(copied); }, 1400);
  try { window.location.href = `x-safari-${address}`; } catch { /* 지원하지 않는 스킴은 시간이 지나면 대체 안내를 쓴다 */ }
  return cleanup;
}

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let deferred: InstallEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const standalone = () => typeof window !== 'undefined' && (installed || window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); deferred = event as InstallEvent; notify(); });
  window.addEventListener('appinstalled', () => { installed = true; deferred = null; notify(); });
  window.matchMedia('(display-mode: standalone)').addEventListener('change', notify);
}
// 맥 앱(FeedEx for Mac) 안과 맥 앱의 로그인 창에서는 설치 안내를 띄우지 않는다.
export function installState() { return standalone() || inNativeApp() || inNativeSignInWindow() ? 'installed' : deferred ? 'prompt' : 'manual'; }
export function useInstallState() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, installState, () => 'manual');
}
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null;
  notify();
  try {
    await event.prompt();
    if ((await event.userChoice).outcome === 'accepted') { installed = true; notify(); }
    return true;
  } catch { return false; }
}
let cancelHandoff: (() => void) | null = null;
export function openInstallHelp() {
  cancelHandoff?.();
  if (installPlatform(navigator.userAgent, navigator.maxTouchPoints) === 'ios' && !isIOSSafari(navigator)) {
    cancelHandoff = openInSafari((copied) => window.dispatchEvent(new CustomEvent('sfeed:install', { detail: { safariFailed: true, copied } })));
  } else window.dispatchEvent(new Event('sfeed:install'));
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const register = () => { void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {}); };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
