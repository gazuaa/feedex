import { COMMIT_SHARE, DURATION, presentReaderSlide } from './swipeBack';

// 프레임이 종료 알림을 놓쳐도 뒤로 가기 위치에서 오래 멈추지 않게 한다.
const EDGE_IDLE_MS = 650;
// 손가락을 왼쪽으로 되돌리는 동안 리더 가장자리를 사이트 페이지보다 이만큼 왼쪽에 둔다(scroll 참고).
// 한 프레임에 손가락이 움직이는 거리보다 넉넉하게 잡는다.
const READER_LEAD = 64;
// scrollend를 아는 브라우저(iOS Safari 포함)는 손가락이 닿아 있는 동안 scrollend를 보내지 않으므로 그것을 손을 뗀 신호로 쓴다.
// 다른 도메인 원문은 손가락이 닿아 있는지 알려 주지 않아, 스크롤이 잠깐 멈춘 것만으로 손을 뗐다고 보면 끄는 도중에 닫히거나 되돌아간다.
// 이 시간은 scrollend를 놓쳤을 때를 대비한 여유다.
const SCROLLEND_GRACE_MS = 1500;

/** 웹뷰의 뒤로 가기 스크롤과 사본 안의 터치 종료를 확인한다. */
// 닫히는 화면이 실제로 사라질 때까지 기다리는 최대 시간. 그 뒤에도 남아 있으면 닫기가 취소된 것으로 보고 제자리로 돌린다.
const CLOSE_WAIT_MS = 1500;

/** `closes`는 이번 뒤로 가기로 이 화면이 닫히는지다(X 글 패널의 이전 글로 가기는 닫히지 않는다). */
export function bindWebPager(pager: HTMLElement, onBack: () => void, closes: () => boolean = () => true) {
  const view = pager.ownerDocument.defaultView;
  if (!view) return () => {};
  let gone = false, settling = false, timer = 0, frame = 0, touches = 0;
  let lastDx = 0, lastAt = 0, velocity = 0;
  // 손가락을 왼쪽으로 되돌리는 중이라 리더를 READER_LEAD만큼 뒤에 두고 있는지.
  let trailing = false;
  // 리더 배경이 투명해 뒤에 두어도 드러나지 않는지(원문 웹 보기). 불투명한 X 글 화면에서는 그만큼 리더 배경이 띠처럼 드러난다.
  let canTrail = false;
  const hasScrollEnd = 'onscrollend' in view;
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
    trailing = false;
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
    const closing = closes();
    onBack();
    const restoreHere = () => { rest(); if (pager.isConnected) { gone = false; home(); } };
    // 닫히는 화면은 사라질 때까지 오른쪽 바깥에 둔다. 목록까지 기록을 여러 칸 돌아가면 닫히는 데 시간이 더 걸리는데,
    // 그 전에 제자리로 돌려 놓으면 목록 아래에 깔린 사이트가 목록이 덜 들어온 가장자리로 비쳐 잔상이 남는다.
    timer = view.setTimeout(() => {
      if (closing && pager.isConnected) { timer = view.setTimeout(restoreHere, CLOSE_WAIT_MS - DURATION - 40); return; }
      restoreHere();
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
    const current = slide;
    const finish = () => {
      if (gone) return;
      pager.style.removeProperty('transform');
      page?.style.removeProperty('transform');
      pager.scrollLeft = max();
      current.place(commit ? current.width : 0, true);
      timer = view.setTimeout(() => {
        if (gone) return;
        if (commit) finishLeave();
        else { rest(); home(); }
      }, DURATION);
    };
    if (!trailing || !canTrail) { finish(); return; }
    // 되돌리던 중이라 리더가 READER_LEAD만큼 뒤에 있었다. 그대로 마무리하면 페이지가 리더 자리로 옮겨지며 그만큼 뒤로 튀므로,
    // 리더와 페이저를 페이지와 같은 자리로 먼저 옮겨 그린 뒤 마무리한다.
    trailing = false;
    current.place(dx, false);
    pager.style.transform = `translate3d(${-dx}px, 0, 0)`;
    frame = view.requestAnimationFrame(() => { frame = view.requestAnimationFrame(finish); });
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
    const grace = hasScrollEnd ? SCROLLEND_GRACE_MS : 0;
    if (pager.scrollLeft <= 1) timer = view.setTimeout(leave, 160 + grace);
    else if (pager.scrollLeft < max() - 1) timer = view.setTimeout(snap, 140 + grace);
  };
  const scroll = () => {
    if (gone || settling) return;
    if (photoOpen()) { cancelLeave(); rest(); pager.scrollLeft = max(); return; }
    const dx = Math.max(0, max() - pager.scrollLeft);
    const now = view.performance?.now?.() ?? Date.now();
    if (lastAt && now > lastAt) velocity = (dx - lastDx) / (now - lastAt);
    // 방향을 바꾸기 전 손가락이 멈추는 순간부터 뒤에 두어 되돌리는 첫 프레임도 깎이지 않게 한다.
    // 손 떨림 정도의 작은 오른쪽 움직임으로는 되돌리기를 끝난 것으로 보지 않는다.
    if (dx <= lastDx + 1) trailing = true;
    else if (dx > lastDx + 4) trailing = false;
    lastDx = dx; lastAt = now;
    if (dx < 1) { cancelLeave(); velocity = 0; rest(); return; }
    pager.dataset.sliding = '';
    // 스냅 자식(page)에 변형을 걸면 WebKit이 변형된 위치를 스냅 지점으로 삼아 끌던 자리에 멈추므로,
    // 페이저 자체를 반대로 옮겨 화면 자리에 고정하고 스냅 지점은 원래 자리에 둔다.
    // 사이트 페이지는 iOS 스크롤로 바로 움직이지만 리더와 페이저의 변형은 이 이벤트를 받아 한 프레임 늦게 바뀐다.
    // 손가락을 왼쪽으로 되돌리는 동안 리더를 페이지와 같은 자리에 두면, 늦게 오는 리더 가장자리가 페이지를 깎아 경계가 떨린다.
    // 그동안에는 리더를 READER_LEAD만큼 뒤에 두어 가장자리가 늘 페이지 왼쪽 바깥(투명한 빈 페이지 위)에 있게 한다.
    // 오른쪽으로 갈 때는 늦게 오는 가장자리가 페이지보다 왼쪽에 있으므로 원래대로 페이지와 같은 자리에 둔다.
    if (!slide) {
      slide = presentReaderSlide(pager.ownerDocument);
      const reader = pager.closest<HTMLElement>('.feedex-article-reader');
      const background = reader ? view.getComputedStyle(reader).backgroundColor : '';
      canTrail = background === 'transparent' || /^rgba\(.*,\s*0\)$/.test(background);
    }
    if (slide) {
      const behind = trailing && canTrail ? Math.max(0, dx - READER_LEAD) : dx;
      slide.place(dx, false, behind);
      pager.style.transform = `translate3d(${-behind}px, 0, 0)`;
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
