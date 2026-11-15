import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { parseHTML } from 'linkedom';
const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
try {
  const { rebuildScrollSurface, rebuildingScroll, bindMobileScrollRecovery, needsMobileScrollRecovery, releaseVelocity } = await vite.ssrLoadModule('/src/client/mobileScrollRecovery.ts');
  const fixture = () => {
    const { document, window } = parseHTML('<html><body><main><div><article data-article-id="x"><p>기존 X 글</p></article></div></main></body></html>');
    const root = document.querySelector('main'), content = root.firstElementChild;
    Object.defineProperty(Object.getPrototypeOf(root.style), 'getPropertyPriority', { configurable: true, value: () => '' });
    let id = 0; const frames = new Map();
    window.requestAnimationFrame = fn => { frames.set(++id, fn); return id; }; window.cancelAnimationFrame = key => frames.delete(key);
    let clock = 1000; window.performance = { now: () => clock };
    const paint = () => { clock += 16; for (const [key, fn] of [...frames]) { frames.delete(key); fn(); } };
    Object.defineProperties(root, { scrollHeight: { value: 2000 }, clientHeight: { value: 500 } }); root.scrollTop = 300;
    const touch = (type, x, y, options = {}) => {
      const e = new window.Event(type, { bubbles: true, cancelable: true });
      if (options.time) Object.defineProperty(e, 'timeStamp', { value: options.time });
      Object.defineProperties(e, { touches: { value: Array.from({ length: type === 'touchend' || type === 'touchcancel' ? 0 : options.fingers ?? 1 }, () => ({ clientX: x, clientY: y })) } });
      if (options.prevented) e.preventDefault(); content.dispatchEvent(e);
    };
    return { document, window, root, content, paint, touch };
  };
  {
    const s = fixture(), article = s.root.querySelector('article');
    s.root.style.setProperty('overflow', 'auto'); s.content.style.setProperty('transform', 'translateX(2px)');
    const finish = rebuildScrollSurface(s.root);
    assert.equal(rebuildingScroll(s.root), true); assert.equal(s.root.style.overflow, 'clip'); assert.equal(s.content.style.transform, 'translateY(-300px)');
    s.root.scrollTop = 0; s.paint(); assert.equal(rebuildingScroll(s.root), true); s.paint();
    assert.equal(rebuildingScroll(s.root), false); assert.equal(s.root.scrollTop, 300); assert.equal(s.root.style.overflow, 'auto'); assert.equal(s.content.style.transform, 'translateX(2px)');
    assert.equal(s.root.querySelector('article'), article, '기사 DOM·상태를 다시 만들거나 서버에서 받지 않는다'); finish();
  }
  {
    const s = fixture(), cleanup = bindMobileScrollRecovery(s.root);
    s.touch('touchstart', 100, 500); s.touch('touchmove', 102, 350); s.touch('touchend', 102, 350);
    s.paint(); s.paint(); assert.equal(rebuildingScroll(s.root), true, '세로 입력 후 전혀 움직이지 않은 스크롤만 재구성한다');
    s.paint(); s.paint(); assert.equal(s.root.scrollTop, 450, '막힌 손동작의 이동량도 반영한다'); assert.equal(rebuildingScroll(s.root), false); cleanup();
  }
  for (const kind of ['normal', 'horizontal', 'pinch', 'prevented', 'cancelled', 'boundary', 'overlay']) {
    const s = fixture(), cleanup = bindMobileScrollRecovery(s.root);
    if (kind === 'boundary') s.root.scrollTop = 1500;
    if (kind === 'overlay') s.document.body.appendChild(s.document.createElement('dialog')).setAttribute('open', '');
    s.touch('touchstart', 100, 500);
    s.touch('touchmove', kind === 'horizontal' ? 260 : 102, kind === 'horizontal' ? 505 : 350, { fingers: kind === 'pinch' ? 2 : 1, prevented: kind === 'prevented' });
    if (kind === 'normal') s.root.scrollTop = 350;
    s.touch(kind === 'cancelled' ? 'touchcancel' : 'touchend', 102, 350);
    for (let i = 0; i < 5; i++) s.paint();
    assert.equal(rebuildingScroll(s.root), false, `${kind}: 정상 스크롤·뒤로가기·핀치·취소·끝·모달에는 개입하지 않는다`); cleanup();
  }
  {
    const s = fixture(), cleanup = bindMobileScrollRecovery(s.root);
    s.touch('touchstart', 100, 500); s.touch('touchmove', 100, 350); s.touch('touchend', 100, 350); cleanup();
    for (let i = 0; i < 5; i++) s.paint(); assert.equal(rebuildingScroll(s.root), false); assert.equal(s.root.scrollTop, 300, '목록 전환 후 늦은 복구를 취소한다');
    const restore = rebuildScrollSurface(s.root); restore(); assert.equal(rebuildingScroll(s.root), false);
  }
  {
    // 막힌 손동작은 끄는 동안 손가락을 따라가고, 놓으면 관성으로 이어 간 뒤 멈춘 자리에서 계층을 다시 만든다.
    const s = fixture(), cleanup = bindMobileScrollRecovery(s.root);
    s.touch('touchstart', 100, 500, { time: 1000 }); s.touch('touchmove', 100, 480, { time: 1030 });
    assert.equal(s.root.scrollTop, 300, '짧게 끈 동안은 네이티브 스크롤을 기다린다');
    s.touch('touchmove', 100, 440, { time: 1070 }); assert.equal(s.root.scrollTop, 300, '화면을 두 번 더 그려 확인하기 전에는 위치를 쓰지 않는다');
    s.paint(); s.paint();
    s.touch('touchmove', 100, 400, { time: 1090 }); assert.equal(s.root.scrollTop, 400, '막힌 스크롤은 손가락 위치로 따라온다');
    s.touch('touchend', 100, 400, { time: 1095 }); s.paint();
    assert.ok(s.root.scrollTop > 400 && !rebuildingScroll(s.root), '놓은 뒤 관성으로 계속 움직인다');
    let frames = 0; while (!rebuildingScroll(s.root) && frames++ < 400) s.paint();
    assert.ok(rebuildingScroll(s.root), '관성이 멈추면 스크롤 계층을 다시 만든다');
    const stopped = s.root.scrollTop; s.paint(); s.paint();
    assert.equal(rebuildingScroll(s.root), false); assert.equal(s.root.scrollTop, stopped); assert.ok(stopped > 800 && stopped < 1100, `관성 거리는 iOS와 비슷하다: ${stopped}`); cleanup();
  }
  {
    // 대신 끌던 중 네이티브 스크롤이 살아나면 더 건드리지 않는다.
    const s = fixture(), cleanup = bindMobileScrollRecovery(s.root);
    s.touch('touchstart', 100, 500, { time: 1000 }); s.touch('touchmove', 100, 440, { time: 1070 }); s.paint(); s.paint();
    s.touch('touchmove', 100, 430, { time: 1075 }); assert.equal(s.root.scrollTop, 370);
    s.root.scrollTop = 420; s.touch('touchmove', 100, 400, { time: 1090 }); assert.equal(s.root.scrollTop, 420);
    s.touch('touchend', 100, 400, { time: 1095 }); for (let i = 0; i < 5; i++) s.paint();
    assert.equal(s.root.scrollTop, 420); assert.equal(rebuildingScroll(s.root), false); cleanup();
  }
  {
    // 관성 중 다시 만지면 iOS처럼 그 자리에서 멈춘다.
    const s = fixture(), cleanup = bindMobileScrollRecovery(s.root);
    s.touch('touchstart', 100, 500, { time: 1000 }); s.touch('touchmove', 100, 440, { time: 1070 }); s.paint(); s.paint(); s.touch('touchmove', 100, 400, { time: 1090 }); s.touch('touchend', 100, 400, { time: 1095 });
    s.paint(); s.paint(); const held = s.root.scrollTop; s.touch('touchstart', 100, 300, { time: 1200 }); s.paint(); s.paint();
    assert.equal(s.root.scrollTop, held); assert.equal(rebuildingScroll(s.root), false); cleanup();
  }
  {
    // 글을 닫은 직후처럼 화면이 바쁘면 터치가 먼저 몰려 오고 정상 스크롤 위치는 뒤늦게 온다. 이때는 끼어들지 않는다.
    const s = fixture(), cleanup = bindMobileScrollRecovery(s.root);
    s.touch('touchstart', 100, 500, { time: 1000 }); s.touch('touchmove', 100, 440, { time: 1070 });
    s.root.scrollTop = 330; s.root.dispatchEvent(new s.window.Event('scroll')); s.paint(); s.paint();
    s.touch('touchmove', 100, 300, { time: 1090 }); s.touch('touchend', 100, 300, { time: 1095 });
    for (let i = 0; i < 6; i++) s.paint();
    assert.equal(s.root.scrollTop, 330, '늦게 도착한 정상 스크롤 위치를 덮어쓰지 않는다'); assert.equal(rebuildingScroll(s.root), false, '관성을 끊는 계층 재구성도 하지 않는다'); cleanup();
  }
  assert.equal(releaseVelocity([{ y: 500, t: 0 }, { y: 400, t: 50 }], 55), 2, '위로 밀면 아래로 스크롤한다');
  assert.equal(releaseVelocity([{ y: 500, t: 0 }, { y: 400, t: 50 }], 200), 0, '손가락을 멈췄다 떼면 관성이 없다');
  assert.equal(needsMobileScrollRecovery('Mozilla iPhone', 1), true); assert.equal(needsMobileScrollRecovery('Mozilla Macintosh', 5), true);
  assert.equal(needsMobileScrollRecovery('Mozilla Macintosh', 0), false); assert.equal(needsMobileScrollRecovery('Mozilla Android', 5), false);
  console.log('통과: iPhone·iPad만 스크롤 계층 재구성, DOM·위치 보존, 막힌 세로 입력을 손가락·관성으로 복구, 정상 입력·늦게 오는 정상 스크롤·취소 보호.');
} finally { await vite.close(); }
