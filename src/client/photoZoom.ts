// 휴대폰 사진 보기의 두 손가락 확대와 한 손가락 이동.
// 앱 전체를 확대하지 않고 사진만 키운다. 무대(stage)가 화면 자리를, 사진(img)이 변형을 맡는다.
export const MAX_PHOTO_SCALE = 5;
export const TAP_PHOTO_SCALE = 2.5;
type Point = { x: number; y: number };
type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const middle = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const point = (touch: Touch): Point => ({ x: touch.clientX, y: touch.clientY });

/** 사진이 무대보다 크면 가장자리가 무대 안으로 들어오지 않게, 작으면 무대 가운데에 둔다. */
export function clampPhotoOffset(offset: number, center: number, size: number, scale: number, start: number, end: number) {
  const scaled = size * scale;
  if (scaled <= end - start) return (start + end) / 2 - center;
  return Math.min(start - center + scaled / 2, Math.max(end - center - scaled / 2, offset));
}

/** `edge` 안쪽에서 시작한 끌기는 뒤로 가기 몫으로 남긴다. `onChange`는 확대 여부가 바뀔 때 부른다. */
export function bindPhotoZoom(stage: HTMLElement, img: HTMLImageElement, options: { edge?: number; onChange?: (zoomed: boolean) => void } = {}) {
  const view = stage.ownerDocument.defaultView!;
  let scale = 1, x = 0, y = 0;
  let pinch: { distance: number; scale: number; origin: Point; center: Point; from: { scale: number; x: number; y: number } } | null = null;
  let pan: { start: Point; x: number; y: number; moved: boolean; center: Point } | null = null;
  let suppressClickUntil = 0, shown = false;
  const box = (element: Element): Box => element.getBoundingClientRect();
  // 확대·이동 전 사진 중심. 변형은 중심 기준이라 크기를 바꿔도 중심은 이동량만큼만 옮겨진다.
  const center = (): Point => { const rect = box(img); return { x: rect.left + rect.width / 2 - x, y: rect.top + rect.height / 2 - y }; };
  const apply = (animate = false) => {
    img.style.transition = animate ? 'transform .2s ease-out' : 'none';
    img.style.transformOrigin = 'center center';
    img.style.transform = scale === 1 && x === 0 && y === 0 ? '' : `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    img.style.cursor = scale > 1 ? 'zoom-out' : 'zoom-in';
    if (shown !== scale > 1.02) { shown = scale > 1.02; options.onChange?.(shown); }
  };
  const clampOffset = (base = center()) => {
    const area = box(stage), width = img.offsetWidth || box(img).width / scale, height = img.offsetHeight || box(img).height / scale;
    x = clampPhotoOffset(x, base.x, width, scale, area.left, area.right);
    y = clampPhotoOffset(y, base.y, height, scale, area.top, area.bottom);
  };
  /** 화면의 한 점이 손가락 아래에 머물도록 크기를 바꾼다. */
  const zoomAround = (next: number, focus: Point, origin: Point, base: Point, from: { scale: number; x: number; y: number }) => {
    const local = { x: (origin.x - base.x - from.x) / from.scale, y: (origin.y - base.y - from.y) / from.scale };
    scale = next;
    x = focus.x - base.x - scale * local.x;
    y = focus.y - base.y - scale * local.y;
  };
  const reset = (animate = false) => { scale = 1; x = 0; y = 0; pinch = null; pan = null; apply(animate); };
  const settle = () => {
    if (scale <= 1.02) { reset(true); return; }
    const base = center();
    scale = Math.min(MAX_PHOTO_SCALE, scale);
    clampOffset(base); apply(true);
  };
  /** 탭한 자리를 확대하거나, 확대한 사진을 원래대로 되돌린다. */
  const toggle = (at?: Point) => {
    if (scale > 1.02) { reset(true); return; }
    const base = center(), focus = at ?? base;
    zoomAround(TAP_PHOTO_SCALE, focus, focus, base, { scale: 1, x: 0, y: 0 });
    clampOffset(base); apply(true);
  };
  const start = (event: TouchEvent) => {
    if (event.touches.length === 2) {
      const a = point(event.touches[0]), b = point(event.touches[1]);
      pan = null;
      pinch = { distance: Math.max(1, distance(a, b)), scale, origin: middle(a, b), center: center(), from: { scale, x, y } };
      suppressClickUntil = Date.now() + 400;
    } else if (event.touches.length === 1 && scale > 1.02 && !pinch && event.touches[0].clientX > (options.edge ?? 0)) {
      pan = { start: point(event.touches[0]), x, y, moved: false, center: center() };
    }
  };
  const move = (event: TouchEvent) => {
    if (pinch && event.touches.length === 2) {
      if (event.cancelable) event.preventDefault();
      const a = point(event.touches[0]), b = point(event.touches[1]);
      // 최소보다 더 줄이면 살짝 버티다가 놓으면 원래 크기로 돌아온다.
      let next = pinch.scale * distance(a, b) / pinch.distance;
      if (next < 1) next = 1 - (1 - next) * 0.4;
      if (next > MAX_PHOTO_SCALE) next = MAX_PHOTO_SCALE + (next - MAX_PHOTO_SCALE) * 0.2;
      zoomAround(next, middle(a, b), pinch.origin, pinch.center, pinch.from);
      apply();
      return;
    }
    if (pan && event.touches.length === 1) {
      if (event.cancelable) event.preventDefault();
      const now = point(event.touches[0]);
      pan.moved ||= distance(now, pan.start) > 8;
      // 중심은 끌기 전에 잰 값을 쓴다. 바꾼 이동량으로 다시 재면 아직 그려지기 전 위치와 섞인다.
      x = pan.x + now.x - pan.start.x; y = pan.y + now.y - pan.start.y;
      clampOffset(pan.center); apply();
    }
  };
  const end = (event: TouchEvent) => {
    if (pinch) {
      if (event.touches.length >= 2) return;
      pinch = null;
      settle();
      // 한 손가락이 남으면 이어서 끌 수 있다.
      if (event.touches.length === 1 && scale > 1.02) pan = { start: point(event.touches[0]), x, y, moved: true, center: center() };
      return;
    }
    if (pan && event.touches.length === 0) {
      if (pan.moved) suppressClickUntil = Date.now() + 400;
      pan = null;
    }
  };
  // iOS가 화면 전체를 확대하지 않게 한다.
  const gesture = (event: Event) => event.preventDefault();
  stage.addEventListener('touchstart', start, { passive: true });
  stage.addEventListener('touchmove', move, { passive: false });
  stage.addEventListener('touchend', end, { passive: true });
  stage.addEventListener('touchcancel', end, { passive: true });
  for (const name of ['gesturestart', 'gesturechange']) stage.addEventListener(name, gesture, { passive: false });
  view.addEventListener('resize', settle);
  return {
    zoomed: () => scale > 1.02,
    /** 끌거나 확대한 직후의 탭은 클릭으로 치지 않는다. */
    clickAllowed: () => Date.now() >= suppressClickUntil,
    gesturing: () => Boolean(pinch || pan),
    toggle,
    reset,
    destroy: () => {
      stage.removeEventListener('touchstart', start); stage.removeEventListener('touchmove', move);
      stage.removeEventListener('touchend', end); stage.removeEventListener('touchcancel', end);
      for (const name of ['gesturestart', 'gesturechange']) stage.removeEventListener(name, gesture);
      view.removeEventListener('resize', settle);
    },
  };
}
