export function bindLongPress(doc: Document, open: (target: Element, x: number, y: number) => void) {
  let start: { target: Element; x: number; y: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined, fired = false, suppressUntil = 0;
  const cancel = () => { clearTimeout(timer); start = null; };
  const begin = (event: TouchEvent) => {
    cancel(); fired = false;
    const target = event.target as Element | null;
    if (event.touches.length !== 1 || !target?.closest?.('[data-article-id],[data-feed-id],[data-folder-id]') || target.closest('input,textarea,select,[contenteditable="true"],.feedex-reader-content,dialog')) return;
    const touch = event.touches[0]; start = { target, x: touch.clientX, y: touch.clientY };
    timer = setTimeout(() => { if (start) { fired = true; open(start.target, start.x, start.y); } }, 450);
  };
  const move = (event: TouchEvent) => { if (start && (event.touches.length !== 1 || Math.hypot(event.touches[0].clientX - start.x, event.touches[0].clientY - start.y) > 10)) cancel(); };
  const end = (event: TouchEvent) => { cancel(); if (fired) { if (event.cancelable) event.preventDefault(); suppressUntil = Date.now() + 700; fired = false; } };
  const click = (event: MouseEvent) => { if ((event.target as Element | null)?.closest?.('.feedex-context-menu')) return; if (Date.now() < suppressUntil) { event.preventDefault(); event.stopPropagation(); } };
  doc.addEventListener('touchstart', begin, { passive: true }); doc.addEventListener('touchmove', move, { passive: true }); doc.addEventListener('touchend', end, { passive: false }); doc.addEventListener('touchcancel', cancel); doc.addEventListener('click', click, true);
  return () => { cancel(); doc.removeEventListener('touchstart', begin); doc.removeEventListener('touchmove', move); doc.removeEventListener('touchend', end); doc.removeEventListener('touchcancel', cancel); doc.removeEventListener('click', click, true); };
}
