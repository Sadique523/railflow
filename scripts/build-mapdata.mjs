// Builds src/data/mapdata.json from Natural Earth GeoJSON (public domain, naturalearthdata.com).
//
//   node scripts/build-mapdata.mjs <ne_10m_admin_0_countries_ind.geojson> <ne_50m_rivers_lake_centerlines.geojson>
//
// Borders come from the India point-of-view countries file. Rings are simplified one border at a
// time: each run of vertices shared by the same set of countries is simplified on its own, with its
// ends pinned, so neighbours get identical shared borders and no slivers open up between them.

import { readFileSync, writeFileSync } from 'node:fs';

const [countriesPath, riversPath] = process.argv.slice(2);
if (!countriesPath || !riversPath) {
  console.error('usage: node scripts/build-mapdata.mjs <countries.geojson> <rivers.geojson>');
  process.exit(1);
}

// World extent: far enough out that the camera never sees past it (must match WORLD in src/data/geo.ts)
const B = { s: -20, n: 62, w: 25, e: 140 };
// The play area keeps full detail; the surroundings are only ever seen from afar
const CORE = { s: 4.5, n: 38.5, w: 61.5, e: 99.5 };
const TOL = 0.012; // simplification tolerance in degrees (~1.3 km)
const TOL_OUTER = 0.06;
const MIN_AREA = 0.004; // deg², drops specks of islands
const MIN_AREA_OUTER = 0.15;
const RIVERS = new Set(['Ganges', 'Yamuna', 'Brahmaputra', 'Dihang', 'Yarlung', 'Indus', 'Sutlej', 'Chenab',
  'Godävari', 'Krishna', 'Narmada', 'Mahäna Nadï', 'Ayeyarwady', 'Irrawaddy Delta']);

const r2 = (v) => Math.round(v * 100) / 100;
const inCore = (lon, lat) => lon > CORE.w && lon < CORE.e && lat > CORE.s && lat < CORE.n;
const q = (v) => Math.round(v * 1e5) / 1e5; // merges vertices that are equal in all but float noise
const key = (p) => `${p[0]},${p[1]}`;

function polygonsOf(geom) {
  if (!geom) return [];
  return geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
}

function area(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return Math.abs(a / 2);
}

/** Sutherland–Hodgman clip of a ring against the board rectangle. */
function clipRect(ring) {
  const edges = [
    [(p) => p[0] >= B.w, (a, b) => lerpX(a, b, B.w)],
    [(p) => p[0] <= B.e, (a, b) => lerpX(a, b, B.e)],
    [(p) => p[1] >= B.s, (a, b) => lerpY(a, b, B.s)],
    [(p) => p[1] <= B.n, (a, b) => lerpY(a, b, B.n)],
  ];
  let out = ring;
  for (const [inside, cut] of edges) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const cur = src[i];
      const prev = src[(i + src.length - 1) % src.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cut(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cut(prev, cur));
    }
    if (!out.length) break;
  }
  return out;
}
const lerpX = (a, b, x) => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])];
const lerpY = (a, b, y) => [a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]), y];

/** Ramer–Douglas–Peucker for open polylines (rivers only). */
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let best = -1;
  let bi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], a, b);
    if (d > best) { best = d; bi = i; }
  }
  if (best <= eps) return [a, b];
  return [...rdp(pts.slice(0, bi + 1), eps).slice(0, -1), ...rdp(pts.slice(bi), eps)];
}
function segDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
}

// [lat, lon] pairs flattened, as the rest of the code base uses lat/lon order
const flat = (ring) => ring.flatMap(([lon, lat]) => [r2(lat), r2(lon)]);

