#!/bin/zsh
set -euo pipefail

script_dir="${0:A:h}"
project_root="${script_dir:h}"
output_path="${1:-${project_root}/Evan 项目控制器.app}"

build_root="$(mktemp -d "${TMPDIR:-/tmp}/evan-controller.XXXXXX")"
trap 'rm -rf "$build_root"' EXIT

app_path="$build_root/Evan项目控制器.app"
contents_path="$app_path/Contents"
resources_path="$contents_path/Resources"
macos_path="$contents_path/MacOS"
iconset_path="$build_root/EvanController.iconset"

mkdir -p "$resources_path" "$macos_path" "$iconset_path"

xcrun swiftc \
  -parse-as-library \
  -O \
  -framework SwiftUI \
  -framework AppKit \
  -framework Combine \
  "$script_dir/EvanProjectController.swift" \
  -o "$macos_path/EvanProjectController"

cp "$script_dir/EvanProjectController-Info.plist" "$contents_path/Info.plist"
cp "$project_root/public/apple-touch-icon.png" "$resources_path/Evan-logo.png"

for spec in \
  "16 icon_16x16.png" \
  "32 icon_16x16@2x.png" \
  "32 icon_32x32.png" \
  "64 icon_32x32@2x.png" \
  "128 icon_128x128.png" \
  "256 icon_128x128@2x.png" \
  "256 icon_256x256.png" \
  "512 icon_256x256@2x.png" \
  "512 icon_512x512.png" \
  "1024 icon_512x512@2x.png"
do
  size="${spec%% *}"
  name="${spec#* }"
  sips -z "$size" "$size" "$project_root/public/apple-touch-icon.png" \
    --out "$iconset_path/$name" >/dev/null
done

iconutil -c icns "$iconset_path" -o "$resources_path/EvanController.icns"
codesign --force --deep --sign - "$app_path" >/dev/null

mkdir -p "${output_path:h}"
previous_app=""
if [[ -e "$output_path" ]]; then
  previous_app="$build_root/previous.app"
  mv "$output_path" "$previous_app"
fi

if ! mv "$app_path" "$output_path"; then
  if [[ -n "$previous_app" && -e "$previous_app" ]]; then
    mv "$previous_app" "$output_path"
  fi
  print -u2 "无法写入控制器 App：$output_path"
  exit 1
fi
print "$output_path"
