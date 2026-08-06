import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const administrativePath = resolve(
  projectRoot,
  "assets/data/murmansk-oblast.geojson",
);
const landPath = resolve(projectRoot, "assets/data/murmansk-land.geojson");
const waterPath = resolve(projectRoot, "assets/data/murmansk-waterbodies.geojson");
const outputPath = resolve(projectRoot, "assets/maps/murmansk-oblast.svg");
const referencePath = resolve(projectRoot, "assets/maps/murmansk-oblast-reference.svg");
const projectionPath = resolve(projectRoot, "assets/data/murmansk-map-projection.json");

// 4:3 is intentional: the map remains large when the public page places its
// editorial text in a separate right-hand column.
const WIDTH = 1200;
const HEIGHT = 900;
const PADDING = 72;
const LAND_SIMPLIFY_TOLERANCE = 0.22;
const WATER_SIMPLIFY_TOLERANCE = 0.18;

const [administrativeGeojson, landGeojson, waterGeojson] = await Promise.all([
  readFile(administrativePath, "utf8").then(JSON.parse),
  readFile(landPath, "utf8").then(JSON.parse),
  readFile(waterPath, "utf8").then(JSON.parse),
]);

const administrativeFeature = administrativeGeojson.features?.[0];
const landFeature = landGeojson.features?.[0];
const geometry = landFeature?.geometry;

if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) {
  throw new Error("Expected a Polygon or MultiPolygon in Murmansk land GeoJSON.");
}

const landPolygons =
  geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
const allPoints = landPolygons.flat(2);
const administrativePolygons = geometryToPolygons(
  administrativeFeature?.geometry,
);
const administrativePoints = administrativePolygons.flat(2);
const administrativeBbox = {
  west: administrativePoints.reduce(
    (minimum, [lon]) => Math.min(minimum, lon),
    Infinity,
  ),
  south: administrativePoints.reduce(
    (minimum, [, lat]) => Math.min(minimum, lat),
    Infinity,
  ),
  east: administrativePoints.reduce(
    (maximum, [lon]) => Math.max(maximum, lon),
    -Infinity,
  ),
  north: administrativePoints.reduce(
    (maximum, [, lat]) => Math.max(maximum, lat),
    -Infinity,
  ),
};

const lonValues = allPoints.map(([lon]) => lon);
const mercatorXValues = lonValues.map(mercatorX);
const mercatorYValues = allPoints.map(([, lat]) => mercatorY(lat));
const minLon = lonValues.reduce(
  (minimum, lon) => Math.min(minimum, lon),
  Infinity,
);
const maxLon = lonValues.reduce(
  (maximum, lon) => Math.max(maximum, lon),
  -Infinity,
);
const minLat = allPoints.reduce(
  (minimum, [, lat]) => Math.min(minimum, lat),
  Infinity,
);
const maxLat = allPoints.reduce(
  (maximum, [, lat]) => Math.max(maximum, lat),
  -Infinity,
);
const minMercatorX = mercatorXValues.reduce(
  (minimum, value) => Math.min(minimum, value),
  Infinity,
);
const maxMercatorX = mercatorXValues.reduce(
  (maximum, value) => Math.max(maximum, value),
  -Infinity,
);
const minMercatorY = mercatorYValues.reduce(
  (minimum, value) => Math.min(minimum, value),
  Infinity,
);
const maxMercatorY = mercatorYValues.reduce(
  (maximum, value) => Math.max(maximum, value),
  -Infinity,
);

const scale = Math.min(
  (WIDTH - PADDING * 2) / (maxMercatorX - minMercatorX),
  (HEIGHT - PADDING * 2) / (maxMercatorY - minMercatorY),
);

const contentWidth = (maxMercatorX - minMercatorX) * scale;
const contentHeight = (maxMercatorY - minMercatorY) * scale;
const offsetX = (WIDTH - contentWidth) / 2;
const offsetY = (HEIGHT - contentHeight) / 2;

