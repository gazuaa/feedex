import { useEffect, useState } from 'react';
import { getStoredToken } from './api';

export interface SyncStatus { online: boolean; failed: boolean }
const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;

export function useSyncStatus(account: string): SyncStatus {
  const token = getStoredToken();
  const [state, setState] = useState(() => ({ account, online: online(), failed: false }));
  useEffect(() => {
    setState({ account, online: online(), failed: false });
    const connectivity = () => setState(previous => ({ ...previous, online: online(), failed: online() ? false : previous.failed }));
    const result = (event: Event) => {
      const value = (event as CustomEvent).detail;
      // 다른 계정이나 이미 끝난 로그인 세션의 응답은 현재 표시를 바꾸지 않는다.
      if (!account || value?.token !== token || token !== getStoredToken() || typeof value.ok !== 'boolean' || !Number.isFinite(value.at)) return;
      setState({ account, online: online(), failed: !value.ok });
    };
    window.addEventListener('online', connectivity); window.addEventListener('offline', connectivity); window.addEventListener('feedex-sync-status', result);
    return () => { window.removeEventListener('online', connectivity); window.removeEventListener('offline', connectivity); window.removeEventListener('feedex-sync-status', result); };
  }, [account, token]);
  return state.account === account ? state : { online: online(), failed: false };
}
