import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from './api';
import { parseExcludedFeeds } from '../shared/feedExclusions';

const key = (account: string) => `feedex:excluded-feeds:${account}`;
function cached(account: string): string[] {
  try { return account ? parseExcludedFeeds(localStorage.getItem(key(account))) : []; } catch { return []; }
}
function remember(account: string, feedIds: string[]) {
  try { localStorage.setItem(key(account), JSON.stringify(feedIds)); } catch { /* Storage can be unavailable. */ }
}

export function useFeedExclusions(account: string) {
  const initial = useMemo(() => cached(account), [account]);
  const [state, setState] = useState(() => ({ account, feedIds: cached(account) }));
  const current = useRef(account), generation = useRef(0);
  current.current = account;
  useEffect(() => {
    let active = true;
    let lastFetch = 0;
    const refresh = async () => {
      if (!account || document.visibilityState === 'hidden' || Date.now() - lastFetch < 30_000) return;
      lastFetch = Date.now();
      const version = generation.current;
      try {
        const data = await apiRequest<{ feedIds: string[] }>('/api/user/feed-exclusions');
        if (!active || current.current !== account || version !== generation.current) return;
        const feedIds = parseExcludedFeeds(data.feedIds);
        remember(account, feedIds); setState(previous => previous.account === account && JSON.stringify(previous.feedIds) === JSON.stringify(feedIds) ? previous : { account, feedIds });
      } catch { /* Keep the account's cached filter when offline. */ }
    };
    void refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [account]);
  const save = useCallback(async (ids: string[]) => {
    if (!account) throw new Error('다시 로그인해 주세요.');
    generation.current++;
    const data = await apiRequest<{ feedIds: string[] }>('/api/user/feed-exclusions', { method: 'PUT', body: JSON.stringify({ feedIds: parseExcludedFeeds(ids) }) });
    const feedIds = parseExcludedFeeds(data.feedIds);
    remember(account, feedIds);
    if (current.current === account) setState({ account, feedIds });
  }, [account]);
  return { feedIds: state.account === account ? state.feedIds : initial, save };
}
