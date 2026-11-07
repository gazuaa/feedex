#!/bin/bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
# 기본으로 사이트의 받기 파일 자리에 만든다. 설정 화면의 '맥 앱 받기'가 이 파일을 내려준다.
output="${1:-$root/public/downloads}"
mkdir -p "$output"
output="$(cd "$output" && pwd)"
sparkle="$("$root/scripts/prepare-sparkle.sh")"
temp="$(mktemp -d)"
trap 'rm -rf "$temp"' EXIT
# 맥 앱 이름은 크롬 앱과 같은 FeedEx다.
bundle="$temp/FeedEx.app"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources" "$bundle/Contents/Frameworks"
ditto "$sparkle/Sparkle.framework" "$bundle/Contents/Frameworks/Sparkle.framework"
cp "$root/native/macos/Info.plist" "$bundle/Contents/Info.plist"
cp "$sparkle/LICENSE" "$bundle/Contents/Resources/Sparkle-LICENSE.txt"
sips -s format icns "$root/public/icons/icon-512.png" --out "$bundle/Contents/Resources/FeedExReader.icns" >/dev/null
for arch in arm64 x86_64; do
  xcrun swiftc -O -parse-as-library -module-cache-path "$temp/module-cache" -target "$arch-apple-macos12.0" "$root"/native/macos/*.swift -F "$sparkle" -framework Sparkle -Xlinker -rpath -Xlinker @executable_path/../Frameworks -o "$temp/reader-$arch"
done
xcrun lipo -create "$temp/reader-arm64" "$temp/reader-x86_64" -output "$bundle/Contents/MacOS/FeedExReader"
codesign --force --sign "${FEEDEX_MAC_SIGN_IDENTITY:--}" "$bundle"
codesign --verify --deep --strict "$bundle"
ditto -c -k --norsrc --noextattr --noacl --keepParent "$bundle" "$output/FeedEx-for-Mac.zip"
# 앱 소스가 바뀌었는데 받기 파일을 다시 만들지 않으면 테스트가 알 수 있게 소스 지문을 함께 남긴다.
(cd "$root" && shasum -a 256 native/macos/*.swift native/macos/Info.plist) | shasum -a 256 | cut -d' ' -f1 > "$output/FeedEx-for-Mac.source"
# 공개 키가 서명 키와 다르면 배포를 중단한다. 개인 키는 출력하지 않는다.
key_file="${FEEDEX_UPDATE_KEY_FILE:-$root/.local/keys/update-ed25519}"
public_key="$(/usr/libexec/PlistBuddy -c 'Print :SUPublicEDKey' "$bundle/Contents/Info.plist")"
if [ "$(xcrun swift -module-cache-path "$root/.local/key-modules" "$root/scripts/update-signing-key.swift" "$key_file")" != "$public_key" ]; then
  printf '%s\n' '업데이트 서명 키가 없거나 공개 키와 다릅니다. FeedEx 전용 키 파일을 확인하세요.' >&2
  exit 1
fi
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$bundle/Contents/Info.plist")"
build="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$bundle/Contents/Info.plist")"
release="FeedEx-for-Mac-$version.zip"
cp "$output/FeedEx-for-Mac.zip" "$output/$release"
signature="$("$sparkle/bin/sign_update" --ed-key-file "$key_file" -p "$output/$release")"
length="$(stat -f %z "$output/$release")"
cat > "$output/appcast.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>FeedEx for Mac</title>
    <link>https://feedex.jyk.workers.dev/</link>
    <item>
      <title>FeedEx $version</title>
      <sparkle:version>$build</sparkle:version>
      <sparkle:shortVersionString>$version</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>12.0</sparkle:minimumSystemVersion>
      <enclosure url="https://feedex.jyk.workers.dev/downloads/$release" length="$length" type="application/octet-stream" sparkle:edSignature="$signature" />
    </item>
  </channel>
</rss>
EOF
"$sparkle/bin/sign_update" --ed-key-file "$key_file" "$output/appcast.xml"
printf '%s\n' "$output/FeedEx-for-Mac.zip"
