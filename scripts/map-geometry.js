const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function mercatorY(latitude) {
  const boundedLatitude = Math.min(85.05112878, Math.max(-85.05112878, latitude));
  const radians = boundedLatitude * DEG_TO_RAD;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

export function projectLonLat(longitude, latitude, projection) {
  const x = projection.offsetX
    + (longitude * DEG_TO_RAD - projection.minMercatorX) * projection.scale;
  const y = projection.offsetY
    + (projection.maxMercatorY - mercatorY(latitude)) * projection.scale;

  return {
    x,
    y,
    left: `${(x / projection.width) * 100}%`,
    top: `${(y / projection.height) * 100}%`,
  };
}

export function unprojectMapPoint(x, y, projection) {
  const mercatorX = projection.minMercatorX + (x - projection.offsetX) / projection.scale;
  const mercatorLatitude = projection.maxMercatorY - (y - projection.offsetY) / projection.scale;

  return {
    longitude: mercatorX * RAD_TO_DEG,
    latitude: (2 * Math.atan(Math.exp(mercatorLatitude)) - Math.PI / 2) * RAD_TO_DEG,
  };
}

export function isPublishedMapPoint(value) {
  return Boolean(
    value
    && typeof value.id === "string"
    && typeof value.name === "string"
    && Number.isFinite(Number(value.longitude))
    && Number.isFinite(Number(value.latitude))
    && value.status !== "draft",
  );
}
