#!/bin/bash
set -euo pipefail
# 공식 배포판을 버전과 SHA-256으로 고정한다. 비공개 업데이트 키는 이 맥의 접근이 제한된 파일에서만 읽는다.
root="$(cd "$(dirname "$0")/.." && pwd)"
version="2.10.1"
sha="1a856d2a9edb8e628de88121d7be04cf0e2167f8641650b78fca00b14244cf27"
archive="$root/.local/sparkle-$version.tar.xz"
folder="$root/.local/sparkle-$version"
mkdir -p "$root/.local"
if [ ! -f "$archive" ]; then
  curl --fail --location --silent --show-error "https://github.com/sparkle-project/Sparkle/releases/download/$version/Sparkle-$version.tar.xz" -o "$archive"
fi
printf '%s  %s\n' "$sha" "$archive" | shasum -a 256 --check >/dev/null
mkdir -p "$folder"
tar -xJf "$archive" -C "$folder"
printf '%s\n' "$folder"
