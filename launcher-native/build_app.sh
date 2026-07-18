#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_FILE="$ROOT_DIR/launcher-native/TwitCanvaLauncher.swift"
APP_PATH="$ROOT_DIR/Evan工作台.app"
LEGACY_APP_PATH="$ROOT_DIR/TwitCanva工作台.app"
BUILD_DIR="$ROOT_DIR/launcher-native/.build"
APP_BUILD="$BUILD_DIR/Evan工作台.app"
ICONSET="$BUILD_DIR/TwitCanva.iconset"

rm -rf "$BUILD_DIR"
mkdir -p "$APP_BUILD/Contents/MacOS" "$APP_BUILD/Contents/Resources" "$ICONSET"

xcrun swiftc \
  -swift-version 5 \
  -parse-as-library \
  -target arm64-apple-macos13.0 \
  -O \
  -framework SwiftUI \
  -framework AppKit \
  "$SOURCE_FILE" \
  -o "$APP_BUILD/Contents/MacOS/TwitCanvaLauncher"

BASE_ICON="$ROOT_DIR/public/TwitCanva-logo.png"
sips -z 1024 1024 "$BASE_ICON" --out "$BUILD_DIR/icon-1024.png" >/dev/null
for spec in "16:icon_16x16.png" "32:icon_16x16@2x.png" "32:icon_32x32.png" "64:icon_32x32@2x.png" "128:icon_128x128.png" "256:icon_128x128@2x.png" "256:icon_256x256.png" "512:icon_256x256@2x.png" "512:icon_512x512.png" "1024:icon_512x512@2x.png"; do
  size="${spec%%:*}"
  name="${spec##*:}"
  sips -z "$size" "$size" "$BUILD_DIR/icon-1024.png" --out "$ICONSET/$name" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP_BUILD/Contents/Resources/TwitCanva.icns"

cat > "$APP_BUILD/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>zh_CN</string>
  <key>CFBundleDisplayName</key><string>Evan工作台</string>
  <key>CFBundleExecutable</key><string>TwitCanvaLauncher</string>
  <key>CFBundleIconFile</key><string>TwitCanva</string>
  <key>CFBundleIdentifier</key><string>com.dasheng.twitcanva.launcher</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>Evan工作台</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>2.0</string>
  <key>CFBundleVersion</key><string>2</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSQuitAlwaysKeepsWindows</key><false/>
  <key>NSSupportsAutomaticGraphicsSwitching</key><true/>
</dict>
</plist>
PLIST

codesign --force --deep --sign - "$APP_BUILD" >/dev/null
rm -rf "$APP_PATH"
rm -rf "$LEGACY_APP_PATH"
mv "$APP_BUILD" "$APP_PATH"
echo "$APP_PATH"
