import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const inputPath = resolve(projectRoot, "assets/data/kola-peninsula.geojson");
const outputPath = resolve(projectRoot, "assets/maps/kola-peninsula-base.svg");
const outlinePath = resolve(projectRoot, "assets/maps/kola-peninsula-outline.svg");
const projectionPath = resolve(projectRoot, "assets/data/kola-map-projection.json");

const WIDTH = 1600;
const HEIGHT = 1200;
const PADDING = 72;
const SIMPLIFY_TOLERANCE = 0.34;

const geojson = JSON.parse(await readFile(inputPath, "utf8"));
const geometry = geojson.type === "Feature" ? geojson.geometry : geojson;

if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) {
  throw new Error("Expected a Polygon or MultiPolygon for the Kola Peninsula.");
}

const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
const allPoints = polygons.flat(2);
const mercatorXValues = allPoints.map(([longitude]) => longitude * Math.PI / 180);
const mercatorYValues = allPoints.map(([, latitude]) => mercatorY(latitude));
const minMercatorX = Math.min(...mercatorXValues);
const maxMercatorX = Math.max(...mercatorXValues);
const minMercatorY = Math.min(...mercatorYValues);
const maxMercatorY = Math.max(...mercatorYValues);
const scale = Math.min(
  (WIDTH - PADDING * 2) / (maxMercatorX - minMercatorX),
  (HEIGHT - PADDING * 2) / (maxMercatorY - minMercatorY),
);
const contentWidth = (maxMercatorX - minMercatorX) * scale;
const contentHeight = (maxMercatorY - minMercatorY) * scale;
const offsetX = (WIDTH - contentWidth) / 2;
const offsetY = (HEIGHT - contentHeight) / 2;

function mercatorY(latitude) {
  const radians = latitude * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

function project([longitude, latitude]) {
  const mercatorX = longitude * Math.PI / 180;
  return [
    offsetX + (mercatorX - minMercatorX) * scale,
    offsetY + (maxMercatorY - mercatorY(latitude)) * scale,
  ];
}

function simplifyProjectedRing(points) {
  if (points.length < 4) {
    return points;
  }

  const simplified = [points[0]];
  let previous = points[0];

  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    if (Math.hypot(point[0] - previous[0], point[1] - previous[1]) >= SIMPLIFY_TOLERANCE) {
      simplified.push(point);
      previous = point;
    }
  }

  simplified.push(points.at(-1));
  return simplified;
}

function ringToPath(ring) {
  const projected = simplifyProjectedRing(ring.map(project));
  const [first, ...rest] = projected;
  return [
    `M${first[0].toFixed(2)},${first[1].toFixed(2)}`,
    ...rest.map(([x, y]) => `L${x.toFixed(2)},${y.toFixed(2)}`),
    "Z",
  ].join("");
}

const pathData = polygons
  .map((polygon) => polygon.map(ringToPath).join(""))
  .join("");

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="map-title map-description">
  <title id="map-title">Кольский полуостров</title>
  <desc id="map-description">Географически точный контур Кольского полуострова по данным OpenStreetMap.</desc>
  <defs>
    <linearGradient id="sea" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#071638"/>
      <stop offset="1" stop-color="#102f68"/>
    </linearGradient>
    <linearGradient id="land" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f9fcff"/>
      <stop offset="1" stop-color="#dcecff"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" rx="56" fill="url(#sea)"/>
  <path d="${pathData}" fill="url(#land)" fill-rule="evenodd" stroke="#73e2eb" stroke-width="4" stroke-linejoin="round"/>
</svg>
`;

const outlineSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" aria-hidden="true">
  <path d="${pathData}" fill="none" fill-rule="evenodd" stroke="#94eff6" stroke-opacity=".78" stroke-width="2.4" stroke-linejoin="round"/>
</svg>
`;

const projection = {
  width: WIDTH,
  height: HEIGHT,
  minMercatorX,
  maxMercatorX,
  minMercatorY,
  maxMercatorY,
  scale,
  offsetX,
  offsetY,
  source: "https://www.openstreetmap.org/relation/5868101",
  attribution: "© OpenStreetMap contributors",
  placementContract: {
    input: "WGS84 longitude/latitude",
    projection: "Web Mercator",
    snapTarget: "Kola Peninsula land mask",
  },
};

await Promise.all([
  writeFile(outputPath, svg, "utf8"),
  writeFile(outlinePath, outlineSvg, "utf8"),
  writeFile(projectionPath, `${JSON.stringify(projection, null, 2)}\n`, "utf8"),
]);

console.log(`Generated ${outputPath}`);
