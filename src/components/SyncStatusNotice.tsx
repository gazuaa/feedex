import { CloudOff, RefreshCw, CircleCheck, CircleAlert } from 'lucide-react';
import { checkedTime, type SyncStatus } from '../client/syncStatus';

export function SyncStatusNotice({ status, busy = false }: { status: SyncStatus; busy?: boolean }) {
  const last = status.lastChecked ? `${checkedTime(status.lastChecked)} 확인` : '아직 확인하지 못했어요';
  const warning = !status.online || status.failed;
  const Icon = !status.online ? CloudOff : status.failed ? CircleAlert : busy ? RefreshCw : CircleCheck;
  return <div className="feedex-mobile-sync-status" data-warning={warning || undefined} aria-live={warning ? 'polite' : 'off'}>
    <Icon size={12} aria-hidden="true" className={busy && status.online && !status.failed ? 'animate-spin' : undefined} />
    <span>{!status.online ? '오프라인 · 저장된 글을 보여드려요' : status.failed ? `새로고침 실패 · ${last}` : busy ? '새 글 확인 중…' : status.lastChecked ? `마지막 확인 ${checkedTime(status.lastChecked)}` : '확인한 기록이 없어요'}</span>
    {!status.online && status.lastChecked && <small>{last}</small>}
  </div>;
}
