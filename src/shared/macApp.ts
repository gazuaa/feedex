// 맥 앱 받기. 앱 파일은 사이트의 정적 파일로 함께 배포한다(public/downloads).
// 앱을 고치면 native/macos/Info.plist의 버전과 이 값을 함께 올리고 scripts/build-macos-reader.sh로 다시 만든다.
export const MAC_APP_VERSION = '2.1';
// 버전을 주소에 붙여, 새로 올린 뒤에도 브라우저가 예전 파일을 주지 않게 한다.
export const MAC_APP_DOWNLOAD = `/downloads/FeedEx-for-Mac.zip?v=${MAC_APP_VERSION}`;

/** 맥의 브라우저인지. iPad는 맥처럼 알리지만 손가락 입력이 있어 뺀다. */
export function onMacBrowser(userAgent: string, touchPoints: number): boolean {
  return /Macintosh/.test(userAgent) && touchPoints < 2;
}
