// 윈도우 앱 받기. 앱 파일은 사이트의 정적 파일로 함께 배포한다(public/downloads).
// 앱을 고치면 native/windows/FeedEx.csproj의 Version과 이 값을 함께 올리고 scripts/build-windows-app.sh로 다시 만든다.
export const WINDOWS_APP_VERSION = '1.2';
// 버전을 주소에 붙여, 새로 올린 뒤에도 브라우저가 예전 파일을 주지 않게 한다.
export const WINDOWS_APP_DOWNLOAD = `/downloads/FeedEx-for-Windows.zip?v=${WINDOWS_APP_VERSION}`;

// 윈도우 앱의 기본 창을 연다. 맥 앱과 같은 주소이고, 앱을 처음 켤 때 지금 사용자에게 등록된다.
export const WINDOWS_APP_OPEN = 'feedex-reader://launch';

/** 윈도우 데스크톱 브라우저인지. */
export function onWindowsBrowser(userAgent: string): boolean {
  return /Windows NT/.test(userAgent) && !/Windows Phone|Xbox/.test(userAgent);
}
