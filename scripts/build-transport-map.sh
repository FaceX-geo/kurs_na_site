#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TASK_TMP="$(mktemp -d "${TMPDIR:-/tmp}/kurs-transport-map.XXXXXX")"
trap 'rm -rf "${TASK_TMP}"' EXIT

MAGICK_BIN="${MAGICK_BIN:-magick}"
CANVAS_WIDTH=1672
CANVAS_HEIGHT=941

EXACT_BASE="${PROJECT_ROOT}/tmp/source/transport-exact-preview-v2.png"
EXACT_SOURCE="${PROJECT_ROOT}/tmp/source/european-russia-northwest-landscape.png"
LAND_MASK="${PROJECT_ROOT}/tmp/source/transport-land-mask.png"
RELIEF_TEXTURE="${PROJECT_ROOT}/tmp/source/transport-relief-overlay.png"

PLANE_SOURCE="${PROJECT_ROOT}/assets/images/transport-plane-cutout-v8.png"
TRAIN_SOURCE="${PROJECT_ROOT}/assets/images/transport-train-cutout-v8.png"
PLANE_ISOLATED="${PROJECT_ROOT}/assets/images/transport-plane-isolated-v8.png"
TRAIN_ISOLATED="${PROJECT_ROOT}/assets/images/transport-train-isolated-v8.png"

LABEL_MOSCOW="${PROJECT_ROOT}/assets/images/transport-label-moscow-v8.png"
LABEL_MURMANSK="${PROJECT_ROOT}/assets/images/transport-label-murmansk-v8.png"
LABEL_SPB="${PROJECT_ROOT}/assets/images/transport-label-spb-v8.png"
LABEL_TRAIN="${PROJECT_ROOT}/assets/images/transport-label-train-v8.png"

OUTPUT_PNG="${PROJECT_ROOT}/assets/images/transport-russia-relief-v8.png"
OUTPUT_WEBP="${PROJECT_ROOT}/assets/images/transport-russia-relief-v8.webp"
OUTPUT_MOBILE_PNG="${PROJECT_ROOT}/assets/images/transport-russia-relief-mobile-v8.png"
OUTPUT_MOBILE_WEBP="${PROJECT_ROOT}/assets/images/transport-russia-relief-mobile-v8.webp"

MOBILE_CROP_WIDTH=980
MOBILE_CROP_HEIGHT=941
MOBILE_CROP_X=70
MOBILE_CROP_Y=0

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "Missing required asset: $1" >&2
    exit 1
  fi
}

require_dimensions() {
  local file="$1"
  local expected="${2}x${3}"
  local actual
  actual="$(${MAGICK_BIN} identify -format '%wx%h' "${file}")"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "Unexpected dimensions for ${file}: ${actual}, expected ${expected}" >&2
    exit 1
  fi
}

mask_label() {
  local input="$1"
  local output="$2"
  local width="$3"
  local height="$4"
  local polygon="$5"

  ${MAGICK_BIN} -size "${width}x${height}" xc:black \
    -fill white -stroke none -draw "polygon ${polygon}" \
    -blur 0x0.45 "${TASK_TMP}/label-mask.png"
  ${MAGICK_BIN} "${input}" "${TASK_TMP}/label-mask.png" \
    -alpha off -compose CopyOpacity -composite "${output}"
}

assert_route_on_land() {
  local route_name="$1"
  local route_points="$2"
  local stroke_width="$3"
  local qa_slug="${route_name//[^a-zA-Z0-9_-]/-}"
  local route_mask="${TASK_TMP}/${qa_slug}-${stroke_width}px-route-mask.png"
  local water_hits="${TASK_TMP}/${qa_slug}-${stroke_width}px-water-hits.png"
  local water_pixels

  ${MAGICK_BIN} -size "${CANVAS_WIDTH}x${CANVAS_HEIGHT}" xc:'#000000' \
    -fill none -stroke white -strokewidth "${stroke_width}" \
    -draw "stroke-linejoin round polyline ${route_points}" \
    -alpha off -threshold 1% "${route_mask}"
  ${MAGICK_BIN} "${route_mask}" "${TASK_TMP}/water-mask.png" \
    -alpha off -compose Multiply -composite -alpha off -threshold 1% \
    "${water_hits}"

  water_pixels="$(${MAGICK_BIN} "${water_hits}" -alpha off \
    -format '%[fx:round(mean.r*w*h)]' info:)"
  echo "QA ${route_name} ${stroke_width}px water_pixels=${water_pixels}"

  if [[ "${water_pixels}" != "0" ]]; then
    echo "Route QA failed: ${route_name} ${stroke_width}px intersects water at ${water_pixels} pixels" >&2
    exit 1
  fi
}

