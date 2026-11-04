import { useState } from 'react';
import { enableLocalNotifications, setLocalNotifications, useLocalNotifications } from '../client/localNotifications';

export function LocalNotificationSetting({ accountId }: { accountId?: string }) {
  const enabled = useLocalNotifications(accountId ?? '');
  const [pending, setPending] = useState(false), [message, setMessage] = useState('');
  if (!accountId) return null;
  return <div><label className="feedex-scroll-read-setting"><span>새 글 제목 알림<small>앱이 열려 있는 동안 이 기기에서만 알려요</small></span><input type="checkbox" role="switch" aria-label="새 글 제목 알림" checked={enabled} disabled={pending} onChange={async (event) => {
    if (!event.target.checked) { setLocalNotifications(accountId, false); setMessage(''); return; }
    setPending(true);
    try { setMessage(await enableLocalNotifications(accountId)); } catch { setMessage('알림 권한을 확인해 주세요.'); }
    finally { setPending(false); }
  }} /></label>{message && <p className="feedex-setting-message" role="status">{message}</p>}</div>;
}
