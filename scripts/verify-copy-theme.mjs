import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { createServer } from 'vite';
const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'silent' });
try {
  const { COPY_THEME_MARKUP } = await vite.ssrLoadModule('/src/client/copyTheme.ts');
  const script = /<script nonce="sfeed-scroll">([\s\S]*?)<\/script>/.exec(COPY_THEME_MARKUP)?.[1];
  assert.ok(script);
  const events = new EventTarget(), root = { dataset: {} }, messages = [];
  let mediaChange;
  const parent = { postMessage: value => messages.push(value) }, preference = { matches: false, addEventListener: (_, listener) => { mediaChange = listener; } };
  runInNewContext(script, { document: { documentElement: root }, parent, matchMedia: () => preference, addEventListener: events.addEventListener.bind(events) });
  const message = (source, data) => { const event = new Event('message'); Object.assign(event, { source, data }); events.dispatchEvent(event); };
  assert.equal(root.dataset.sfeedTheme, 'light');
  assert.equal(messages[0].sfeedThemeReady, true, '새 프레임은 앱에 현재 테마를 요청한다');
  message({}, { sfeedTheme: 'dark' }); assert.equal(root.dataset.sfeedTheme, 'light', '부모가 아닌 창의 메시지는 무시한다');
  message(parent, { sfeedTheme: 'dark' }); assert.equal(root.dataset.sfeedTheme, 'dark', '운영체제와 달라도 앱의 선택을 따른다');
  preference.matches = false; mediaChange(); assert.equal(root.dataset.sfeedTheme, 'dark', '기기 테마가 앱 설정을 덮지 않는다');
  message(parent, { sfeedTheme: '<script>' }); assert.equal(root.dataset.sfeedTheme, 'dark');
  message(parent, { sfeedTheme: 'light' }); assert.equal(root.dataset.sfeedTheme, 'light', '다시 불러오지 않고 밝은 테마로 돌아간다');
  assert.doesNotMatch(COPY_THEME_MARKUP, /filter\s*:/, '사진과 영상은 반전하지 않는다');
  console.log('통과: 격리된 사본의 앱 테마 전달, 준비 알림, 출처 검사, 기기 설정과 분리, 사진 색 보존.');
} finally { await vite.close(); }