for required in \
  "${EXACT_BASE}" \
  "${EXACT_SOURCE}" \
  "${LAND_MASK}" \
  "${RELIEF_TEXTURE}" \
  "${PLANE_SOURCE}" \
  "${TRAIN_SOURCE}" \
  "${LABEL_MOSCOW}" \
  "${LABEL_MURMANSK}" \
  "${LABEL_SPB}" \
  "${LABEL_TRAIN}"; do
  require_file "${required}"
done

require_dimensions "${EXACT_BASE}" "${CANVAS_WIDTH}" "${CANVAS_HEIGHT}"
require_dimensions "${EXACT_SOURCE}" "${CANVAS_WIDTH}" "${CANVAS_HEIGHT}"
require_dimensions "${LAND_MASK}" "${CANVAS_WIDTH}" "${CANVAS_HEIGHT}"

# ImageGen returned a visual checkerboard instead of actual transparency.
# Recover the generated plane as a real alpha asset without redrawing it.
${MAGICK_BIN} "${PLANE_SOURCE}" -crop 50x50+0+0 +repage "${TASK_TMP}/checker-tile.png"
${MAGICK_BIN} -size 1254x1254 "tile:${TASK_TMP}/checker-tile.png" "${TASK_TMP}/checker-model.png"
${MAGICK_BIN} "${PLANE_SOURCE}" "${TASK_TMP}/checker-model.png" \
  -compose difference -composite -colorspace gray "${TASK_TMP}/plane-difference.png"
${MAGICK_BIN} "${TASK_TMP}/plane-difference.png" -threshold 10% \
  -morphology Close Disk:24 -morphology Open Disk:1 \
  -fill none -stroke white -strokewidth 86 -draw 'line 150,1030 945,325' \
  "${TASK_TMP}/plane-mask-bridged.png"
${MAGICK_BIN} "${TASK_TMP}/plane-mask-bridged.png" -negate \
  -fill black -draw 'color 0,0 floodfill' "${TASK_TMP}/plane-enclosed-holes.png"
${MAGICK_BIN} "${TASK_TMP}/plane-mask-bridged.png" "${TASK_TMP}/plane-enclosed-holes.png" \
  -compose Lighten -composite -blur 0x1 "${TASK_TMP}/plane-mask.png"
${MAGICK_BIN} "${PLANE_SOURCE}" "${TASK_TMP}/plane-mask.png" \
  -alpha off -compose CopyOpacity -composite -trim +repage "${PLANE_ISOLATED}"

# The dark train can be isolated safely by removing the connected pale checkerboard.
${MAGICK_BIN} "${TRAIN_SOURCE}" -alpha on -channel rgba -fuzz 13% \
  -fill none -draw 'alpha 0,0 floodfill' -trim +repage "${TRAIN_ISOLATED}"

# Keep the text exactly as generated, but remove the terrain pixels around each plaque.
mask_label "${LABEL_MOSCOW}" "${TASK_TMP}/label-moscow.png" 220 58 \
  '9,3 207,3 218,14 218,43 207,52 9,52 1,45 1,12'
mask_label "${LABEL_MURMANSK}" "${TASK_TMP}/label-murmansk.png" 150 50 \
  '8,2 140,2 148,10 148,39 140,47 8,47 1,40 1,10'
mask_label "${LABEL_SPB}" "${TASK_TMP}/label-spb.png" 330 58 \
  '10,1 320,1 329,10 329,44 320,52 10,52 1,45 1,10'
mask_label "${LABEL_TRAIN}" "${TASK_TMP}/label-train.png" 250 58 \
  '9,2 240,2 248,11 248,44 240,52 9,52 1,44 1,11'

# Keep neighbouring countries visibly dry land instead of letting their dark fill
# read as water. The mask is sampled from the exact source palette and preserves
# every coastline, international border and lake contour from that source.
${MAGICK_BIN} "${EXACT_SOURCE}" -alpha on -fuzz 5% \
  -transparent 'rgb(224,224,224)' -alpha extract -negate \
  "${TASK_TMP}/foreign-land-mask.png"
${MAGICK_BIN} -size "${CANVAS_WIDTH}x${CANVAS_HEIGHT}" xc:'#2a4158' \
  "${TASK_TMP}/foreign-land-mask.png" -alpha off -compose CopyOpacity -composite \
  -channel A -evaluate multiply 0.78 "${TASK_TMP}/foreign-land-fill.png"
${MAGICK_BIN} "${EXACT_BASE}" "${TASK_TMP}/foreign-land-fill.png" \
  -compose Over -composite "${TASK_TMP}/base-land-separated.png"

# Use ImageGen relief only as a monochrome light texture. Exact coastlines, lakes,
# borders and land continuity remain entirely defined by the cartographic base.
${MAGICK_BIN} "${RELIEF_TEXTURE}" -resize "${CANVAS_WIDTH}x${CANVAS_HEIGHT}!" \
  -colorspace gray -contrast-stretch 3%x3% -blur 0x1 "${TASK_TMP}/relief-gray.png"
