// Equirectangular projection of India onto the XZ plane.
// 1 world unit = KM_PER_UNIT kilometres. +x = east, -z = north.

export const KM_PER_UNIT = 4;
const LAT0 = 22;
const LON0 = 82;
const KY = 111 / KM_PER_UNIT;
const KX = KY * Math.cos((LAT0 * Math.PI) / 180);

export function project(lat: number, lon: number): { x: number; z: number } {
  return { x: (lon - LON0) * KX, z: -(lat - LAT0) * KY };
}

type LatLon = [number, number];

// Simplified coastline of the subcontinent, west (Makran) to east (Myanmar).
const COAST: LatLon[] = [
  [25.2, 62.0], [25.3, 64.5], [25.2, 66.5], [24.8, 67.0], [24.2, 67.4], [23.7, 68.2],
  [23.2, 68.5], [22.8, 69.2], [22.95, 70.2], [22.5, 70.05], [22.24, 68.97], [21.6, 69.6],
  [20.9, 70.4], [20.75, 71.0], [21.2, 72.1], [22.3, 72.6], [21.7, 72.65], [21.1, 72.6],
  [20.4, 72.65], [19.0, 72.55], [18.2, 72.85], [17.0, 73.2], [15.3, 73.72], [14.8, 74.05], [12.9, 74.66],
  [11.25, 75.7], [9.97, 76.08], [8.5, 76.78], [8.08, 77.55], [8.8, 78.15], [9.28, 79.3],
  [10.3, 79.85], [11.0, 79.85], [11.9, 79.9], [13.08, 80.45], [14.4, 80.25], [15.6, 80.2],
  [16.17, 81.13], [16.3, 82.3], [16.93, 82.3], [17.65, 83.45], [18.3, 84.0], [19.3, 84.9],
  [19.72, 85.98], [20.3, 86.7], [21.5, 87.0], [21.6, 87.5], [21.7, 88.2], [21.9, 89.5],
  [22.0, 90.5], [22.8, 91.4], [22.3, 91.8], [21.2, 92.2], [20.15, 92.9], [18.5, 94.2],
  [17.5, 94.5], [16.0, 94.3], [15.8, 95.2], [16.4, 96.5], [16.5, 97.4], [15.5, 97.7],
  [15.5, 100.0],
];

export const SRI_LANKA: LatLon[] = [
  [9.8, 80.05], [9.5, 80.6], [8.5, 81.2], [7.3, 81.9], [6.2, 81.6], [5.95, 80.6],
  [6.2, 80.05], [7.2, 79.83], [8.2, 79.75], [9.0, 79.9],
];

// Land plate: the coastline closed off by the northern map edge.
export const MAINLAND: LatLon[] = [[37.5, 62.0], ...COAST, [37.5, 100.0]];

export function toXZ(poly: LatLon[]): { x: number; z: number }[] {
  return poly.map(([lat, lon]) => project(lat, lon));
}

const LAND_XZ = [toXZ(MAINLAND), toXZ(SRI_LANKA)];

function inPoly(x: number, z: number, poly: { x: number; z: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** True when a world point lies on the land plate. */
export function onLand(x: number, z: number): boolean {
  return LAND_XZ.some((p) => inPoly(x, z, p));
}

export const MAP_BOUNDS = (() => {
  const a = project(37.5, 62);
  const b = project(5, 100);
  return { minX: a.x, maxX: b.x, minZ: a.z, maxZ: b.z };
})();
