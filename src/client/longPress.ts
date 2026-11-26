import { isAppleTouch } from './share';

const listSurface = '.feedex-feed-list,.feedex-mobile-library';
const editable = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),.feedex-reader-content,dialog';
const menuTarget = '[data-article-id],[data-feed-id],[data-folder-id]';
const repeatDelay = 400, repeatDistance = 28;
type TouchPoint = { x: number; y: number; time: number };
const distance = (point: TouchPoint, touch: Touch) => Math.hypot(touch.clientX - point.x, touch.clientY - point.y);

export function bindLongPress(doc: Document, open: (target: Element, x: number, y: number) => void) {
  const browser = doc.defaultView?.navigator;
  const appleTouch = browser && isAppleTouch(browser.userAgent, browser.maxTouchPoints);
  let start: (TouchPoint & { guardLoupe: boolean }) | null = null, previousTap: TouchPoint | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined, fired = false, suppressUntil = 0;
  const cancel = () => { clearTimeout(timer); start = null; };
  const begin = (event: TouchEvent) => {
    cancel(); fired = false;
    // 다시 누른 동작은 앞서 길게 누른 손을 뗄 때 생긴 클릭이 아니다.
    suppressUntil = 0;
    const lastTap = previousTap; previousTap = null;
    const target = event.target as Element | null;
    if (event.touches.length !== 1 || !target?.closest || target.closest(editable)) return;
    const showsMenu = Boolean(target.closest(menuTarget));
    const guardLoupe = Boolean(appleTouch && target.closest(listSurface) && !target.closest('a,button,summary,video,audio'));
    if (!showsMenu && !guardLoupe) return;
    const touch = event.touches[0];
    // iOS는 짧게 누른 뒤 같은 곳을 길게 누르면 CSS의 글자 선택 금지를 무시하고 돋보기를 띄울 수 있다.
    if (guardLoupe && lastTap && event.timeStamp - lastTap.time <= repeatDelay && distance(lastTap, touch) <= repeatDistance && event.cancelable) event.preventDefault();
    start = { x: touch.clientX, y: touch.clientY, time: event.timeStamp, guardLoupe };
    // iOS 돋보기(약 0.5초)보다 먼저 피드엑스 메뉴를 띄운다.
    if (showsMenu) timer = setTimeout(() => { if (start) { fired = true; open(target, start.x, start.y); } }, 380);
  };
  // 메뉴를 띄운 뒤에도 같은 손가락이 끌면 뒤 목록이 스크롤된다. 손을 뗄 때까지 그 끌기는 막는다.
  const hold = (event: TouchEvent) => { if (fired && event.cancelable) event.preventDefault(); };
  const move = (event: TouchEvent) => { if (start && (event.touches.length !== 1 || distance(start, event.touches[0]) > 12)) cancel(); };
  const end = (event: TouchEvent) => {
    const touch = event.changedTouches?.[0];
    if (!fired && start?.guardLoupe && touch && event.touches.length === 0 && event.timeStamp - start.time <= 250 && distance(start, touch) <= 12) {
      previousTap = { x: touch.clientX, y: touch.clientY, time: event.timeStamp };
    }
    cancel();
    if (fired) { if (event.cancelable) event.preventDefault(); suppressUntil = Date.now() + 700; fired = false; }
  };
  const abort = () => { cancel(); fired = false; };
  const click = (event: MouseEvent) => { if ((event.target as Element | null)?.closest?.('.feedex-context-menu')) return; if (Date.now() < suppressUntil) { event.preventDefault(); event.stopPropagation(); } };
  doc.addEventListener('touchstart', begin, { passive: !appleTouch }); doc.addEventListener('touchmove', move, { passive: true }); doc.addEventListener('touchmove', hold, { passive: false }); doc.addEventListener('touchend', end, { passive: false }); doc.addEventListener('touchcancel', abort); doc.addEventListener('click', click, true);
  return () => { cancel(); doc.removeEventListener('touchstart', begin); doc.removeEventListener('touchmove', move); doc.removeEventListener('touchmove', hold); doc.removeEventListener('touchend', end); doc.removeEventListener('touchcancel', abort); doc.removeEventListener('click', click, true); };
}
