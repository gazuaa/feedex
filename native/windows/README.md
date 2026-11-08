# FeedEx for Windows

맥 앱(native/macos)과 같은 일을 하는 윈도우 앱이다. FeedEx 화면을 창으로 띄우고, 웹 보기 자리에는
원문 사이트를 직접 연 화면을 겹쳐 놓는다. 두 화면이 같은 WebView2 저장소를 써서 언론사 로그인이 유지된다.

- 윈도우 10·11에 기본으로 있는 .NET Framework 4.8과 Microsoft Edge WebView2 런타임을 쓴다. 받는 파일은 1MB 안팎이다.
- 설치 프로그램 없이 zip을 풀어 `FeedEx.exe`를 연다. 처음 켜면 지금 사용자에게 `feedex-reader://` 주소와 시작 메뉴 바로 가기를 등록한다.
- 코드 서명이 없어 처음 한 번은 SmartScreen이 막는다. '추가 정보' → '실행'으로 연다.
- 앱 저장소는 `%LOCALAPPDATA%\FeedEx`, 배율과 창 위치는 `HKCU\Software\FeedEx`에 둔다.

## 웹과 주고받는 메시지

웹은 `window.chrome.webview.postMessage({ channel, body })`로 보낸다. 앱은 FeedEx 화면의 맨 위 문서가 보낸 것만 받는다.

- `channel: 'feedex'`: 맥 앱과 같은 메시지(`article`, `signIn`, `checkForUpdates`, `appScale`, `openExternal`).
- `channel: 'notifications'`: 맥 앱의 알림 요청에 번호(`id`)를 붙인 것. 앱은 같은 번호로 `result`나 `error`를 돌려준다.

앱은 문서마다 `window.feedexWindowsApp = true`와 `window.feedexAppScale`을 먼저 넣는다. 웹은 이 표시가 있어야 윈도우 앱으로 본다.

배율은 앱이 정한다. WebView2는 페이지를 새로 불러오면 배율을 100%로 되돌리므로 불러올 때마다 다시 맞춘다.
FeedEx 화면에서는 Ctrl+휠 확대를 끄고, Ctrl+-·+·0을 앱 배율(기본 90%)로 받는다.

## 로그인

구글은 앱 안 웹 화면의 로그인을 막으므로 기본 브라우저에서 `/?native-sign-in=windows&state=<임의 값>`을 연다.
그 화면이 `feedex-reader://signed-in?code=...&state=...`로 돌려보내면, 앱은 자기가 만든 상태 값과 맞고 10분이 지나지 않았을 때
한 번만 코드를 받는다. 아무 웹사이트나 이 주소를 열 수 있어서, 상태 값 없이 받으면 남의 계정으로 로그인될 수 있다.

## 새 버전 배포

1. `FeedEx.csproj`의 `Version`과 `src/shared/windowsApp.ts`의 버전을 함께 올린다.
2. `./scripts/build-windows-app.sh`를 실행한다. .NET SDK만 있으면 맥에서도 만든다(`brew install dotnet`).
3. `npm run test:windows-app`과 `npm run build`를 통과시킨다.
4. 새 버전 zip, 기본 zip, `FeedEx-for-Windows.json`, 소스 지문을 함께 배포한다. 기존 버전 이름의 zip은 바꾸지 않는다.
5. 푸시하면 GitHub Actions의 `Windows app`이 실제 윈도우에서 zip을 풀어 켜 보고, 기록과 화면 그림을 남긴다.

앱은 스스로 파일을 바꾸지 않는다. '업데이트 확인'은 새 버전이 있으면 받을 zip을 기본 브라우저로 연다.

## 개발 도구

`FEEDEX_HOME`으로 시험 서버(https 또는 이 컴퓨터의 http)를 열 수 있다. 이때는 주소 등록과 바로 가기를 건너뛰고, 평소 앱과 따로 돈다.
`FEEDEX_DEBUG_DIR`을 주면 받은 메시지(`messages.log`), 상태(`state.log`), 창 그림(`window.png`, `screen.png`)을 남기고 그 폴더의 `run.js`를 실행한다.
주소·로그인·배율 규칙은 `dotnet run --project native/windows/Tests/Tests.csproj`로 맥에서도 시험한다.
