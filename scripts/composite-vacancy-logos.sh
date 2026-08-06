#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image_dir="${project_root}/assets/images"
logo_source="${image_dir}/logo-na-severe-zhit-black.png"

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick is required to composite vacancy logos." >&2
  exit 1
fi

if [[ ! -f "${logo_source}" ]]; then
  echo "Logo master is missing: ${logo_source}" >&2
  exit 1
fi

composite_logo() {
  local name="$1"
  local width="$2"
  local offset_x="$3"
  local offset_y="$4"
  local rotation="${5:-0}"
  local base="${image_dir}/vacancy-${name}-base-v5.png"
  local output_png="${image_dir}/vacancy-${name}-v5.png"
  local output_webp="${image_dir}/vacancy-${name}-v5.webp"

  if [[ ! -f "${base}" ]]; then
    echo "Vacancy base is missing: ${base}" >&2
    exit 1
  fi

  magick \
    "${base}" \
    \( \
      "${logo_source}" \
      -resize "${width}x" \
      -background none \
      -rotate "${rotation}" \
    \) \
    -geometry "+${offset_x}+${offset_y}" \
    -compose Over \
    -composite \
    "${output_png}"

  magick "${output_png}" \
    -strip \
    -quality 88 \
    -define webp:method=6 \
    "${output_webp}"
}

# A single immutable logo master is scaled and positioned on the blank plaque
# already present in each scene. The base images contain no other branding.
composite_logo "engineer" 128 104 219
composite_logo "doctor" 205 128 90
composite_logo "teacher" 240 102 20 -5
composite_logo "port" 268 180 110
composite_logo "energy" 286 99 80
composite_logo "analyst" 292 91 64

echo "Composited six vacancy images with one shared logo master."
