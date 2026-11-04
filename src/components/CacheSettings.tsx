import { useEffect, useRef, useState } from 'react';
import { maintainDeviceCache } from '../client/deviceContent';
import { retentionDays, RETENTION_OPTIONS, setRetentionDays } from '../client/cachePolicy';

export function CacheSettings({ accountId }: { accountId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [days, setDays] = useState(() => retentionDays(accountId));
  const [bytes, setBytes] = useState<number | null>(null), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false);
  useEffect(() => {
    let active = true;
    const update = () => { if (ref.current?.closest('details')?.open && document.visibilityState !== 'hidden') void maintainDeviceCache(accountId).then((value) => { if (active) setBytes(value.bytes); }); };
    update(); const timer = setInterval(update, 10000); document.addEventListener('toggle', update, true);
    return () => { active = false; clearInterval(timer); document.removeEventListener('toggle', update, true); };
  }, [accountId]);
  const clear = async () => {
    setBusy(true);
    window.dispatchEvent(new CustomEvent('sfeed-cache-cleared', { detail: accountId }));
    await maintainDeviceCache(accountId, true); setBytes(0); setBusy(false); setConfirm(false);
  };
  return <div ref={ref} className="feedex-cache-settings">
    <label className="feedex-auto-refresh-setting"><span>데이터 보관<small>목록과 본문을 기기에 두고 바로 열어요</small></span><select aria-label="기기 데이터 보관 기간" value={days} onChange={(event) => {
      const value = Number(event.target.value); setRetentionDays(accountId, value); setDays(value); void maintainDeviceCache(accountId).then((stats) => setBytes(stats.bytes));
    }}>{RETENTION_OPTIONS.map((value) => <option key={value} value={value}>{value}일</option>)}</select></label>
    {confirm
      ? <div className="feedex-cache-confirm"><p>이 계정의 기기 캐시를 지울까요? 구독과 저장한 글은 그대로예요.</p><div className="feedex-cache-actions"><button disabled={busy} onClick={() => setConfirm(false)}>취소</button><button data-danger disabled={busy} onClick={() => void clear()}>{busy ? '지우는 중…' : '지우기'}</button></div></div>
      : <div className="feedex-cache-usage"><span>사용 중 <output aria-label="기기 캐시 사용 용량">{bytes === null ? '확인 중…' : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`}</output></span><button className="feedex-cache-clear" onClick={() => setConfirm(true)}>캐시 지우기</button></div>}
  </div>;
}
