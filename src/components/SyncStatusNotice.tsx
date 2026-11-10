import { CloudOff, CircleAlert } from 'lucide-react';
import type { SyncStatus } from '../client/syncStatus';

export function SyncStatusNotice({ status }: { status: SyncStatus }) {
  if (status.online && !status.failed) return null;
  const Icon = status.online ? CircleAlert : CloudOff;
  return <div className="feedex-mobile-sync-status" role="status">
    <Icon size={12} aria-hidden="true" />
    <span>{status.online ? '새로고침 실패' : '오프라인 · 저장된 글을 보여드려요'}</span>
  </div>;
}
