import { useEffect, useRef, useState } from 'react';
import { HardDrive, Trash2 } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';
import { SettingLabel } from './SettingLabel';
import { maintainDeviceCache } from '../client/deviceContent';
import { retentionDays, RETENTION_OPTIONS, setRetentionDays } from '../client/cachePolicy';
import { t } from '../shared/i18n';

export function CacheSettings({ accountId, active: visible = false }: { accountId: string; active?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [days, setDays] = useState(() => retentionDays(accountId));
  const [bytes, setBytes] = useState<number | null>(null), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false);
  useEffect(() => {
    let active = true;
    const update = () => { if ((visible || ref.current?.closest<HTMLDetailsElement | HTMLDialogElement>('details,dialog')?.open) && document.visibilityState !== 'hidden') void maintainDeviceCache(accountId).then((value) => { if (active) setBytes(value.bytes); }); };
    update(); const timer = setInterval(update, 10000); document.addEventListener('toggle', update, true);
    return () => { active = false; clearInterval(timer); document.removeEventListener('toggle', update, true); };
  }, [accountId, visible]);
  const clear = async () => {
    setBusy(true);
    window.dispatchEvent(new CustomEvent('sfeed-cache-cleared', { detail: accountId }));
    await maintainDeviceCache(accountId, true); setBytes(0); setBusy(false); setConfirm(false);
  };
  const size = bytes === null ? t('확인 중…', 'Checking…') : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  // 보관 기간, 사용 용량, 지우기를 한 줄에 둔다. 보관 기간은 선택지에 '보관'을 붙여 따로 설명하지 않는다.
  return <div ref={ref} className="feedex-cache-settings">
    <div className="feedex-auto-refresh-setting" title={t('목록과 본문을 이 기기에 저장해 두고 바로 열어요', 'Keeps lists and articles on this device so they open instantly')}>
      <SettingLabel icon={HardDrive}>{t('저장 공간', 'Storage')}<small><output aria-label={t('기기 캐시 사용 용량', 'Device cache usage')}>{size}</output>{bytes !== null && t(' 사용', ' used')}</small></SettingLabel>
      <div className="feedex-cache-controls">
        <select aria-label={t('기기 데이터 보관 기간', 'How long to keep data on this device')} value={days} onChange={(event) => {
          const value = Number(event.target.value); setRetentionDays(accountId, value); setDays(value); void maintainDeviceCache(accountId).then((stats) => setBytes(stats.bytes));
        }}>{RETENTION_OPTIONS.map((value) => <option key={value} value={value}>{t(`${value}일 보관`, `Keep ${value} days`)}</option>)}</select>
        <button type="button" className="feedex-icon-danger" aria-label={t('캐시 지우기', 'Clear cache')} disabled={confirm} onClick={() => setConfirm(true)}><Trash2 size={16} /></button>
      </div>
    </div>
    {confirm && <ConfirmDialog title={t('저장 공간 지우기', 'Clear storage')} confirmLabel={t('지우기', 'Clear')} busyLabel={t('지우는 중…', 'Clearing…')} tone="danger" isDark={document.documentElement.classList.contains('dark')} busy={busy} error={null} onCancel={() => setConfirm(false)} onConfirm={() => void clear()}>
      {t('이 계정의 기기 캐시를 지울까요? 구독과 저장한 글은 그대로예요.', 'Clear this account’s cache on this device? Your subscriptions and saved articles stay.')}
    </ConfirmDialog>}
  </div>;
}
