import { presentReaderSlide } from './swipeBack';

/** 웹뷰에서 밀던 손가락을 뗀 뒤에만 리더를 닫는다. 사본 안의 터치도 직접 확인한다. */
export function bindWebPager(pager: HTMLElement, onBack: () => void) {
  const view = pager.ownerDocument.defaultView;
  if (!view) return () => {};
  let gone = false, timer = 0, frame = 0, touches = 0;
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
  const rest = () => { slide?.clear(); slide = null; page?.style.removeProperty('transform'); };
  const cancelLeave = () => { view.clearTimeout(timer); view.cancelAnimationFrame(frame); };
  const home = () => { if (!gone && !touching()) pager.scrollLeft = pager.scrollWidth - pager.clientWidth; };
  home();
  const observer = new ResizeObserver(home);
  observer.observe(pager);
  const leave = () => {
    cancelLeave();
    if (gone || touching() || pager.scrollLeft > 1) return;
    // 터치 종료와 스크롤 종료가 같은 프레임에 와도 네이티브 스크롤을 지우기 전에 정리할 시간을 준다.
    frame = view.requestAnimationFrame(() => {
      frame = view.requestAnimationFrame(() => {
        if (gone || touching() || pager.scrollLeft > 1) return;
        gone = true; rest(); onBack();
      });
    });
  };
  const settle = () => {
    cancelLeave();
    if (!gone && !touching() && pager.scrollLeft <= 1) timer = view.setTimeout(leave, 160);
  };
  const scroll = () => {
    if (gone) return;
    if (pager.scrollLeft <= 1) settle(); else cancelLeave();
    const dx = Math.max(0, pager.scrollWidth - pager.clientWidth - pager.scrollLeft);
    if (dx < 1) { rest(); return; }
    slide ??= presentReaderSlide(pager.ownerDocument);
    if (!slide) return;
    slide.place(dx, false);
    if (page) page.style.transform = `translate3d(${-dx}px, 0, 0)`;
  };
  const touch = (event: TouchEvent) => {
    touches = event.touches.length;
    touchTarget = touches ? event.target : null;
    if (touching()) cancelLeave(); else settle();
  };
  const message = (event: MessageEvent) => {
    const count = event.data?.sfeedTouchCount;
    if (!Number.isInteger(count) || count < 0 || count > 10 || !event.source) return;
    // 손가락을 뗐다는 알림은 이미 지워진 프레임에서 와도 받는다(프레임은 사라지기 직전에 알린다).
    if (count === 0 && frameTouches.delete(event.source)) { if (!touching()) settle(); return; }
    if (!frames().includes(event.source as Window)) return;
    if (count) frameTouches.add(event.source); else frameTouches.delete(event.source);
    if (touching()) cancelLeave(); else settle();
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
