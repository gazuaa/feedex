import { useEffect, useRef, useState } from 'react';
import { maintainDeviceCache } from '../client/deviceContent';
import { retentionDays, RETENTION_OPTIONS, setRetentionDays } from '../client/cachePolicy';

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
  const size = bytes === null ? '확인 중…' : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  // 보관 기간, 사용 용량, 지우기를 한 줄에 둔다. 보관 기간은 선택지에 '보관'을 붙여 따로 설명하지 않는다.
  return <div ref={ref} className="feedex-cache-settings">
    <div className="feedex-auto-refresh-setting" title="목록과 본문을 기기에 두고 바로 열어요">
      <span>기기 캐시<small><output aria-label="기기 캐시 사용 용량">{size}</output></small></span>
      <div className="feedex-cache-controls">
        <select aria-label="기기 데이터 보관 기간" value={days} onChange={(event) => {
          const value = Number(event.target.value); setRetentionDays(accountId, value); setDays(value); void maintainDeviceCache(accountId).then((stats) => setBytes(stats.bytes));
        }}>{RETENTION_OPTIONS.map((value) => <option key={value} value={value}>{value}일 보관</option>)}</select>
        <button type="button" className="feedex-cache-clear" aria-label="캐시 지우기" disabled={confirm} onClick={() => setConfirm(true)}>지우기</button>
      </div>
    </div>
    {confirm && <div className="feedex-cache-confirm"><p>이 계정의 기기 캐시를 지울까요? 구독과 저장한 글은 그대로예요.</p><div className="feedex-cache-actions"><button disabled={busy} onClick={() => setConfirm(false)}>취소</button><button data-danger disabled={busy} onClick={() => void clear()}>{busy ? '지우는 중…' : '지우기'}</button></div></div>}
  </div>;
}
