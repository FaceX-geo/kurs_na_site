#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_logo="${project_root}/assets/images/logo-top.png"
output_logo="${project_root}/assets/images/logo-top-transparent.png"
output_logo_light="${project_root}/assets/images/logo-top-transparent-light.png"
temporary_directory="$(mktemp -d)"
trap 'rm -rf "${temporary_directory}"' EXIT

# Recover foreground colour and alpha from an image composited on pure white.
magick "${source_logo}" \
  -alpha off \
  -fx 'aa=1-min(u.r,min(u.g,u.b)); aa<0.003?0:(u-1+aa)/aa' \
  "${temporary_directory}/foreground.png"

magick "${source_logo}" \
  -alpha off \
  -fx '1-min(u.r,min(u.g,u.b))' \
  "${temporary_directory}/alpha.png"

magick \
  "${temporary_directory}/foreground.png" \
  "${temporary_directory}/alpha.png" \
  -alpha off \
  -compose CopyOpacity \
  -composite \
  "${output_logo}"

# On a dark footer, convert only the recovered black typography/strokes to white.
magick "${output_logo}" \
  -channel RGB \
  -fx 'max(u.r,max(u.g,u.b))<0.12?1:u' \
  "${output_logo_light}"

echo "Generated transparent logo assets."
