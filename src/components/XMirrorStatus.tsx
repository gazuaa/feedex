import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../client/api';
import { Radio } from 'lucide-react';
import { SettingLabel } from './SettingLabel';
import { t } from '../shared/i18n';

export type MirrorState = 'ok' | 'limited' | 'failing' | 'stale' | 'unknown';
export interface MirrorStatus {
  provider: string; host: string; state: MirrorState;
  lastOkAt: number | null; failingSince: number | null; lastFailure: string | null; limitedUntil: number | null;
}
/** 3시간 넘게 받지 못한 X 계정(서버의 staleXAccounts). */
export interface StaleXAccount { handle: string; title: string; lastOkAt: string | null; error: string | null; failures: number; retryAt: number | null }
export interface MirrorConfig { canManage: boolean; mirrors?: MirrorStatus[]; staleAccounts?: StaleXAccount[]; staleTotal?: number }

/** 지난 시간을 짧게 적는다. 미래 시각은 '뒤'로 적는다. */
export function ago(at: number, now: number): string {
  const minutes = Math.floor(Math.abs(now - at) / 60_000), future = at > now;
  if (minutes < 1) return future ? t('곧', 'soon') : t('방금', 'just now');
  const hours = Math.round(minutes / 60);
  const amount = minutes < 60 ? t(`${minutes}분`, `${minutes} min`) : hours < 48 ? t(`${hours}시간`, `${hours} h`) : t(`${Math.round(hours / 24)}일`, `${Math.round(hours / 24)} days`);
  return future ? t(`${amount} 뒤`, `in ${amount}`) : t(`${amount} 전`, `${amount} ago`);
}

/** 미러 한 줄의 설명과, 확인이 필요한지. */
export function mirrorLine(mirror: MirrorStatus, now: number): { text: string; alert: boolean } {
  switch (mirror.state) {
    // 정상은 위의 '정상' 표시가 말해 주므로 받은 시각만 적는다.
    case 'ok': return { text: t(`${ago(mirror.lastOkAt!, now)} 받음`, `received ${ago(mirror.lastOkAt!, now)}`), alert: false };
    case 'limited': return { text: t(`잠시 쉬는 중 · ${ago(mirror.limitedUntil!, now)} 다시 시도`, `resting · retries ${ago(mirror.limitedUntil!, now)}`), alert: false };
    case 'failing': return { text: `${t(`${ago(mirror.failingSince!, now)}부터 실패`, `failing since ${ago(mirror.failingSince!, now)}`)} · ${mirror.lastFailure || t('원인 모름', 'unknown cause')}`, alert: true };
    case 'stale': return { text: mirror.lastOkAt ? t(`${ago(mirror.lastOkAt, now)}에 마지막으로 받음`, `last received ${ago(mirror.lastOkAt, now)}`) : t('오래전에 마지막으로 받음', 'last received long ago'), alert: true };
    default: return { text: t('아직 받은 기록이 없어요', 'Nothing received yet'), alert: false };
  }
}

/** 오래 받지 못한 계정 한 줄. 마지막으로 받은 때와, 실패 중이면 그 이유를 적는다. */
export function accountLine(account: StaleXAccount, now: number): string {
  const last = account.lastOkAt ? Date.parse(account.lastOkAt) : NaN;
  const parts = [Number.isFinite(last) ? t(`${ago(last, now)} 마지막으로 받음`, `last received ${ago(last, now)}`) : t('받은 적 없음', 'never received')];
  if (account.error) parts.push(account.failures > 1 ? t(`${account.failures}번째 실패: ${account.error}`, `failure #${account.failures}: ${account.error}`) : account.error);
  else parts.push(t('수집 차례를 기다리는 중', 'waiting for its turn'));
  return parts.join(' · ');
}

/**
 * X 수집 상태. 운영자에게만 보인다. X 계정 글은 공개 미러(Nitter)에서 받는데, 미러가 주소를 옮기거나 멈추면
 * 글이 하루 넘게 늦게 들어와도 알기 어려웠다. 미러마다 마지막으로 받은 시각과 실패 원인을 보여 주고,
 * 미러는 멀쩡해도 3시간 넘게 받지 못한 계정을 이름과 이유로 함께 보여 준다.
 */
export function XMirrorStatus({ initial, now: fixedNow }: { initial?: MirrorConfig; now?: number }) {
  const [config, setConfig] = useState<MirrorConfig | null>(initial ?? null);
  const probe = useRef<HTMLSpanElement>(null);
  // 설정 창을 열 때마다 새로 읽는다. 미러 상태는 몇 분 사이에도 바뀐다.
  useEffect(() => {
    if (initial) return;
    let active = true;
    const panel = probe.current?.closest('details');
    const load = () => {
      if (panel && !panel.open) return;
      apiRequest<MirrorConfig>('/api/x-mirrors').then((value) => { if (active) setConfig(value); }).catch(() => {});
    };
    load();
    panel?.addEventListener('toggle', load);
    return () => { active = false; panel?.removeEventListener('toggle', load); };
  }, [initial]);
  if (!config?.canManage || !config.mirrors?.length) return <span ref={probe} hidden />;
  const now = fixedNow ?? Date.now();
  const lines = config.mirrors.map((mirror) => ({ mirror, ...mirrorLine(mirror, now) }));
  const mirrorAlert = lines.some((line) => line.alert) || lines.every((line) => line.mirror.state !== 'ok');
  // 미러는 멀쩡해도 특정 계정만 계속 실패할 수 있다(이름 변경, 비공개 전환, 미러가 그 계정만 못 받음 등).
  const stale = config.staleAccounts ?? [], staleTotal = config.staleTotal ?? stale.length;
  const alert = mirrorAlert || staleTotal > 0;
  // 문제가 있을 때만 설명 줄을 보인다. 정상일 때의 설명은 마우스를 올렸을 때만 보인다.
  const summary = mirrorAlert ? t('X 글이 늦게 들어올 수 있어요. 미러 주소가 바뀌었는지 확인해 주세요.', 'X posts may arrive late. Check whether a mirror address changed.')
    : staleTotal ? t(`X 계정 ${staleTotal}개를 3시간 넘게 받지 못했어요.`, `${staleTotal} X accounts have not been fetched for over 3 hours.`) : '';
  return <div className="feedex-x-mirrors">
    <span ref={probe} hidden />
    <div className="feedex-auto-refresh-setting" title={alert ? undefined : t('미러가 정상이고, 모든 X 계정을 3시간 안에 받았어요.', 'Mirrors are healthy and every X account was fetched within 3 hours.')}>
      <SettingLabel icon={Radio}>{t('X 수집', 'X fetching')}{summary && <small>{summary}</small>}</SettingLabel>
      <strong className="feedex-status-pill" data-alert={alert || undefined}>{alert ? t('확인 필요', 'Needs attention') : t('정상', 'Healthy')}</strong>
    </div>
    <ul className="feedex-x-mirror-list">
      {lines.map(({ mirror, text, alert: bad }) => <li key={mirror.provider} data-state={mirror.state} data-alert={bad || undefined}><span>{mirror.host}</span><small>{text}</small></li>)}
    </ul>
    {stale.length > 0 && <ul className="feedex-x-mirror-list" aria-label={t('오래 받지 못한 X 계정', 'X accounts not fetched for a while')}>
      {stale.map((account) => <li key={account.handle} data-alert><span title={account.title}>@{account.handle}</span><small>{accountLine(account, now)}</small></li>)}
      {staleTotal > stale.length && <li><small>{t(`외 ${staleTotal - stale.length}개`, `${staleTotal - stale.length} more`)}</small></li>}
    </ul>}
  </div>;
}
