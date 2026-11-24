#!/bin/bash
set -euo pipefail

payload="$(cd "$(dirname "$0")" && pwd)/payload"
cep="$HOME/Library/Application Support/Adobe/CEP/extensions"
figma="$HOME/Documents/Sendwich Figma"
legacy_figma="$HOME/Documents/Vector Bridge Figma"
if [[ ! -f "$figma/manifest.json" && -f "$legacy_figma/manifest.json" ]]; then
  figma="$legacy_figma"
fi

for folder in VectorBridgeAE VectorBridgeAI; do
  test -f "$payload/$folder/CSXS/manifest.xml"
done
test -f "$payload/VectorBridgeFigma/manifest.json"
mkdir -p "$cep" "$(dirname "$figma")"

for folder in VectorBridgeAE VectorBridgeAI; do
  ditto "$payload/$folder" "$cep/$folder"
done
ditto "$payload/VectorBridgeFigma" "$figma"
for version in 9 10 11 12 13; do
  defaults write "com.adobe.CSXS.$version" PlayerDebugMode -string 1
done
printf '%s\n' "$figma/manifest.json"
