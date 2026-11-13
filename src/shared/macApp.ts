// 맥 앱 받기. 앱 파일은 사이트의 정적 파일로 함께 배포한다(public/downloads).
// 앱을 고치면 native/macos/Info.plist의 버전과 이 값을 함께 올리고 scripts/build-macos-reader.sh로 다시 만든다.
export const MAC_APP_VERSION = '2.5';
// 버전을 주소에 붙여, 새로 올린 뒤에도 브라우저가 예전 파일을 주지 않게 한다.
export const MAC_APP_DOWNLOAD = `/downloads/FeedEx-for-Mac.zip?v=${MAC_APP_VERSION}`;

// 맥 앱의 기본 창을 연다. 브라우저의 PWA 연결과 별개인 앱 전용 주소다.
export const MAC_APP_OPEN = 'feedex-reader://launch';

// 서명 없는 앱을 처음 열면 macOS가 막는다. '그래도 열기'가 있는 보안 설정 화면을 바로 연다.
// 예전 화면 주소라 macOS 12에서도 열리고, 13 이후에는 '개인정보 보호 및 보안'으로 이어진다.
export const MAC_SECURITY_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?General';

/** 맥의 브라우저인지. iPad는 맥처럼 알리지만 손가락 입력이 있어 뺀다. */
export function onMacBrowser(userAgent: string, touchPoints: number): boolean {
  return /Macintosh/.test(userAgent) && touchPoints < 2;
}
