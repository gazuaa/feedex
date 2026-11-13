import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../client/api';

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
  const minutes = Math.floor(Math.abs(now - at) / 60_000), after = at > now ? '뒤' : '전';
  if (minutes < 1) return at > now ? '곧' : '방금';
  if (minutes < 60) return `${minutes}분 ${after}`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}시간 ${after}` : `${Math.round(hours / 24)}일 ${after}`;
}

/** 미러 한 줄의 설명과, 확인이 필요한지. */
export function mirrorLine(mirror: MirrorStatus, now: number): { text: string; alert: boolean } {
  switch (mirror.state) {
    case 'ok': return { text: `정상 · ${ago(mirror.lastOkAt!, now)} 받음`, alert: false };
    case 'limited': return { text: `요청 한도로 쉬는 중 · ${ago(mirror.limitedUntil!, now)} 다시 시도`, alert: false };
    case 'failing': return { text: `${ago(mirror.failingSince!, now)}부터 실패 · ${mirror.lastFailure || '원인 모름'}`, alert: true };
    case 'stale': return { text: `${mirror.lastOkAt ? ago(mirror.lastOkAt, now) : '오래전'}에 마지막으로 받음`, alert: true };
    default: return { text: '아직 받은 기록이 없어요', alert: false };
  }
}

/** 오래 받지 못한 계정 한 줄. 마지막으로 받은 때와, 실패 중이면 그 이유를 적는다. */
export function accountLine(account: StaleXAccount, now: number): string {
  const last = account.lastOkAt ? Date.parse(account.lastOkAt) : NaN;
  const parts = [Number.isFinite(last) ? `${ago(last, now)} 마지막으로 받음` : '받은 적 없음'];
  if (account.error) parts.push(account.failures > 1 ? `${account.failures}번째 실패: ${account.error}` : account.error);
  else parts.push('수집 차례를 기다리는 중');
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
  const summary = mirrorAlert ? 'X 글이 늦게 들어올 수 있어요. 미러 주소가 바뀌었는지 확인해 주세요.'
    : staleTotal ? `X 계정 ${staleTotal}개를 3시간 넘게 받지 못했어요.`
    : '미러가 정상이고, 모든 X 계정을 3시간 안에 받았어요.';
  return <div className="feedex-x-mirrors">
    <span ref={probe} hidden />
    <div className="feedex-auto-refresh-setting">
      <span>X 수집<small>{summary}</small></span>
      <strong className="text-xs" data-alert={alert || undefined}>{alert ? '확인 필요' : '정상'}</strong>
    </div>
    <ul className="feedex-x-mirror-list">
      {lines.map(({ mirror, text, alert: bad }) => <li key={mirror.provider} data-alert={bad || undefined}><span>{mirror.host}</span><small>{text}</small></li>)}
    </ul>
    {stale.length > 0 && <ul className="feedex-x-mirror-list" aria-label="오래 받지 못한 X 계정">
      {stale.map((account) => <li key={account.handle} data-alert><span title={account.title}>@{account.handle}</span><small>{accountLine(account, now)}</small></li>)}
      {staleTotal > stale.length && <li><small>외 {staleTotal - stale.length}개</small></li>}
    </ul>}
  </div>;
}
