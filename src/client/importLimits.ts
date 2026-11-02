import { useEffect, useState } from 'react';
import type { OpmlImportResult } from '../shared/opml';

// 한 피드에서 요청 한도를 기다리는 최대 횟수. 그 뒤에도 막히면 남은 피드는 다음에 받는다.
export const LIMIT_WAITS = 3;

export interface ImportPause { wait: (ms: number) => Promise<void>; cancel: () => void }

// 중단 버튼을 누르면 기다리던 시간을 바로 끝낸다.
export function importPause(): ImportPause {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  return {
    wait: (ms) => new Promise<void>((resolve) => { wake = resolve; timer = setTimeout(resolve, ms); }),
    cancel: () => { clearTimeout(timer); wake?.(); wake = undefined; },
  };
}

// 기다리는 동안 남은 초를 1초마다 다시 그린다.
export function useSecondsLeft(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

// 피드 제공 경로가 모두 한도에 걸렸으면 다음 피드도 같은 이유로 실패한다.
// 서버가 알려 준 시간만큼 기다렸다가 같은 피드부터 다시 받는다.
export async function importWithinLimits(
  run: () => Promise<OpmlImportResult>,
  options: { pause: ImportPause; stopped: () => boolean; onWait: (until: number | null) => void; waits?: number },
): Promise<{ result: OpmlImportResult; limited: boolean }> {
  for (let attempt = 0; ; attempt++) {
    const result = await run();
    if (result.status !== 'failed' || !result.retryAfter) return { result, limited: false };
    if (attempt >= (options.waits ?? LIMIT_WAITS) || options.stopped()) return { result, limited: true };
    const delay = (Math.min(600, Math.max(3, Math.ceil(result.retryAfter))) + 1) * 1000;
    options.onWait(Date.now() + delay);
    try { await options.pause.wait(delay); } finally { options.onWait(null); }
    if (options.stopped()) return { result, limited: true };
  }
}
