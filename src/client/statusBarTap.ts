import { useEffect, useRef, type RefObject } from 'react';
import { needsMobileScrollRecovery } from './mobileScrollRecovery';

/*
 * 아이폰 상단(상태 표시줄) 누르기로 맨 위로 가기.
 * iOS는 상단을 누르면 문서 스크롤만 맨 위로 올린다. 피드엑스 화면은 고정된 틀 안의 목록·본문 상자가 스크롤되므로
 * 그냥 두면 아무 일도 없다. 그래서 문서를 1px만 스크롤되게 두고 1에 세워 둔다. iOS가 문서를 0으로 올리면
 * 그것을 상단 누르기로 보고, 지금 보이는 상자를 맨 위로 올린 뒤 문서를 다시 1에 세운다.
 * 화면 틀이 position: fixed라 문서가 1px 움직여도 보이는 것은 그대로다.
 * 손가락이 화면에 있거나 막 뗐을 때(관성)의 0은 손동작이 문서를 민 것이므로 무시한다. 상단 누르기는 페이지에 터치 신호가 오지 않는다.
 */
const CLASS = 'feedex-status-tap';
const TOUCH_QUIET_MS = 700;

type Target = { ref: RefObject<HTMLElement | null>; active: boolean };
const targets = new Set<{ current: Target }>();
let installed = false;

/** 지금 보이는 대상 중 마지막에 등록한 것(글 화면이 목록 위에 열리면 글 화면). */
function currentTarget() {
  let found: HTMLElement | null = null;
  for (const target of targets) if (target.current.active && target.current.ref.current) found = target.current.ref.current;
  return found;
}

/** 상단 누르기로 볼 문서 스크롤인지. 터치 중이거나 터치가 막 끝났으면 손동작이 만든 스크롤이다. */
export function isStatusBarTap(scrollY: number, touching: boolean, sinceTouch: number) {
  return scrollY <= 0 && !touching && sinceTouch > TOUCH_QUIET_MS;
}

function install(win: Window) {
  if (installed) return;
  installed = true;
  const doc = win.document;
  doc.documentElement.classList.add(CLASS);
  let touches = 0, lastTouch = -Infinity, restoring = 0;
  const park = () => { if (win.scrollY < 1) win.scrollTo(0, 1); };
  const touch = (event: TouchEvent) => { touches = event.touches.length; lastTouch = performance.now(); };
  win.addEventListener('touchstart', touch, { passive: true, capture: true });
  win.addEventListener('touchend', touch, { passive: true, capture: true });
  win.addEventListener('touchcancel', touch, { passive: true, capture: true });
  win.addEventListener('scroll', () => {
    if (!isStatusBarTap(win.scrollY, touches > 0, performance.now() - lastTouch)) return;
    const target = currentTarget();
    if (target && target.scrollTop > 0) target.scrollTo({ top: 0, behavior: 'smooth' });
    // iOS의 맨 위로 가기 움직임이 끝난 뒤 다시 1에 세운다. 바로 세우면 iOS가 0으로 다시 끌어간다.
    win.clearTimeout(restoring);
    restoring = win.setTimeout(park, 400);
  }, { passive: true });
  // 화면 크기가 바뀌거나(키보드, 회전) 앱으로 돌아오면 1px 자리가 사라질 수 있어 다시 세운다.
  win.addEventListener('resize', () => win.setTimeout(park, 100));
  doc.addEventListener('visibilitychange', () => { if (!doc.hidden) park(); });
  win.requestAnimationFrame(park);
}

/** active일 때 상단 누르기로 ref 상자를 맨 위로 올린다. 아이폰·아이패드에서만 켠다. */
export function useStatusBarTap(ref: RefObject<HTMLElement | null>, active: boolean) {
  const target = useRef<Target>({ ref, active });
  target.current = { ref, active };
  useEffect(() => {
    if (typeof window === 'undefined' || !needsMobileScrollRecovery(navigator.userAgent, navigator.maxTouchPoints)) return;
    install(window);
    targets.add(target);
    return () => { targets.delete(target); };
  }, []);
}