function mercatorX(lon) {
  return (lon * Math.PI) / 180;
}

function mercatorY(lat) {
  const radians = (lat * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

function project([lon, lat]) {
  return [
    offsetX + (mercatorX(lon) - minMercatorX) * scale,
    offsetY + (maxMercatorY - mercatorY(lat)) * scale,
  ];
}

function perpendicularDistance(point, start, end) {
  const deltaX = end[0] - start[0];
  const deltaY = end[1] - start[1];

  if (deltaX === 0 && deltaY === 0) {
    return Math.hypot(point[0] - start[0], point[1] - start[1]);
  }

  const progress = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - start[0]) * deltaX + (point[1] - start[1]) * deltaY) /
        (deltaX ** 2 + deltaY ** 2),
    ),
  );
  const nearestX = start[0] + progress * deltaX;
  const nearestY = start[1] + progress * deltaY;
  return Math.hypot(point[0] - nearestX, point[1] - nearestY);
}

function simplifyLine(points, tolerance) {
  if (points.length <= 4) {
    return points;
  }

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [startIndex, endIndex] = stack.pop();
    let furthestIndex = -1;
    let furthestDistance = tolerance;

    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distance = perpendicularDistance(
        points[index],
        points[startIndex],
        points[endIndex],
      );

      if (distance > furthestDistance) {
        furthestDistance = distance;
        furthestIndex = index;
      }
    }

    if (furthestIndex !== -1) {
      keep[furthestIndex] = 1;
      stack.push([startIndex, furthestIndex], [furthestIndex, endIndex]);
    }
  }

  return points.filter((_, index) => keep[index]);
}

function ringToPath(ring, tolerance) {
  const projected = simplifyLine(ring.map(project), tolerance);
  const [first, ...rest] = projected;

  if (!first) {
    return "";
  }

  const commands = [`M${first[0].toFixed(2)},${first[1].toFixed(2)}`];

  rest.forEach(([x, y]) => {
    commands.push(`L${x.toFixed(2)},${y.toFixed(2)}`);
  });

  commands.push("Z");
  return commands.join("");
}

function geometryToPolygons(sourceGeometry) {
  if (!sourceGeometry) {
    return [];
  }

  if (sourceGeometry.type === "Polygon") {
    return [sourceGeometry.coordinates];
  }

  if (sourceGeometry.type === "MultiPolygon") {
    return sourceGeometry.coordinates;
  }

  return [];
}

function polygonsToPath(polygons, tolerance) {
  return polygons
    .map((polygon) => polygon.map((ring) => ringToPath(ring, tolerance)).join(""))
    .join("");
}

function lineToPath(coordinates, tolerance = 0.12) {
  const projected = simplifyLine(coordinates.map(project), tolerance);
  const [first, ...rest] = projected;

  if (!first) {
    return "";
  }

  return [
    `M${first[0].toFixed(2)},${first[1].toFixed(2)}`,
    ...rest.map(([x, y]) => `L${x.toFixed(2)},${y.toFixed(2)}`),
  ].join("");
}

function countCoordinates(value) {
  if (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  ) {
    return 1;
  }

  if (!Array.isArray(value)) {
    return 0;
  }

  return value.reduce((total, item) => total + countCoordinates(item), 0);
}

function label(name, coordinates, className = "map-label") {
  const [x, y] = project(coordinates);
  return `<text class="${className}" x="${x.toFixed(2)}" y="${y.toFixed(2)}">${name}</text>`;
}

const landPathData = polygonsToPath(landPolygons, LAND_SIMPLIFY_TOLERANCE);
const waterFeatures = waterGeojson.features ?? [];
const waterPathData = waterFeatures
  .map((feature) =>
    polygonsToPath(
      geometryToPolygons(feature.geometry),
      WATER_SIMPLIFY_TOLERANCE,
    ),
  )
  .join("");

