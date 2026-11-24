#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."

version="${1:-0.34.1}"
[[ "$version" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] || { echo "Invalid version" >&2; exit 1; }
work="$(mktemp -d)"
trap 'rm -r "$work"' EXIT
mkdir -p dist "$work/image"
app="$work/image/Install Sendwich.app"
image="$PWD/dist/Sendwich-$version-macOS.dmg"

osacompile -o "$app" installers/macos/Installer.applescript
resources="$app/Contents/Resources"
mkdir -p "$resources/payload"
cp installers/macos/install.sh "$resources/"
for folder in SendwichAE SendwichAI SendwichFigma; do
  ditto "$folder" "$resources/payload/$folder"
done
mkdir "$work/Sendwich.iconset"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" installers/macos/sendwich-mascot.png --out "$work/Sendwich.iconset/icon_${size}x${size}.png" >/dev/null
  sips -z "$((size*2))" "$((size*2))" installers/macos/sendwich-mascot.png --out "$work/Sendwich.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$work/Sendwich.iconset" -o "$resources/applet.icns"
plutil -replace CFBundleIdentifier -string com.vectorbridge.installer "$app/Contents/Info.plist"
plutil -replace CFBundleShortVersionString -string "$version" "$app/Contents/Info.plist"
plutil -replace CFBundleVersion -string "$version" "$app/Contents/Info.plist"

if [[ -n "${MACOS_SIGN_IDENTITY:-}" ]]; then
  codesign --force --options runtime --timestamp --sign "$MACOS_SIGN_IDENTITY" "$app"
  codesign --verify --strict "$app"
else
  codesign --force --sign - "$app"
fi
hdiutil create -ov -volname "Sendwich" -srcfolder "$work/image" -format UDZO "$image"
hdiutil verify "$image"
if [[ -n "${MACOS_SIGN_IDENTITY:-}" ]]; then
  codesign --timestamp --sign "$MACOS_SIGN_IDENTITY" "$image"
fi
if [[ -n "${MACOS_NOTARY_PROFILE:-}" ]]; then
  : "${MACOS_SIGN_IDENTITY:?A Developer ID Application identity is required for notarization}"
  xcrun notarytool submit "$image" --keychain-profile "$MACOS_NOTARY_PROFILE" --wait
  xcrun stapler staple "$image"
  xcrun stapler validate "$image"
fi
