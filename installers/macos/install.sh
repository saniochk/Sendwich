#!/bin/bash
set -euo pipefail

payload="$(cd "$(dirname "$0")" && pwd)/payload"
cep="$HOME/Library/Application Support/Adobe/CEP/extensions"
figma="$HOME/Documents/Sendwich Figma"
legacy_figma="$HOME/Documents/Vector Bridge Figma"
if [[ ! -f "$figma/manifest.json" && -f "$legacy_figma/manifest.json" ]]; then
  figma="$legacy_figma"
fi

for panel in AE AI; do
  test -f "$payload/Sendwich$panel/CSXS/manifest.xml"
done
test -f "$payload/SendwichFigma/manifest.json"
mkdir -p "$cep" "$(dirname "$figma")"

for panel in AE AI; do
  ditto "$payload/Sendwich$panel" "$cep/VectorBridge$panel"
done
ditto "$payload/SendwichFigma" "$figma"
for version in 9 10 11 12 13; do
  defaults write "com.adobe.CSXS.$version" PlayerDebugMode -string 1
done
printf '%s\n' "$figma/manifest.json"
