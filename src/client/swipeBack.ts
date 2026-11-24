interface Point { x: number; y: number; time: number }
export function isBackSwipe(start: Point, end: Point) {
  const dx = end.x - start.x, dy = Math.abs(end.y - start.y);
  return dx >= 64 && dx > dy * 1.8 && end.time - start.time <= 900;
}

/** 느리게 천천히 끌어도 화면의 이 비율만큼 움직이면 뒤로 간다. */
export const COMMIT_SHARE = 0.4;
const PARALLAX = 0.3;
export const DURATION = 220;
/** 피드엑스 밀기를 마친 뒤 iOS 자체 뒤로 가기가 먼저 일어나는지 지켜보는 시간. */
const NATIVE_BACK_WAIT = 260;
const EASING = 'cubic-bezier(.2, .8, .2, 1)';

export interface SwipeNavigation {
  canGoBack(): boolean;
  back(): void;
  /** 뒤로 갔던 화면으로 다시 가는 왼쪽 밀기. 지원하지 않으면 생략한다. */
  canGoForward?(): boolean;
  forward?(): void;
  /** 목록에서 뒤로 가는 곳: 보관함 또는 목록의 이전 상태. */
  backTarget?(): 'library' | 'other';
}

// 떠나는 화면은 손가락을 따라가고, 돌아갈 화면은 iOS 내비게이션처럼
// 왼쪽 조금 떨어진 곳에서 미끄러져 들어온다.
interface SwipeScene { top: HTMLElement[]; under: HTMLElement[]; revealLibrary: boolean }