// 1. clip every outer ring to the world and drop repeated vertices
const raw = [];
for (const f of JSON.parse(readFileSync(countriesPath, 'utf8')).features) {
  const name = f.properties.ADMIN ?? f.properties.NAME;
  const rings = [];
  for (const poly of polygonsOf(f.geometry)) {
    const outer = poly[0];
    if (!outer.some(([lon, lat]) => lon > B.w && lon < B.e && lat > B.s && lat < B.n)) continue;
    const ring = [];
    for (const [lon, lat] of clipRect(outer)) {
      const p = [q(lon), q(lat)];
      const last = ring[ring.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) ring.push(p);
    }
    while (ring.length > 1 && key(ring[0]) === key(ring[ring.length - 1])) ring.pop();
    if (ring.length >= 3) rings.push(ring);
  }
  if (rings.length) raw.push({ name, rings });
}

// 2. which countries share each vertex
const owners = new Map();
raw.forEach((c, ci) => {
  for (const r of c.rings) for (const p of r) {
    const k = key(p);
    const set = owners.get(k) ?? new Set();
    set.add(ci);
    owners.set(k, set);
  }
});
const ownerKey = (p) => [...owners.get(key(p))].sort((a, b) => a - b).join('|');

/** Simplify a ring run by run, keeping every point where the set of owners changes. */
function simplifyRing(ring) {
  const ks = ring.map(ownerKey);
  const n = ring.length;
  let start = ks.findIndex((k, i) => k !== ks[(i + n - 1) % n]);
  if (start < 0) {
    // one owner set all the way round (an island, or a fully shared ring): split at the far point
    const far = ring.reduce((bi, p, i) => (Math.hypot(p[0] - ring[0][0], p[1] - ring[0][1]) > Math.hypot(ring[bi][0] - ring[0][0], ring[bi][1] - ring[0][1]) ? i : bi), 0);
    const tol = ring.some(([lon, lat]) => inCore(lon, lat)) ? TOL : TOL_OUTER;
    return [...rdp(ring.slice(0, far + 1), tol).slice(0, -1), ...rdp([...ring.slice(far), ring[0]], tol).slice(0, -1)];
  }
  const out = [];
  let i = start;
  do {
    // a run covers i..j where ring[j] is the first vertex with a different owner set (inclusive end)
    let j = (i + 1) % n;
    while (ks[j] === ks[i] && j !== start) j = (j + 1) % n;
    const run = [];
    for (let k = i; ; k = (k + 1) % n) {
      run.push(ring[k]);
      if (k === j) break;
    }
    const a = run[0];
    const b = run[run.length - 1];
    const tol = inCore(a[0], a[1]) || inCore(b[0], b[1]) ? TOL : TOL_OUTER;
    out.push(...rdp(run, tol).slice(0, -1));
    i = j;
  } while (i !== start);
  return out;
}

// 3. simplify, then drop specks
const countries = [];
for (const c of raw) {
  const rings = [];
  for (const r of c.rings) {
    const ring = simplifyRing(r);
    const big = area(ring) >= (ring.some(([lon, lat]) => inCore(lon, lat)) ? MIN_AREA : MIN_AREA_OUTER);
    if (ring.length >= 3 && big) rings.push(flat(ring));
  }
  if (rings.length) countries.push({ name: c.name, rings });
}

const rivers = [];
for (const f of JSON.parse(readFileSync(riversPath, 'utf8')).features) {
  const { name, scalerank } = f.properties;
  if (!f.geometry || !RIVERS.has(name)) continue;
  const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const line of lines) {
    if (!line.some(([lon, lat]) => lon > B.w && lon < B.e && lat > B.s && lat < B.n)) continue;
    rivers.push({ name, rank: scalerank, line: flat(rdp(line, 0.02)) });
  }
}

writeFileSync(new URL('../src/data/mapdata.json', import.meta.url), JSON.stringify({ countries, rivers }));
const pts = countries.reduce((s, c) => s + c.rings.reduce((t, r) => t + r.length / 2, 0), 0);
console.log(`${countries.length} countries (${countries.map((c) => c.name).join(', ')}), ${pts} points; ${rivers.length} river lines`);
