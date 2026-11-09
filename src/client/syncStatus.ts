import { useEffect, useState } from 'react';
import { getStoredToken } from './api';

export interface SyncStatus { online: boolean; lastChecked: number | null; failed: boolean }
const storageKey = (account: string) => `feedex:last-check:${account}`;
function savedTime(account: string): number | null {
  try { const value = Number(localStorage.getItem(storageKey(account))); return value > 0 && Number.isFinite(value) ? value : null; } catch { return null; }
}
const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;

export function useSyncStatus(account: string): SyncStatus {
  const token = getStoredToken();
  const [state, setState] = useState(() => ({ account, online: online(), lastChecked: savedTime(account), failed: false }));
  useEffect(() => {
    setState({ account, online: online(), lastChecked: savedTime(account), failed: false });
    const connectivity = () => setState(previous => ({ ...previous, online: online(), failed: online() ? false : previous.failed }));
    const result = (event: Event) => {
      const value = (event as CustomEvent).detail;
      // 다른 계정이나 이미 끝난 로그인 세션의 응답은 현재 표시를 바꾸지 않는다.
      if (!account || value?.token !== token || token !== getStoredToken() || typeof value.ok !== 'boolean' || !Number.isFinite(value.at)) return;
      if (value.ok) { try { localStorage.setItem(storageKey(account), String(value.at)); } catch { /* 저장 공간이 없어도 현재 상태는 표시한다. */ } }
      setState(previous => ({ account, online: online(), lastChecked: value.ok ? value.at : previous.lastChecked, failed: !value.ok }));
    };
    window.addEventListener('online', connectivity); window.addEventListener('offline', connectivity); window.addEventListener('feedex-sync-status', result);
    return () => { window.removeEventListener('online', connectivity); window.removeEventListener('offline', connectivity); window.removeEventListener('feedex-sync-status', result); };
  }, [account, token]);
  return state.account === account ? state : { online: online(), lastChecked: savedTime(account), failed: false };
}

export function checkedTime(value: number): string {
  const date = new Date(value), today = new Date();
  const time = date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  return date.toDateString() === today.toDateString() ? time : `${date.getMonth() + 1}.${date.getDate()} ${time}`;
}