${MAGICK_BIN} "${TASK_TMP}/relief-gray.png" "${LAND_MASK}" \
  -alpha off -compose CopyOpacity -composite -channel A -evaluate multiply 0.16 \
  "${TASK_TMP}/relief-land.png"
${MAGICK_BIN} "${TASK_TMP}/base-land-separated.png" "${TASK_TMP}/relief-land.png" \
  -compose SoftLight -composite "${TASK_TMP}/base-relief.png"

# Premium route corridor light: restrained cyan in the north, blue in the centre,
# and a berry accent around Moscow. It never modifies geographic geometry.
${MAGICK_BIN} -size "${CANVAS_WIDTH}x${CANVAS_HEIGHT}" xc:none \
  -fill 'rgba(50,221,255,0.15)' -draw 'circle 620,80 860,80' \
  -fill 'rgba(38,125,255,0.10)' -draw 'circle 575,500 820,500' \
  -fill 'rgba(234,45,102,0.12)' -draw 'circle 665,875 890,875' \
  -blur 0x105 "${TASK_TMP}/corridor-light.png"
${MAGICK_BIN} "${TASK_TMP}/base-relief.png" "${TASK_TMP}/corridor-light.png" \
  -compose Screen -composite "${TASK_TMP}/base-lit.png"

# Two rail routes. The shared northern corridor narrows where lakes approach the
# railway, so the services merge visually there instead of being pushed onto
# water. Every build verifies both the centreline and the rendered 5 px stroke.
SPB_RAIL='459,587 515,610 574,526 575,333 587,251 581,239 578,200 564,175 593,76 624,45'
MOSCOW_RAIL='665,875 656,378 598,274 581,239 578,200 563,173 598,71 624,45'

${MAGICK_BIN} "${LAND_MASK}" -alpha off -colorspace gray -threshold 50% \
  -negate -alpha off "${TASK_TMP}/water-mask.png"
assert_route_on_land "SPB_RAIL-axis" "${SPB_RAIL}" 1
assert_route_on_land "SPB_RAIL-visible" "${SPB_RAIL}" 5
assert_route_on_land "MOSCOW_RAIL-axis" "${MOSCOW_RAIL}" 1
assert_route_on_land "MOSCOW_RAIL-visible" "${MOSCOW_RAIL}" 5

${MAGICK_BIN} -size "${CANVAS_WIDTH}x${CANVAS_HEIGHT}" xc:none \
  -fill none -stroke 'rgba(1,8,24,0.86)' -strokewidth 13 -draw "stroke-linejoin round polyline ${SPB_RAIL}" \
  -stroke 'rgba(1,8,24,0.86)' -strokewidth 13 -draw "stroke-linejoin round polyline ${MOSCOW_RAIL}" \
  -stroke 'rgba(91,218,245,0.38)' -strokewidth 10 -draw "stroke-linejoin round polyline ${SPB_RAIL}" \
  -stroke 'rgba(244,94,139,0.34)' -strokewidth 10 -draw "stroke-linejoin round polyline ${MOSCOW_RAIL}" \
  -blur 0x5 "${TASK_TMP}/rail-glow.png"

${MAGICK_BIN} -size "${CANVAS_WIDTH}x${CANVAS_HEIGHT}" xc:none \
  -fill none -stroke '#65d7ee' -strokewidth 5 -draw "stroke-linejoin round polyline ${SPB_RAIL}" \
  -stroke '#e95b88' -strokewidth 5 -draw "stroke-linejoin round polyline ${MOSCOW_RAIL}" \
  -stroke 'rgba(255,255,255,0.90)' -strokewidth 1.5 -draw "stroke-linejoin round polyline ${SPB_RAIL}" \
  -stroke 'rgba(255,255,255,0.90)' -strokewidth 1.5 -draw "stroke-linejoin round polyline ${MOSCOW_RAIL}" \
  "${TASK_TMP}/rails.png"

# Two independent flight arcs, one from each departure city.
${MAGICK_BIN} -size "${CANVAS_WIDTH}x${CANVAS_HEIGHT}" xc:none \
  -fill none -stroke 'rgba(73,226,255,0.40)' -strokewidth 14 \
  -draw "path 'M 459,587 C 382,402 432,176 624,45'" \
  -stroke 'rgba(242,56,119,0.38)' -strokewidth 14 \
  -draw "path 'M 665,875 C 915,680 862,254 624,45'" \
  -blur 0x8 "${TASK_TMP}/flight-glow.png"
