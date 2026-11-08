#!/bin/bash
set -euo pipefail

# FeedEx 윈도우 앱을 만들어 사이트의 받기 파일 자리에 둔다. 맥에서도 .NET SDK만 있으면 만들 수 있다.
root="$(cd "$(dirname "$0")/.." && pwd)"
output="${1:-$root/public/downloads}"
mkdir -p "$output"
output="$(cd "$output" && pwd)"
project="$root/native/windows/FeedEx.csproj"
temp="$(mktemp -d)"
trap 'rm -rf "$temp"' EXIT

dotnet build "$project" -c Release -o "$temp/build" --nologo -v quiet -p:ContinuousIntegrationBuild=true >/dev/null
version="$(sed -n 's:.*<Version>\(.*\)</Version>.*:\1:p' "$project")"
webview="$(sed -n 's:.*Include="Microsoft.Web.WebView2" Version="\([^"]*\)".*:\1:p' "$project")"
packages="$(dotnet nuget locals global-packages -l | sed 's/^global-packages: //')"

# 압축을 풀면 FeedEx 폴더 하나가 나온다. 앱이 쓰는 파일만 넣는다.
stage="$temp/FeedEx"
mkdir -p "$stage"
cp "$temp/build/FeedEx.exe" "$temp/build/FeedEx.exe.config" "$temp/build/Microsoft.Web.WebView2.Core.dll" "$temp/build/Microsoft.Web.WebView2.WinForms.dll" "$stage/"
for arch in x86 x64 arm64; do
  mkdir -p "$stage/runtimes/win-$arch/native"
  cp "$temp/build/runtimes/win-$arch/native/WebView2Loader.dll" "$stage/runtimes/win-$arch/native/"
done
cp "$packages/microsoft.web.webview2/$webview/LICENSE.txt" "$stage/WebView2-LICENSE.txt"
# 같은 소스로 다시 만들면 같은 zip이 나오도록 파일 시각을 고정한다.
find "$stage" -exec touch -t 202601010000 {} +
rm -f "$output/FeedEx-for-Windows.zip"
(cd "$temp" && zip -X -r -q "$output/FeedEx-for-Windows.zip" FeedEx)
release="FeedEx-for-Windows-$version.zip"
cp "$output/FeedEx-for-Windows.zip" "$output/$release"

# 앱의 '업데이트 확인'이 읽는 최신 버전 정보.
sha="$(shasum -a 256 "$output/$release" | cut -d' ' -f1)"
printf '{"version":"%s","download":"https://feedex.jyk.workers.dev/downloads/%s","sha256":"%s"}\n' "$version" "$release" "$sha" > "$output/FeedEx-for-Windows.json"
# 앱 소스가 바뀌었는데 받기 파일을 다시 만들지 않으면 테스트가 알 수 있게 소스 지문을 남긴다.
(cd "$root" && shasum -a 256 native/windows/*.cs native/windows/FeedEx.csproj native/windows/App.config native/windows/app.manifest native/windows/FeedEx.ico) | shasum -a 256 | cut -d' ' -f1 > "$output/FeedEx-for-Windows.source"
printf '%s\n' "$output/FeedEx-for-Windows.zip"
