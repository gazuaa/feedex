import { COMMIT_SHARE, DURATION, presentReaderSlide } from './swipeBack';

// 프레임이 종료 알림을 놓쳐도 뒤로 가기 위치에서 오래 멈추지 않게 한다.
const EDGE_IDLE_MS = 650;

/** 웹뷰의 뒤로 가기 스크롤과 사본 안의 터치 종료를 확인한다. */
export function bindWebPager(pager: HTMLElement, onBack: () => void) {
  const view = pager.ownerDocument.defaultView;
  if (!view) return () => {};
  let gone = false, settling = false, timer = 0, frame = 0, touches = 0;
  let lastDx = 0, lastAt = 0, velocity = 0;
  let touchTarget: EventTarget | null = null;
  const frameTouches = new Set<MessageEventSource>();
  const frames = () => Array.from(pager.querySelectorAll('iframe'), element => element.contentWindow);
  // 끝을 알 수 없게 된 터치는 잊는다. 그대로 두면 빈 페이지에 닿아도 리더가 닫히지 않고, 화면 밖으로 밀린 리더가
  // 목록을 계속 덮은 것으로 남아 목록이 스크롤되지 않는다.
  // - X 글은 미리보기 프레임을 스레드 프레임으로 바꾼다. 지워진 프레임은 손가락을 뗐다고 알릴 수 없다.
  // - 불러오는 중 덮개처럼 터치를 시작한 요소가 지워지면 그 터치의 종료는 페이저까지 오지 않는다.
  const touching = () => {
    const current = frames();
    for (const source of frameTouches) if (!current.includes(source as Window)) frameTouches.delete(source);
    if (touches > 0 && (touchTarget as Node | null)?.isConnected === false) touches = 0;
    return touches > 0 || frameTouches.size > 0;
  };
  let slide: ReturnType<typeof presentReaderSlide> = null;
  const page = pager.lastElementChild as HTMLElement | null;
  const max = () => Math.max(0, pager.scrollWidth - pager.clientWidth);
  const photoOpen = () => Boolean(pager.ownerDocument.querySelector('dialog[data-sfeed-photo-viewer][open]'));
  const rest = () => {
    settling = false;
    slide?.clear();
    slide = null;
    pager.style.removeProperty('transform');
    page?.style.removeProperty('transform');
    delete pager.dataset.sliding;
  };
  const cancelLeave = () => { view.clearTimeout(timer); view.cancelAnimationFrame(frame); };
  const home = () => { if (!gone && !settling && !touching()) pager.scrollLeft = max(); };
  home();
  const observer = new ResizeObserver(home);
  observer.observe(pager);
  // 닫히는 리더는 React가 화면에서 지울 때까지 오른쪽 바깥에 그대로 두어 다시 번쩍 나타나지 않게 하고,
  // 아래쪽 목록의 변형만 먼저 풀어 곧바로 깨끗하게 보이게 한다.
  const finishLeave = () => {
    cancelLeave();
    if (photoOpen()) { rest(); pager.scrollLeft = max(); return; }
    gone = true;
    settling = false;
    slide?.clearUnder();
    pager.style.removeProperty('transform');
    page?.style.removeProperty('transform');
    onBack();
    timer = view.setTimeout(() => {
      rest();
      if (pager.isConnected) { gone = false; home(); }
    }, DURATION + 40);
  };
  // 스크롤이나 프레임 교체로 화면 중간에 멈췄을 때도 그 자리에 얼어붙지 않게 끝까지 닫거나 제자리로 되돌린다.
  const snap = () => {
    cancelLeave();
    if (gone || settling || touching() || photoOpen()) return;
    if (pager.scrollLeft <= 1) { leave(); return; }
    const dx = Math.max(0, max() - pager.scrollLeft);
    if (dx < 1) { rest(); return; }
    slide ??= presentReaderSlide(pager.ownerDocument);
    if (!slide) { pager.scrollLeft = 0; leave(); return; }
    const now = view.performance?.now?.() ?? Date.now();
    const width = pager.clientWidth || slide.width;
    const commit = dx >= width * COMMIT_SHARE || (velocity > 0.5 && dx >= 48 && now - lastAt <= 220);
    settling = true;
    pager.style.removeProperty('transform');
    page?.style.removeProperty('transform');
    pager.scrollLeft = max();
    slide.place(commit ? slide.width : 0, true);
    timer = view.setTimeout(() => {
      if (gone) return;
      if (commit) finishLeave();
      else { rest(); home(); }
    }, DURATION);
  };
  const leave = () => {
    if (gone || settling || photoOpen()) return;
    if (touching()) { settle(); return; }
    cancelLeave();
    if (max() <= 1) return;
    if (pager.scrollLeft > 1) { snap(); return; }
    // 터치 종료와 스크롤 종료가 같은 프레임에 와도 네이티브 스크롤을 지우기 전에 정리할 시간을 준다.
    frame = view.requestAnimationFrame(() => {
      frame = view.requestAnimationFrame(() => {
        if (gone || settling || touching() || photoOpen() || pager.scrollLeft > 1) return;
        finishLeave();
      });
    });
  };
  const settle = () => {
    if (gone || settling || photoOpen()) return;
    cancelLeave();
    if (max() <= 1) return;
    if (touching()) {
      if (pager.scrollLeft <= 1) timer = view.setTimeout(() => {
        if (!gone && !settling && !photoOpen() && pager.scrollLeft <= 1) finishLeave();
      }, EDGE_IDLE_MS);
      return;
    }
    if (pager.scrollLeft <= 1) timer = view.setTimeout(leave, 160);
    else if (pager.scrollLeft < max() - 1) timer = view.setTimeout(snap, 140);
  };
  const scroll = () => {
    if (gone || settling) return;
    if (photoOpen()) { cancelLeave(); rest(); pager.scrollLeft = max(); return; }
    const dx = Math.max(0, max() - pager.scrollLeft);
    const now = view.performance?.now?.() ?? Date.now();
    if (lastAt && now > lastAt) velocity = (dx - lastDx) / (now - lastAt);
    lastDx = dx; lastAt = now;
    if (dx < 1) { cancelLeave(); velocity = 0; rest(); return; }
    pager.dataset.sliding = '';
    // 스냅 자식(page)에 변형을 걸면 WebKit이 변형된 위치를 스냅 지점으로 삼아 끌던 자리에 멈추므로,
    // 페이저 자체를 반대로 옮겨 화면 자리에 고정하고 스냅 지점은 원래 자리에 둔다.
    slide ??= presentReaderSlide(pager.ownerDocument);
    if (slide) {
      slide.place(dx, false);
      pager.style.transform = `translate3d(${-dx}px, 0, 0)`;
    }
    settle();
  };
  const touch = (event: TouchEvent) => {
    touches = event.touches.length;
    touchTarget = touches ? event.target : null;
    settle();
  };
  const message = (event: MessageEvent) => {
    const count = event.data?.sfeedTouchCount;
    if (!Number.isInteger(count) || count < 0 || count > 10 || !event.source) return;
    // 손가락을 뗐다는 알림은 이미 지워진 프레임에서 와도 받는다(프레임은 사라지기 직전에 알린다).
    if (count === 0 && frameTouches.delete(event.source)) { settle(); return; }
    if (!frames().includes(event.source as Window)) return;
    if (count) frameTouches.add(event.source); else frameTouches.delete(event.source);
    settle();
  };
  pager.addEventListener('scroll', scroll, { passive: true });
  pager.addEventListener('scrollend', leave);
  for (const name of ['touchstart', 'touchend', 'touchcancel']) pager.addEventListener(name, touch as EventListener, { passive: true, capture: true });
  view.addEventListener('message', message);
  return () => {
    gone = true; observer.disconnect(); cancelLeave(); rest(); frameTouches.clear();
    pager.removeEventListener('scroll', scroll); pager.removeEventListener('scrollend', leave);
    for (const name of ['touchstart', 'touchend', 'touchcancel']) pager.removeEventListener(name, touch as EventListener, { capture: true });
    view.removeEventListener('message', message);
  };
}