${MAGICK_BIN} -size "${CANVAS_WIDTH}x${CANVAS_HEIGHT}" xc:none \
  -fill none -stroke '#70e9ff' -strokewidth 3 \
  -draw "path 'M 459,587 C 382,402 432,176 624,45'" \
  -stroke '#ff4f91' -strokewidth 3 \
  -draw "path 'M 665,875 C 915,680 862,254 624,45'" \
  "${TASK_TMP}/flights.png"

# Branded city nodes, with a compact glow that reads against both land and sea.
${MAGICK_BIN} -size "${CANVAS_WIDTH}x${CANVAS_HEIGHT}" xc:none \
  -fill 'rgba(100,231,255,0.75)' -stroke none -draw 'circle 459,587 481,587' \
  -fill 'rgba(255,73,139,0.75)' -draw 'circle 665,875 687,875' \
  -fill 'rgba(255,255,255,0.72)' -draw 'circle 624,45 648,45' \
  -blur 0x12 "${TASK_TMP}/node-glow.png"
${MAGICK_BIN} -size "${CANVAS_WIDTH}x${CANVAS_HEIGHT}" xc:none \
  -fill '#ffffff' -stroke '#6de8ff' -strokewidth 4 -draw 'circle 459,587 468,587' \
  -fill '#ffffff' -stroke '#ff5b96' -strokewidth 4 -draw 'circle 665,875 674,875' \
  -fill '#ffffff' -stroke '#a6ecff' -strokewidth 4 -draw 'circle 624,45 634,45' \
  "${TASK_TMP}/nodes.png"

# Prepare exactly two ImageGen planes and two ImageGen trains. The source
# cutouts are diagonal; these rotations point their noses along route tangents.
${MAGICK_BIN} "${PLANE_ISOLATED}" -resize 104x104 -background none -rotate 143 "${TASK_TMP}/plane-spb.png"
${MAGICK_BIN} "${PLANE_ISOLATED}" -resize 104x104 -background none -rotate 136 "${TASK_TMP}/plane-moscow.png"
${MAGICK_BIN} "${TRAIN_ISOLATED}" -resize 116x116 -background none -rotate 163 "${TASK_TMP}/train-spb.png"
${MAGICK_BIN} "${TRAIN_ISOLATED}" -resize 116x116 -background none -rotate 127 "${TASK_TMP}/train-moscow.png"

${MAGICK_BIN} "${TASK_TMP}/base-lit.png" \
  "${TASK_TMP}/rail-glow.png" -compose Screen -composite \
  "${TASK_TMP}/flight-glow.png" -compose Screen -composite \
  "${TASK_TMP}/rails.png" -compose Over -composite \
  "${TASK_TMP}/flights.png" -compose Over -composite \
  "${TASK_TMP}/node-glow.png" -compose Screen -composite \
  "${TASK_TMP}/nodes.png" -compose Over -composite \
  "${TASK_TMP}/plane-spb.png" -geometry +359+286 -compose Over -composite \
  "${TASK_TMP}/plane-moscow.png" -geometry +759+443 -compose Over -composite \
  "${TASK_TMP}/train-spb.png" -geometry +474+503 -compose Over -composite \
  "${TASK_TMP}/train-moscow.png" -geometry +585+523 -compose Over -composite \
  "${TASK_TMP}/label-spb.png" -geometry +112+604 -compose Over -composite \
  "${TASK_TMP}/label-moscow.png" -geometry +682+836 -compose Over -composite \
  "${TASK_TMP}/label-murmansk.png" -geometry +649+18 -compose Over -composite \
  "${TASK_TMP}/label-train.png" -geometry +742+646 -compose Over -composite \
  -colorspace sRGB -strip "${OUTPUT_PNG}"

${MAGICK_BIN} "${OUTPUT_PNG}" -quality 90 -define webp:method=6 "${OUTPUT_WEBP}"

# Mobile composition is a deterministic crop of the approved desktop map.
# It does not resize, redraw or reinterpret any geographic feature.
${MAGICK_BIN} "${OUTPUT_PNG}" \
  -crop "${MOBILE_CROP_WIDTH}x${MOBILE_CROP_HEIGHT}+${MOBILE_CROP_X}+${MOBILE_CROP_Y}" \
  +repage -strip "${OUTPUT_MOBILE_PNG}"
require_dimensions "${OUTPUT_MOBILE_PNG}" "${MOBILE_CROP_WIDTH}" "${MOBILE_CROP_HEIGHT}"
${MAGICK_BIN} "${OUTPUT_MOBILE_PNG}" -quality 90 -define webp:method=6 "${OUTPUT_MOBILE_WEBP}"

echo "Built exact transport map: ${OUTPUT_PNG}"
echo "Built web asset: ${OUTPUT_WEBP}"
echo "Built mobile crop: ${OUTPUT_MOBILE_PNG}"
echo "Built mobile web asset: ${OUTPUT_MOBILE_WEBP}"
