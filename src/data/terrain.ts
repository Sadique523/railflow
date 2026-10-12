// Terrain that makes railways hard to build. Outlines are rough lat/lon traces of the
// Western Ghats escarpment (with the Palakkad gap left open), the Himalayan ranges and
// the north-eastern hills. Lines through them cost more, take longer and run slower;
// every major river crossing needs a bridge.

import { RIVERS, XZ, project, riverName } from './geo';

export type TerrainKind = 'ghats' | 'mountains' | 'hills';

export interface TerrainRegion {
  kind: TerrainKind;
  name: string;
  poly: XZ[];
}

export const TERRAIN_INFO: Record<TerrainKind, { name: string; cost: number; time: number; kmh: number }> = {
  ghats: { name: 'Ghat section', cost: 4, time: 3, kmh: 80 },
  mountains: { name: 'Mountain railway', cost: 5, time: 4, kmh: 60 },
  hills: { name: 'Hill section', cost: 3.5, time: 3, kmh: 75 },
};

const ll = (pts: [number, number][]) => pts.map(([lat, lon]) => project(lat, lon));

export const TERRAIN: TerrainRegion[] = [
  {
    kind: 'ghats', name: 'Western Ghats',
    poly: ll([
      [21.2, 73.25], [21.2, 73.9], [19.5, 73.75], [18.4, 73.9], [17.0, 74.0], [15.8, 74.45], [14.5, 74.95],
      [13.3, 75.5], [12.0, 75.95], [11.2, 76.6], [11.05, 76.75], [11.0, 76.3], [11.6, 75.75], [12.6, 75.35],
      [13.8, 74.95], [15.0, 74.3], [16.3, 73.75], [17.8, 73.55], [19.2, 73.35], [20.5, 73.3],
    ]),
  },
  {
    kind: 'ghats', name: 'Cardamom Hills',
    poly: ll([[10.3, 76.85], [10.3, 77.35], [9.3, 77.45], [8.35, 77.35], [8.35, 77.05], [9.3, 77.0]]),
  },
  {
    kind: 'mountains', name: 'Himalaya',
    poly: ll([
      [33.0, 73.4], [32.6, 74.6], [32.1, 75.6], [31.3, 76.4], [30.85, 77.0], [30.25, 77.6], [29.9, 78.3],
      [29.3, 79.3], [28.9, 80.2], [30.3, 81.2], [33.0, 79.6], [35.8, 80.0], [37.2, 75.0], [35.0, 73.4],
    ]),
  },
  {
    kind: 'mountains', name: 'Sikkim and Darjeeling hills',
    poly: ll([[26.9, 88.0], [28.15, 88.0], [28.15, 88.95], [26.95, 88.9]]),
  },
  {
    kind: 'hills', name: 'North-eastern hills',
    poly: ll([
      [26.0, 90.0], [25.95, 91.5], [26.0, 92.6], [26.8, 93.6], [27.3, 95.5], [27.0, 96.5], [25.0, 95.0],
      [22.0, 93.5], [23.0, 91.8], [24.0, 92.2], [25.1, 92.4], [25.1, 90.0],
    ]),
  },
  {
    kind: 'mountains', name: 'Arunachal Himalaya',
    poly: ll([[27.0, 91.6], [28.5, 91.6], [29.4, 96.0], [27.8, 96.8], [27.25, 94.6], [26.9, 92.5]]),
  },
];

function inPoly(p: XZ, poly: XZ[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function crosses(a: XZ, b: XZ, c: XZ, d: XZ): boolean {
  const o = (p: XZ, q: XZ, r: XZ) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** What building between two points runs into. */
export interface TerrainProfile {
  /** Share of the line in each kind of hard ground. */
  share: Partial<Record<TerrainKind, number>>;
  /** Major rivers bridged, by everyday name. */
  bridges: string[];
  costMult: number;
  timeMult: number;
  /** Speed limit the hardest ground imposes, if it covers enough of the line to matter. */
  kmhCap: number | null;
  /** Main obstacle, for the build tooltip. */
  label: string | null;
}

export function terrainProfile(a: XZ, b: XZ): TerrainProfile {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(4, Math.ceil(len / 3));
  const share: Partial<Record<TerrainKind, number>> = {};
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    const r = TERRAIN.find((reg) => inPoly(p, reg.poly));
    if (r) share[r.kind] = (share[r.kind] ?? 0) + 1 / n;
  }
  // one bridge per river: a meandering river can cut a straight line more than once
  const bridges = [...new Set(RIVERS.filter((river) =>
    river.line.some((p, i) => i > 0 && crosses(a, b, river.line[i - 1], p))).map((river) => riverName(river.name)))];
  let costMult = 1;
  let timeMult = 1;
  let kmhCap: number | null = null;
  let label: string | null = null;
  let worst = 0;
  for (const [kind, f] of Object.entries(share) as [TerrainKind, number][]) {
    const info = TERRAIN_INFO[kind];
    costMult += f * (info.cost - 1);
    timeMult += f * (info.time - 1);
    if (f >= 0.08) kmhCap = Math.min(kmhCap ?? Infinity, info.kmh);
    if (f > worst) { worst = f; label = info.name; }
  }
  return { share, bridges, costMult, timeMult, kmhCap, label };
}

/** Bridge cost (₹ Cr) and extra build hours for one crossing; the big rivers are the hard ones. */
export function bridgeCost(river: string): { cost: number; hours: number } {
  const big = ['Ganga', 'Brahmaputra', 'Indus', 'Godavari', 'Krishna'].includes(river);
  return big ? { cost: 14, hours: 16 } : { cost: 6, hours: 8 };
}