function readerScene(document: Document): SwipeScene | null {
  const view = document.defaultView;
  if (!view || view.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return null;
  const reader = document.querySelector<HTMLElement>('.feedex-article-reader');
  if (!reader || view.getComputedStyle(reader).position !== 'fixed' || !reader.querySelector('.feedex-reader, .feedex-linked-post-header')) return null;
  const under = [document.querySelector<HTMLElement>('.feedex-workspace-header'), document.querySelector<HTMLElement>('.feedex-feed-list')];
  return { top: [reader], under: under.filter((node): node is HTMLElement => Boolean(node)), revealLibrary: false };
}

function findScene(document: Document, navigation: SwipeNavigation): SwipeScene | null {
  const view = document.defaultView;
  if (!view || view.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return null;
  const reader = readerScene(document);
  if (reader) return reader;
  const workspace = document.querySelector<HTMLElement>('.feedex-workspace');
  if (!workspace || navigation.backTarget?.() !== 'library') return null;
  const library = document.querySelector<HTMLElement>('.feedex-mobile-library');
  return { top: [workspace], under: library ? [library] : [], revealLibrary: true };
}

function present(document: Document, scene: SwipeScene) {
  const width = document.defaultView?.innerWidth || 1;
  const root = document.documentElement;
  if (scene.revealLibrary) {
    root.dataset.sfeedSwipe = 'library';
    // 보통은 보관함이 목록을 덮는다. 아래에 드러나 있는 동안에는 목록이 위에 남는다.
    scene.top[0].style.zIndex = '41';
  }
  for (const node of [...scene.top, ...scene.under]) { node.style.willChange = 'transform'; node.style.transition = 'none'; }
  /** `topDx`는 위 화면만 다른 자리에 둘 때 쓴다(원문 웹 보기 참고). 아래 화면은 늘 `dx`를 따른다. */
  const place = (dx: number, animate: boolean, topDx = dx) => {
    const progress = Math.min(1, Math.max(0, dx / width));
    for (const node of [...scene.top, ...scene.under]) node.style.transition = animate ? `transform ${DURATION}ms ${EASING}` : 'none';
    for (const node of scene.top) {
      node.style.transform = `translate3d(${Math.max(0, topDx)}px, 0, 0)`;
    }
    for (const node of scene.under) node.style.transform = `translate3d(${-(1 - progress) * PARALLAX * width}px, 0, 0)`;
  };
  const clearNodes = (nodes: HTMLElement[]) => {
    for (const node of nodes) {
      for (const property of ['transform', 'transition', 'will-change', 'box-shadow', 'z-index']) node.style.removeProperty(property);
    }
  };
  // 돌아온 아래 화면은 정위치(0px)에 도착한 즉시 변형을 풀고, 떠나는 위 화면은 언마운트될 때까지 화면 밖에 유지한다.
  const clearUnder = () => clearNodes(scene.under);
  const clear = () => {
    clearNodes([...scene.top, ...scene.under]);
    delete root.dataset.sfeedSwipe;
  };
  return { width, place, clearUnder, clear };
}

/**
 * 이 모듈이 볼 수 없는 끌기에 쓰는, 열린 글의 뒤로 가기 슬라이드. 프레임 안 사이트 위에서
 * 끈 것은 앱에 스크롤로만 전달된다(WebPager 참고). 움직임이 없으면 null.
 */
export function presentReaderSlide(document: Document) {
  const scene = readerScene(document);
  return scene ? present(document, scene) : null;
}

// 보통의 오른쪽 밀기는 브라우저의 뒤로 가기와 같은 기록을 쓴다. 화면 가장자리는
// iOS에 맡겨서 한 동작이 두 이동 경로를 모두 일으키지 않게 한다.
export function bindSwipeBack(document: Document, navigation: SwipeNavigation) {
  const view = document.defaultView;
  if (!view) return () => {};
  let start: Point | null = null;
  let last: Point | null = null;
  let claimed = false;
  // 왼쪽으로 미는 앞으로 가기 동작. 화면은 끌지 않고 놓을 때 이동한다.
  let forwardClaimed = false;
  let stage: ReturnType<typeof present> | null = null;
  let settling = false;
  // 기록이 바뀐 횟수와 이번 밀기를 시작할 때의 값. 홈 화면 앱에서는 iOS의 뒤로 가기 밀기가 같은 손짓으로
  // 함께 움직일 수 있어, 그쪽이 먼저 뒤로 갔으면 여기서 또 가지 않는다. 두 번 가면 목록을 지나 보관함이 열린다.
  let pops = 0, gesturePops = 0;
  const cancel = () => { start = null; last = null; claimed = false; forwardClaimed = false; };
  const point = (touch: Touch, time: number): Point => ({ x: touch.clientX, y: touch.clientY, time });
  // 끌던 화면을 제자리로 되돌리고, 끝나면 인라인 스타일을 지운다.
  const restore = () => {
    const current = stage;
    stage = null;
    if (!current) return;
    current.place(0, true);
    view.setTimeout(current.clear, DURATION + 40);
  };
  // 슬라이드를 마치고 뒤로 간 뒤, 기록 변경이 그려질 때까지 떠나는 화면을 옆에 두어
  // 다시 번쩍 나타나지 않게 한다.
  const commit = () => {
    const current = stage;
    stage = null;
    if (!current) { navigation.back(); return; }
    settling = true;
    current.place(current.width, true);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      view.removeEventListener('popstate', settle);
      settling = false;
      current.clear();
    };
    const settle = () => view.requestAnimationFrame(() => view.requestAnimationFrame(finish));
    view.addEventListener('popstate', settle);
    view.setTimeout(() => {
      current.clearUnder();
      // iOS의 밀기는 손을 뗀 뒤 자기 애니메이션을 마치고 뒤로 간다. 그만큼 조금 더 기다려 보고 아무도 가지 않았을 때만 간다.
      view.setTimeout(() => {
        if (pops !== gesturePops) { settle(); return; }
        view.setTimeout(finish, 800);
        navigation.back();
      }, NATIVE_BACK_WAIT);
    }, DURATION);
  };
  const begin = (event: TouchEvent) => {
    cancel();
    if (settling || event.touches.length !== 1 || !(navigation.canGoBack() || navigation.canGoForward?.()) || (view.visualViewport?.scale ?? 1) > 1.05 || document.querySelector('dialog[open], [aria-modal="true"]') || document.getSelection()?.isCollapsed === false) return;
    const target = event.target as HTMLElement | null;
    const container = target?.closest('.feedex-feed-list, .feedex-mobile-library-scroll, .feedex-reader-content');
    if (!container || target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"], video, audio, iframe, summary, button:not(.feedex-mobile-library-row)')) return;
    // 가로로 넓은 코드 블록, 표, 캐러셀은 그대로 둔다.
    for (let node = target; node && node !== container; node = node.parentElement) {
      if (node.scrollWidth > node.clientWidth + 4 && /auto|scroll/.test(view.getComputedStyle(node).overflowX)) return;
    }
    const touch = event.touches[0];
    if (touch.clientX <= 24 || touch.clientX >= view.innerWidth - 24) return;
    start = point(touch, event.timeStamp);
    last = start;
    gesturePops = pops;
  };
  const move = (event: TouchEvent) => {
    if (!start) return;
    if (event.touches.length !== 1) { cancel(); restore(); return; }
    const current = point(event.touches[0], event.timeStamp);
    const dx = current.x - start.x, dy = Math.abs(current.y - start.y);
    if (!claimed && !forwardClaimed && dy > 12 && dy > Math.abs(dx)) { cancel(); return; }
    if (!claimed && !forwardClaimed && dx < -12) {
      if (!navigation.canGoForward?.() || -dx <= dy * 1.8) { cancel(); return; }
      forwardClaimed = true;
    }
    if (forwardClaimed) {
      if (event.cancelable) event.preventDefault();
      last = current;
      return;
    }
    if (!claimed && dx > 12 && dx > dy * 1.8 && navigation.canGoBack()) {
      claimed = true;
      const scene = findScene(document, navigation);
      if (scene) stage = present(document, scene);
    }
    if (claimed) {
      // 이미 끌기 시작했다면 브라우저가 스크롤을 가져가 이벤트를 취소할 수 없게 되어도
      // 손가락을 잡고 있는 동안에는 화면을 계속 따라가게 두고, 놓을 때 정한다.
      if (event.cancelable) event.preventDefault();
      stage?.place(dx, false);
    }
    last = current;
  };
  const end = (event: TouchEvent) => {
    const initial = start, previous = last, touch = event.changedTouches[0];
    const forwarding = forwardClaimed;
    cancel();
    if (forwarding && initial && touch) {
      const fx = touch.clientX - initial.x, fy = Math.abs(touch.clientY - initial.y);
      const fast = -fx >= 64 && -fx > fy * 1.8 && event.timeStamp - initial.time <= 900;
      if ((fast || (-fx >= view.innerWidth * COMMIT_SHARE && -fx > fy)) && navigation.canGoForward?.()) {
        if (event.cancelable) event.preventDefault();
        navigation.forward?.();
      }
      return;
    }
    if (!initial || !touch || !navigation.canGoBack()) { restore(); return; }
    const final = point(touch, event.timeStamp);
    const dx = final.x - initial.x, dy = Math.abs(final.y - initial.y);
    // 튕기듯 밀면 짧은 거리로도 뒤로 가고, 느리게 끌면 화면을 가로질러야 한다.
    const flick = isBackSwipe(initial, final) || Boolean(previous && previous !== initial && final.time > previous.time && (final.x - previous.x) / (final.time - previous.time) > 0.6 && dx >= 64);
    if (!(flick || (stage && dx >= view.innerWidth * COMMIT_SHARE && dx > dy))) { restore(); return; }
    if (event.cancelable) event.preventDefault();
    commit();
  };
  const abort = () => { cancel(); restore(); };
  document.addEventListener('touchstart', begin, { passive: true, capture: true });
  document.addEventListener('touchmove', move, { passive: false, capture: true });
  document.addEventListener('touchend', end, { passive: false, capture: true });
  document.addEventListener('touchcancel', abort, { passive: true, capture: true });
  // 네이티브 뒤로가기가 밀기를 중단해도 목록에 변형·합성 레이어가 남지 않게 한다.
  const historyChanged = () => { pops++; cancel(); stage?.clear(); stage = null; };
  view.addEventListener('popstate', historyChanged);
  return () => {
    document.removeEventListener('touchstart', begin, { capture: true });
    document.removeEventListener('touchmove', move, { capture: true });
    document.removeEventListener('touchend', end, { capture: true });
    document.removeEventListener('touchcancel', abort, { capture: true });
    view.removeEventListener('popstate', historyChanged);
    stage?.clear();
    stage = null;
  };
}