const norwayBorder = landGeojson.features.find(
  (feature) => feature.properties?.country === "NO",
);
const finlandBorder = landGeojson.features.find(
  (feature) => feature.properties?.country === "FI",
);
const kareliaBorder = landGeojson.features.find(
  (feature) => feature.properties?.region === "RU-KR",
);

if (!norwayBorder || !finlandBorder || !kareliaBorder) {
  throw new Error("Expected exact Norway, Finland and Karelia border features.");
}

const finlandBorderData = lineToPath(finlandBorder.geometry.coordinates);
const norwayBorderData = lineToPath(norwayBorder.geometry.coordinates);
const kareliaBorderData = lineToPath(kareliaBorder.geometry.coordinates);

const landBounds = {
  x: offsetX,
  y: offsetY,
  width: contentWidth,
  height: contentHeight,
};

const sharedDefs = `
  <defs>
    <linearGradient id="land-gradient" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#edf8ff"/>
      <stop offset="0.58" stop-color="#cfe5f1"/>
      <stop offset="1" stop-color="#a8c8d9"/>
    </linearGradient>
    <linearGradient id="water-gradient" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#78c4dc"/>
      <stop offset="1" stop-color="#3f8fb1"/>
    </linearGradient>
    <clipPath id="oblast-clip">
      <path d="${landPathData}" fill-rule="evenodd"/>
    </clipPath>
  </defs>`;

const baseSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="map-title map-description">
  <title id="map-title">Мурманская область</title>
  <desc id="map-description">Полный географически точный контур суши Мурманской области с островами, крупнейшими озёрами и границами с Финляндией и Норвегией. Данные OpenStreetMap.</desc>
  ${sharedDefs}
  <path d="${landPathData}" fill="url(#land-gradient)" fill-rule="evenodd" stroke="#61bad3" stroke-width="2.4" stroke-linejoin="round"/>
  <path d="${waterPathData}" clip-path="url(#oblast-clip)" fill="url(#water-gradient)" fill-rule="evenodd" stroke="#c2edf7" stroke-width="0.45"/>
  <path d="${kareliaBorderData}" fill="none" stroke="#7899b4" stroke-width="2.2" stroke-dasharray="7 6" stroke-linecap="round"/>
  <path d="${finlandBorderData}" fill="none" stroke="#f3b54a" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${norwayBorderData}" fill="none" stroke="#ef7184" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;

const longitudeGrid = [30, 34, 38, 42]
  .map((lon) => {
    const [x] = project([lon, minLat]);
    return `<line x1="${x.toFixed(2)}" y1="38" x2="${x.toFixed(2)}" y2="${HEIGHT - 38}"/>`;
  })
  .join("");
const latitudeGrid = [66, 67, 68, 69, 70]
  .map((lat) => {
    const [, y] = project([minLon, lat]);
    return `<line x1="38" y1="${y.toFixed(2)}" x2="${WIDTH - 38}" y2="${y.toFixed(2)}"/>`;
  })
  .join("");

const referenceSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="reference-title reference-description">
  <title id="reference-title">Картографический эталон Мурманской области</title>
  <desc id="reference-description">Эталон для художественной перерисовки: точная суша полной Мурманской области, острова, реальные озёра, Баренцево и Белое моря, международные границы.</desc>
  ${sharedDefs}
  <rect width="${WIDTH}" height="${HEIGHT}" rx="36" fill="#061b3c"/>
  <g stroke="#22446a" stroke-width="1" opacity="0.42">${longitudeGrid}${latitudeGrid}</g>
  <path d="${landPathData}" fill="#03132f" opacity="0.7" transform="translate(9 14)"/>
  <path d="${landPathData}" fill="url(#land-gradient)" fill-rule="evenodd" stroke="#65d0e6" stroke-width="3.2" stroke-linejoin="round"/>
  <g clip-path="url(#oblast-clip)" opacity="0.24" fill="none" stroke="#769bb1" stroke-width="1">
    <path d="M130 560C330 470 500 510 680 410S960 300 1110 210"/>
    <path d="M100 650C290 560 470 600 650 500S930 390 1130 270"/>
    <path d="M120 735C320 650 510 680 720 575S980 480 1130 370"/>
  </g>
  <path d="${waterPathData}" clip-path="url(#oblast-clip)" fill="url(#water-gradient)" fill-rule="evenodd" stroke="#d2f6ff" stroke-width="0.55"/>
  <path d="${kareliaBorderData}" fill="none" stroke="#7899b4" stroke-width="2.8" stroke-dasharray="8 7" stroke-linecap="round"/>
  <path d="${finlandBorderData}" fill="none" stroke="#ffc85f" stroke-width="5.8" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${norwayBorderData}" fill="none" stroke="#ff738d" stroke-width="5.8" stroke-linecap="round" stroke-linejoin="round"/>

  <g font-family="Arial, Helvetica, sans-serif" text-anchor="middle">
    ${label("БАРЕНЦЕВО МОРЕ", [37.6, 69.86], "sea-label")}
    ${label("БЕЛОЕ МОРЕ", [39.9, 66.08], "sea-label")}
    ${label("НОРВЕГИЯ", [28.15, 69.44], "country-label")}
    ${label("ФИНЛЯНДИЯ", [28.0, 67.74], "country-label")}
    ${label("РЕСПУБЛИКА КАРЕЛИЯ", [33.5, 65.82], "neighbour-label")}
    ${label("Имандра", [32.62, 67.73])}
    ${label("Верхнетуломское", [30.92, 68.39])}
    ${label("Умбозеро", [34.39, 67.73])}
    ${label("Ловозеро", [35.14, 67.88])}
  </g>

  <g transform="translate(48 48)" font-family="Arial, Helvetica, sans-serif">
    <rect width="312" height="96" rx="20" fill="#071e42" stroke="#31577f"/>
    <text x="22" y="30" fill="#d9eeff" font-size="15" font-weight="700" letter-spacing="1.6">МУРМАНСКАЯ ОБЛАСТЬ · RU-MUR</text>
    <line x1="22" y1="54" x2="58" y2="54" stroke="#ffc85f" stroke-width="5"/>
    <text x="70" y="59" fill="#a9c2dd" font-size="14">граница с Финляндией</text>
    <line x1="22" y1="78" x2="58" y2="78" stroke="#ff738d" stroke-width="5"/>
    <text x="70" y="83" fill="#a9c2dd" font-size="14">граница с Норвегией</text>
  </g>

  <style>
    .sea-label {
      fill: #6b92bd;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: 6px;
    }
    .country-label {
      fill: #d5e5f5;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 3px;
    }
    .neighbour-label {
      fill: #7596b7;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 2px;
    }
    .map-label {
      paint-order: stroke;
      stroke: #dff3fb;
      stroke-width: 4px;
      fill: #123e5b;
      font-size: 14px;
      font-weight: 700;
    }
  </style>
  <text x="${WIDTH - 42}" y="${HEIGHT - 28}" fill="#6f8cab" font-family="Arial, Helvetica, sans-serif" font-size="12" text-anchor="end">Контуры и гидрография: © OpenStreetMap contributors</text>
