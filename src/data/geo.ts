// Equirectangular projection of India onto the XZ plane.
// 1 world unit = KM_PER_UNIT kilometres. +x = east, -z = north.

import mapdata from './mapdata.json';

export const KM_PER_UNIT = 4;
const LAT0 = 22;
const LON0 = 82;
const KY = 111 / KM_PER_UNIT;
const KX = KY * Math.cos((LAT0 * Math.PI) / 180);

export function project(lat: number, lon: number): { x: number; z: number } {
  return { x: (lon - LON0) * KX, z: -(lat - LAT0) * KY };
}

export interface XZ { x: number; z: number }

export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }

function rect(s: number, n: number, w: number, e: number): Rect {
  const a = project(n, w);
  const b = project(s, e);
  return { minX: a.x, maxX: b.x, minZ: a.z, maxZ: b.z };
}

/** Extent of the geography; far enough out that the camera never sees its edge (matches scripts/build-mapdata.mjs). */
export const WORLD = rect(-20, 62, 25, 140);

/** The play area, mapped in full detail. */
export const CORE = rect(4.5, 38.5, 61.5, 99.5);

/** Where the camera target may roam. */
export const MAP_BOUNDS = rect(6.5, 36, 66, 97);

function ringXZ(flat: number[]): XZ[] {
  const pts: XZ[] = [];
  for (let i = 0; i < flat.length; i += 2) pts.push(project(flat[i], flat[i + 1]));
  return pts;
}

export interface Country {
  name: string;
  rings: XZ[][];
}

/** Every country in the world extent. India comes first. */
export const COUNTRIES: Country[] = (mapdata.countries as { name: string; rings: number[][] }[])
  .map((c) => ({ name: c.name, rings: c.rings.map(ringXZ) }))
  .sort((a, b) => Number(b.name === 'India') - Number(a.name === 'India'));

export const INDIA = COUNTRIES[0];

export interface River {
  name: string;
  rank: number; // Natural Earth scalerank: lower is bigger
  line: XZ[];
}

const RIVER_NAMES: Record<string, string> = {
  Ganges: 'Ganga', 'Godävari': 'Godavari', 'Mahäna Nadï': 'Mahanadi', Dihang: 'Brahmaputra', Yarlung: 'Brahmaputra',
  Ayeyarwady: 'Irrawaddy', 'Irrawaddy Delta': 'Irrawaddy',
};

/** Everyday name for a river in the Natural Earth data. */
export function riverName(n: string): string {
  return RIVER_NAMES[n] ?? n;
}

export const RIVERS: River[] = (mapdata.rivers as { name: string; rank: number; line: number[] }[])
  .map((r) => ({ name: r.name, rank: r.rank, line: ringXZ(r.line) }));

function inPoly(x: number, z: number, poly: XZ[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** True when a world point lies inside India (towns are only built there). */
export function onLand(x: number, z: number): boolean {
  return INDIA.rings.some((p) => inPoly(x, z, p));
}
