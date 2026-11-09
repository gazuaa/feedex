import { presentReaderSlide } from './swipeBack';

/** 웹뷰에서 밀던 손가락을 뗀 뒤에만 리더를 닫는다. 사본 안의 터치도 직접 확인한다. */
export function bindWebPager(pager: HTMLElement, onBack: () => void) {
  const view = pager.ownerDocument.defaultView;
  if (!view) return () => {};
  let gone = false, timer = 0, frame = 0, touches = 0;
  const frameTouches = new Set<MessageEventSource>();
  const touching = () => touches > 0 || frameTouches.size > 0;
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
  const touch = (event: TouchEvent) => { touches = event.touches.length; if (touching()) cancelLeave(); else settle(); };
  const message = (event: MessageEvent) => {
    const count = event.data?.sfeedTouchCount;
    if (!Number.isInteger(count) || count < 0 || count > 10 || !event.source) return;
    if (!Array.from(pager.querySelectorAll('iframe')).some(element => element.contentWindow === event.source)) return;
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
