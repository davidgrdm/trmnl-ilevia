#!/usr/bin/env bash
# Construit le .zip à importer dans TRMNL (Plugins > Private Plugin > Import).
# Usage : scripts/package.sh <compte-github>   ->  dist/trmnl-ilevia.zip
set -euo pipefail
user="${1:?Usage: scripts/package.sh <compte-github>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for f in settings.yml shared.liquid full.liquid half_horizontal.liquid half_vertical.liquid quadrant.liquid transform.js; do
  sed "s/REPLACE_ME/${user}/g" "$root/plugin/$f" > "$tmp/$f"
done

mkdir -p "$root/dist"
rm -f "$root/dist/trmnl-ilevia.zip"
(cd "$tmp" && zip -q -X "$root/dist/trmnl-ilevia.zip" ./*)
echo "dist/trmnl-ilevia.zip (URL horaires : https://${user}.github.io/trmnl-ilevia/metro/)"
