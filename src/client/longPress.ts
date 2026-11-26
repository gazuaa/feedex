export function bindLongPress(doc: Document, open: (target: Element, x: number, y: number) => void) {
  let start: { target: Element; x: number; y: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined, fired = false, suppressUntil = 0;
  const cancel = () => { clearTimeout(timer); start = null; };
  const begin = (event: TouchEvent) => {
    cancel(); fired = false;
    // 다시 누른 동작은 앞서 길게 누른 손을 뗄 때 생긴 클릭이 아니다.
    suppressUntil = 0;
    const target = event.target as Element | null;
    if (event.touches.length !== 1 || !target?.closest?.('[data-article-id],[data-feed-id],[data-folder-id]') || target.closest('input,textarea,select,[contenteditable="true"],.feedex-reader-content,dialog')) return;
    const touch = event.touches[0]; start = { target, x: touch.clientX, y: touch.clientY };
    // iOS 돋보기(약 0.5초)보다 먼저 피드엑스 메뉴를 띄운다.
    timer = setTimeout(() => { if (start) { fired = true; open(start.target, start.x, start.y); } }, 380);
  };
  // 메뉴를 띄운 뒤에도 같은 손가락이 끌면 뒤 목록이 스크롤된다. 손을 뗄 때까지 그 끌기는 막는다.
  const hold = (event: TouchEvent) => { if (fired && event.cancelable) event.preventDefault(); };
  const move = (event: TouchEvent) => { if (start && (event.touches.length !== 1 || Math.hypot(event.touches[0].clientX - start.x, event.touches[0].clientY - start.y) > 12)) cancel(); };
  const end = (event: TouchEvent) => { cancel(); if (fired) { if (event.cancelable) event.preventDefault(); suppressUntil = Date.now() + 700; fired = false; } };
  const abort = () => { cancel(); fired = false; };
  const click = (event: MouseEvent) => { if ((event.target as Element | null)?.closest?.('.feedex-context-menu')) return; if (Date.now() < suppressUntil) { event.preventDefault(); event.stopPropagation(); } };
  doc.addEventListener('touchstart', begin, { passive: true }); doc.addEventListener('touchmove', move, { passive: true }); doc.addEventListener('touchmove', hold, { passive: false }); doc.addEventListener('touchend', end, { passive: false }); doc.addEventListener('touchcancel', abort); doc.addEventListener('click', click, true);
  return () => { cancel(); doc.removeEventListener('touchstart', begin); doc.removeEventListener('touchmove', move); doc.removeEventListener('touchmove', hold); doc.removeEventListener('touchend', end); doc.removeEventListener('touchcancel', abort); doc.removeEventListener('click', click, true); };
}
