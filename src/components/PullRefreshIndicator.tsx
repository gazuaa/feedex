import { RefreshCw } from 'lucide-react';
import { PULL_REFRESH_THRESHOLD } from '../client/pullRefresh';

export function PullRefreshIndicator({ distance, refreshing }: { distance: number; refreshing: boolean }) {
  if (!distance && !refreshing) return null;
  const ready = distance >= PULL_REFRESH_THRESHOLD;
  return <div className="feedex-pull-refresh" role="status" aria-live="polite" style={{ transform: `translate(-50%, ${refreshing ? 16 : Math.min(distance, 64) / 2}px)` }}>
    <RefreshCw size={18} className={refreshing ? 'animate-spin motion-reduce:animate-none' : undefined} style={refreshing ? undefined : { transform: `rotate(${distance * 3}deg)` }} />
    <span>{refreshing ? '새로고침 중…' : ready ? '놓으면 새로고침' : '당겨서 새로고침'}</span>
  </div>;
}
