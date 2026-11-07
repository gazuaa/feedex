#!/bin/bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
# 기본으로 사이트의 받기 파일 자리에 만든다. 설정 화면의 '맥 앱 받기'가 이 파일을 내려준다.
output="${1:-$root/public/downloads}"
mkdir -p "$output"
output="$(cd "$output" && pwd)"
temp="$(mktemp -d)"
trap 'rm -rf "$temp"' EXIT
# 맥 앱 이름은 크롬 앱과 같은 FeedEx다.
bundle="$temp/FeedEx.app"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
cp "$root/native/macos/Info.plist" "$bundle/Contents/Info.plist"
sips -s format icns "$root/public/icons/icon-512.png" --out "$bundle/Contents/Resources/FeedExReader.icns" >/dev/null
for arch in arm64 x86_64; do
  xcrun swiftc -O -parse-as-library -module-cache-path "$temp/module-cache" -target "$arch-apple-macos12.0" "$root"/native/macos/*.swift -o "$temp/reader-$arch"
done
xcrun lipo -create "$temp/reader-arm64" "$temp/reader-x86_64" -output "$bundle/Contents/MacOS/FeedExReader"
codesign --force --sign "${FEEDEX_MAC_SIGN_IDENTITY:--}" "$bundle"
codesign --verify --strict "$bundle"
ditto -c -k --norsrc --noextattr --noacl --keepParent "$bundle" "$output/FeedEx-for-Mac.zip"
# 앱 소스가 바뀌었는데 받기 파일을 다시 만들지 않으면 테스트가 알 수 있게 소스 지문을 함께 남긴다.
(cd "$root" && shasum -a 256 native/macos/*.swift native/macos/Info.plist) | shasum -a 256 | cut -d' ' -f1 > "$output/FeedEx-for-Mac.source"
printf '%s\n' "$output/FeedEx-for-Mac.zip"
