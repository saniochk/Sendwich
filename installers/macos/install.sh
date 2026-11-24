#!/bin/bash
set -euo pipefail

payload="$(cd "$(dirname "$0")" && pwd)/payload"
cep="$HOME/Library/Application Support/Adobe/CEP/extensions"
figma="$HOME/Documents/Sendwich/Figma"
backup_root="$HOME/Library/Application Support/Sendwich/Previous Panels"
backup=""
previous=()

for panel in AE AI; do
  test -f "$payload/Sendwich$panel/CSXS/manifest.xml"
done
test -f "$payload/SendwichFigma/manifest.json"
mkdir -p "$cep" "$(dirname "$figma")"

restore_on_error() {
  if [[ -n "$backup" ]]; then
    for name in "${previous[@]}"; do
      mv -n "$backup/$name" "$cep/$name"
    done
  fi
}
trap restore_on_error ERR
for old in "$cep"/*; do
  [[ -d "$old" && ! -L "$old" ]] || continue
  name="${old##*/}"
  [[ "$name" != SendwichAE && "$name" != SendwichAI ]] || continue
  host="$old/jsx/host.jsx"
  [[ -f "$old/CSXS/manifest.xml" && -f "$host" ]] || continue
  if { grep -qF 'function vb_begin(' "$host" && grep -qF 'function vb_step(' "$host"; } ||
     { grep -qF 'function vb_send(' "$host" && grep -qF 'function vb_flag(' "$host"; }; then
    if [[ -z "$backup" ]]; then
      mkdir -p "$backup_root"
      backup="$(mktemp -d "$backup_root/upgrade.XXXXXX")"
    fi
    mv "$old" "$backup/$name"
    previous+=("$name")
  fi
done

for panel in AE AI; do
  ditto "$payload/Sendwich$panel" "$cep/Sendwich$panel"
done
ditto "$payload/SendwichFigma" "$figma"
for version in 9 10 11 12 13; do
  defaults write "com.adobe.CSXS.$version" PlayerDebugMode -string 1
done
printf '%s\n' "$figma/manifest.json"