</svg>
`;

const projectionMeta = {
  version: 3,
  // Flat aliases are kept for the existing map-geometry.js runtime contract.
  width: WIDTH,
  height: HEIGHT,
  minLon,
  maxLon,
  minLat,
  maxLat,
  minMercatorX,
  maxMercatorX,
  minMercatorY,
  maxMercatorY,
  scale,
  offsetX,
  offsetY,
  region: {
    name: "Мурманская область",
    iso3166_2: "RU-MUR",
    osmType: "relation",
    osmId: 2099216,
    osmVersion: 71,
    osmTimestamp: "2026-06-10T18:02:42Z",
    bbox: {
      west: minLon,
      south: minLat,
      east: maxLon,
      north: maxLat,
    },
    bboxMeaning: "complete land and islands; territorial waters excluded",
    administrativeBboxIncludingTerritorialWaters: administrativeBbox,
    islandCount: landFeature.properties?.island_count ?? 0,
  },
  canvas: {
    width: WIDTH,
    height: HEIGHT,
    aspectRatio: "4:3",
    fit: "contain",
    padding: PADDING,
    contentBounds: landBounds,
  },
  cartography: {
    landSource: "assets/data/murmansk-land.geojson",
    landSourceCoordinateCount: countCoordinates(geometry.coordinates),
    landSvgSimplificationTolerancePx: LAND_SIMPLIFY_TOLERANCE,
    coastlineMeaning:
      "natural coastline; territorial-water perimeter is intentionally not used as the visible land silhouette",
  },
  projection: {
    name: "Web Mercator",
    epsg: "EPSG:3857",
    coordinateOrder: ["longitude", "latitude"],
    minMercatorX,
    maxMercatorX,
    minMercatorY,
    maxMercatorY,
    scale,
    offsetX,
    offsetY,
    forward:
      "x=offsetX+(lon*pi/180-minMercatorX)*scale; y=offsetY+(maxMercatorY-ln(tan(pi/4+lat*pi/360)))*scale",
    inverse:
      "lon=((x-offsetX)/scale+minMercatorX)*180/pi; lat=(2*atan(exp(maxMercatorY-(y-offsetY)/scale))-pi/2)*180/pi",
  },
  placementContract: {
    apiCoordinates: "WGS84 longitude/latitude",
    renderSpace: `SVG viewBox 0 0 ${WIDTH} ${HEIGHT}`,
    imageRule:
      "Preserve the complete SVG viewBox without cropping, stretching or perspective transforms.",
    markerAnchor: "center",
    adminNudge:
      "Apply optional nudgeX/nudgeY only after geographic projection, in viewBox units.",
    landSnapSource: "assets/data/murmansk-land.geojson",
    administrativeBoundarySource: "assets/data/murmansk-oblast.geojson",
    visualReference: "assets/maps/murmansk-oblast-reference.svg",
  },
  hydrography: {
    featureCount: waterFeatures.length,
    coordinateCount: waterFeatures.reduce(
      (total, feature) => total + countCoordinates(feature.geometry.coordinates),
      0,
    ),
    source: "assets/data/murmansk-waterbodies.geojson",
    sourceGeometryMaximumApproximationMetres: 50,
    svgSimplificationTolerancePx: WATER_SIMPLIFY_TOLERANCE,
    priorityNames: [
      "Имандра",
      "Верхнетуломское водохранилище",
      "Ковдозеро",
      "Умбозеро",
      "Ловозеро",
    ],
  },
  internationalBorders: {
    norway: {
      from: "Муоткаваара / Крокфьеллет (трёхсторонняя пограничная точка)",
      to: "устье Ворьема / российско-норвежская морская граница",
      styleId: "norway-border",
    },
    finland: {
      from: "стык границ Мурманской области, Карелии и Финляндии",
      to: "Муоткаваара / Крокфьеллет",
      styleId: "finland-border",
    },
  },
  attribution: "© OpenStreetMap contributors",
  sources: [
    "https://www.openstreetmap.org/relation/2099216",
    "https://www.openstreetmap.org/tag/natural=coastline",
    "https://nominatim.openstreetmap.org/",
  ],
};

await Promise.all([
  writeFile(outputPath, baseSvg, "utf8"),
  writeFile(referencePath, referenceSvg, "utf8"),
  writeFile(projectionPath, `${JSON.stringify(projectionMeta, null, 2)}\n`, "utf8"),
]);

console.log(`Generated ${outputPath}`);
console.log(`Generated ${referencePath}`);
console.log(`Generated ${projectionPath}`);
