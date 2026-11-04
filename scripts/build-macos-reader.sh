#!/bin/bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
output="${1:-$root/.local/macos}"
mkdir -p "$output"
output="$(cd "$output" && pwd)"
temp="$(mktemp -d)"
trap 'rm -rf "$temp"' EXIT
bundle="$temp/FeedEx Reader.app"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
cp "$root/native/macos/Info.plist" "$bundle/Contents/Info.plist"
sips -s format icns "$root/public/icons/icon-512.png" --out "$bundle/Contents/Resources/FeedExReader.icns" >/dev/null
for arch in arm64 x86_64; do
  xcrun swiftc -O -parse-as-library -module-cache-path "$temp/module-cache" -target "$arch-apple-macos12.0" "$root/native/macos/Reader.swift" -o "$temp/reader-$arch"
done
xcrun lipo -create "$temp/reader-arm64" "$temp/reader-x86_64" -output "$bundle/Contents/MacOS/FeedExReader"
codesign --force --sign "${FEEDEX_MAC_SIGN_IDENTITY:--}" "$bundle"
codesign --verify --strict "$bundle"
ditto -c -k --norsrc --noextattr --noacl --keepParent "$bundle" "$output/FeedEx-Reader-macOS.zip"
printf '%s\n' "$output/FeedEx-Reader-macOS.zip"
