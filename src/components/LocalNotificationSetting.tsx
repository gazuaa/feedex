import { useState } from 'react';
import { Bell } from 'lucide-react';
import { SettingLabel } from './SettingLabel';
import { inNativeApp, nativeBridge, nativeSystemName } from '../client/nativeApp';
import { nativeNotificationBridge, openNativeNotificationSettings } from '../client/nativeNotifications';
import { enableLocalNotifications, setLocalNotifications, useLocalNotifications, useNotificationPermission } from '../client/localNotifications';
import { t } from '../shared/i18n';

export function LocalNotificationSetting({ accountId }: { accountId?: string }) {
  const enabled = useLocalNotifications(accountId ?? '');
  const permission = useNotificationPermission(), native = inNativeApp(), needsUpdate = native && !nativeNotificationBridge(), system = nativeSystemName();
  const [pending, setPending] = useState(false), [message, setMessage] = useState('');
  if (!accountId) return null;
  // 스위치를 켜면 허용 창이 뜬다. 허용하지 않았을 때만 설명 아래에 다시 여는 링크를 둔다.
  const allow = async () => {
    if (permission === 'denied') { await openNativeNotificationSettings(); return; }
    setPending(true);
    try { setMessage(await enableLocalNotifications(accountId)); } catch { setMessage(t('알림 권한을 확인해 주세요.', 'Check the notification permission.')); } finally { setPending(false); }
  };
  const askNative = native && !needsUpdate && permission !== 'granted';
  return <div><label className="feedex-scroll-read-setting" title={t('앱이 열려 있는 동안 이 기기에서만 새 글 제목을 알려요', 'While the app is open, this device shows titles of new articles')}><SettingLabel icon={Bell}>{t('새 글 알림', 'New article alerts')}</SettingLabel><input type="checkbox" role="switch" aria-label={t('새 글 알림', 'New article alerts')} checked={enabled} disabled={pending} onChange={async (event) => {
    if (!event.target.checked) { setLocalNotifications(accountId, false); setMessage(''); return; }
    setPending(true);
    try { setMessage(await enableLocalNotifications(accountId)); } catch { setMessage(t('알림 권한을 확인해 주세요.', 'Check the notification permission.')); }
    finally { setPending(false); }
  }} /></label>
    {needsUpdate && <p className="feedex-setting-message">{t(`${system} 알림을 쓰려면 앱을 업데이트해 주세요.`, `Update the app to use ${system} notifications.`)} <button type="button" className="feedex-setting-link" onClick={() => nativeBridge()?.postMessage({ type: 'checkForUpdates' })}>{t('업데이트 확인', 'Check for updates')}</button></p>}
    {askNative
      ? <p className="feedex-setting-message" role="status">{message || (permission === 'denied' ? t(`${system} 알림 설정에서 feedex를 허용해야 알림이 와요.`, `Allow feedex in ${system} notification settings to get alerts.`) : t(`켜면 ${system} 허용 창이 떠요.`, `Turning this on asks ${system} for permission.`))} <button type="button" className="feedex-setting-link" disabled={pending} onClick={() => { void allow(); }}>{permission === 'denied' ? t(`${system} 알림 설정 열기`, `Open ${system} notification settings`) : t('알림 허용 창 열기', 'Ask for permission')}</button></p>
      : message && <p className="feedex-setting-message" role="status">{message}</p>}
  </div>;
}
