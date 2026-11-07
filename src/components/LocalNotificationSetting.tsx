import { useState } from 'react';
import { inNativeApp, nativeBridge } from '../client/nativeApp';
import { nativeNotificationBridge, openNativeNotificationSettings } from '../client/nativeNotifications';
import { enableLocalNotifications, setLocalNotifications, useLocalNotifications, useNotificationPermission } from '../client/localNotifications';

export function LocalNotificationSetting({ accountId }: { accountId?: string }) {
  const enabled = useLocalNotifications(accountId ?? '');
  const permission = useNotificationPermission(), native = inNativeApp(), needsUpdate = native && !nativeNotificationBridge();
  const [pending, setPending] = useState(false), [message, setMessage] = useState('');
  if (!accountId) return null;
  return <div><label className="feedex-scroll-read-setting"><span>새 글 제목 알림<small>앱이 열려 있는 동안 이 기기에서만 알려요</small></span><input type="checkbox" role="switch" aria-label="새 글 제목 알림" checked={enabled} disabled={pending} onChange={async (event) => {
    if (!event.target.checked) { setLocalNotifications(accountId, false); setMessage(''); return; }
    setPending(true);
    try { setMessage(await enableLocalNotifications(accountId)); } catch { setMessage('알림 권한을 확인해 주세요.'); }
    finally { setPending(false); }
  }} /></label>{message && <p className="feedex-setting-message" role="status">{message}</p>}{needsUpdate && <p className="feedex-setting-message">맥 알림을 사용하려면 앱을 업데이트해 주세요. <button type="button" className="feedex-cache-clear" onClick={() => nativeBridge()?.postMessage({ type: 'checkForUpdates' })}>업데이트 확인</button></p>}{native && !needsUpdate && permission !== 'granted' && <button type="button" className="feedex-cache-clear" disabled={pending} onClick={async () => {
    if (permission === 'denied') { await openNativeNotificationSettings(); return; }
    setPending(true);
    try { setMessage(await enableLocalNotifications(accountId)); } catch { setMessage('알림 권한을 확인해 주세요.'); } finally { setPending(false); }
  }}>{permission === 'denied' ? 'macOS 알림 설정 열기' : '알림 허용 창 열기'}</button>}</div>;
}
