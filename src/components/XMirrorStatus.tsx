import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../client/api';

export type MirrorState = 'ok' | 'limited' | 'failing' | 'stale' | 'unknown';
export interface MirrorStatus {
  provider: string; host: string; state: MirrorState;
  lastOkAt: number | null; failingSince: number | null; lastFailure: string | null; limitedUntil: number | null;
}
export interface MirrorConfig { canManage: boolean; mirrors?: MirrorStatus[] }

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

/**
 * X 미러 상태. 운영자에게만 보인다. X 계정 글은 공개 미러(Nitter)에서 받는데, 미러가 주소를 옮기거나 멈추면
 * 글이 하루 넘게 늦게 들어와도 알기 어려웠다. 미러마다 마지막으로 받은 시각과 실패 원인을 보여 준다.
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
  const alert = lines.some((line) => line.alert) || lines.every((line) => line.mirror.state !== 'ok');
  return <div className="feedex-x-mirrors">
    <span ref={probe} hidden />
    <div className="feedex-auto-refresh-setting">
      <span>X 미러<small>{alert ? 'X 글이 늦게 들어올 수 있어요. 미러 주소가 바뀌었는지 확인해 주세요.' : 'X 계정 글을 받아 오는 공개 미러예요.'}</small></span>
      <strong className="text-xs" data-alert={alert || undefined}>{alert ? '확인 필요' : '정상'}</strong>
    </div>
    <ul className="feedex-x-mirror-list">
      {lines.map(({ mirror, text, alert: bad }) => <li key={mirror.provider} data-alert={bad || undefined}><span>{mirror.host}</span><small>{text}</small></li>)}
    </ul>
  </div>;
}
