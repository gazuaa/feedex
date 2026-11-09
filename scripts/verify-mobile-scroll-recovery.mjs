import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { parseHTML } from 'linkedom';
const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
try {
  const { rebuildScrollSurface, rebuildingScroll, bindMobileScrollRecovery, needsMobileScrollRecovery } = await vite.ssrLoadModule('/src/client/mobileScrollRecovery.ts');
  const fixture = () => {
    const { document, window } = parseHTML('<html><body><main><div><article data-article-id="x"><p>기존 X 글</p></article></div></main></body></html>');
    const root = document.querySelector('main'), content = root.firstElementChild;
    Object.defineProperty(Object.getPrototypeOf(root.style), 'getPropertyPriority', { configurable: true, value: () => '' });
    let id = 0; const frames = new Map();
    window.requestAnimationFrame = fn => { frames.set(++id, fn); return id; }; window.cancelAnimationFrame = key => frames.delete(key);
    const paint = () => { for (const [key, fn] of [...frames]) { frames.delete(key); fn(); } };
    Object.defineProperties(root, { scrollHeight: { value: 2000 }, clientHeight: { value: 500 } }); root.scrollTop = 300;
    const touch = (type, x, y, options = {}) => {
      const e = new window.Event(type, { bubbles: true, cancelable: true });
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
  assert.equal(needsMobileScrollRecovery('Mozilla iPhone', 1), true); assert.equal(needsMobileScrollRecovery('Mozilla Macintosh', 5), true);
  assert.equal(needsMobileScrollRecovery('Mozilla Macintosh', 0), false); assert.equal(needsMobileScrollRecovery('Mozilla Android', 5), false);
  console.log('통과: iPhone·iPad만 스크롤 계층 재구성, DOM·위치 보존, 막힌 세로 입력 자동 복구와 정상 입력·취소 보호.');
} finally { await vite.close(); }
