import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { CITIES, City, plazaSize } from '../data/cities';
import { onLand } from '../data/geo';
import { BOX, COLORS, mat, rng } from './palette';
import { GeoBuilder, VCOL } from './batch';
import { HOUSES, HouseKind, PAL, PERSON, stationGeometry } from './models';
import { formationWidth } from './tracks';
import { buildTerrain, TerrainUniforms } from './terrain';
import type { Game } from '../sim/game';

interface Placed {
  kind: HouseKind;
  key: string; // city|kind instanced mesh it lives in
  index: number; // instance index within that mesh
  x: number;
  z: number;
  r: number;
  m: THREE.Matrix4;
  lot?: number; // instance index of the blue lot under it
  lotM?: THREE.Matrix4;
}

interface StationView {
  city: City;
  pivot: THREE.Group; // station building + crowd, turned to face away from the tracks
  side: number;
  size: number;
  people: THREE.InstancedMesh;
  spots: THREE.Matrix4[];
  shown: number;
  label: CSS2DObject;
  labelCount: HTMLElement;
  lastWaiting: number;
}

const SMALL_PROPS = new Set(['tree', 'tree2', 'cottage', 'cottageBlue', 'cottageSlate']);
const MAX_PEOPLE = 140;
const PAX_PER_PERSON = 12;
const PEOPLE_COLORS = ['#2c3966', '#3d63d6', '#f2c12e', '#8a94b0', '#d0423f', '#f5f6f9', '#2c3966', '#3d63d6'];

type Zone = 'core' | 'mid' | 'outer';

/** Weighted pick of a house kind for a zone and city size. */
function pickKind(zone: Zone, pop: number, r: () => number): HouseKind {
  const big = pop >= 5;
  const mid = pop >= 1.5;
  const table: [HouseKind, number][] =
    zone === 'core'
      ? big
        ? [['tower', 3], ['apartment', 4], ['shopsBlue', 2], ['shopsYellow', 1]]
        : mid
          ? [['apartment', 3], ['shopsBlue', 2], ['shopsYellow', 2], ['town', 2], ['townSlate', 1]]
          : [['shopsBlue', 2], ['shopsYellow', 2], ['flatBlue', 2], ['town', 2]]
      : zone === 'mid'
        ? [['flatBlue', 3], ['flatYellow', 2], ['town', 2], ['townSlate', 2], ['shopsBlue', 1], ...(big ? [['apartment', 2]] as [HouseKind, number][] : [])]
        : [['cottage', 3], ['cottageBlue', 2], ['cottageSlate', 2], ['flatBlue', 1], ['flatYellow', 1]];
  const total = table.reduce((s, t) => s + t[1], 0);
  let k = r() * total;
  for (const [kind, w] of table) {
    k -= w;
    if (k <= 0) return kind;
  }
  return table[0][0];
}

export class World {
  group = new THREE.Group();
  stations = new Map<string, StationView>();
  private placed: Placed[] = [];
  /** One instanced mesh per city and house kind, so off-screen cities are culled. */
  private houseMeshes = new Map<string, THREE.InstancedMesh>();
  private lotMesh!: THREE.InstancedMesh;
  private hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  private detail = true;
  private bracket: THREE.Group;
  private selectBracket: THREE.Group;
  private terrain: TerrainUniforms;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.terrain = buildTerrain(this.group);
    this.buildCities();
    this.bracket = this.makeBracket(COLORS.white);
    this.selectBracket = this.makeBracket(COLORS.yellow);
    this.group.add(this.bracket, this.selectBracket);
  }

  private buildStation(c: City, s: number, r: () => number): StationView {
    // plaza, kerb and station building in one mesh
    const b = new GeoBuilder();
    b.box(PAL.plaza, 0, 0.025, 0, s, 0.05, s);
    for (const [x, z, w, d] of [[0, s / 2, s + 0.3, 0.15], [0, -s / 2, s + 0.3, 0.15], [s / 2, 0, 0.15, s], [-s / 2, 0, 0.15, s]]) {
      b.box(PAL.wall2, x, 0.04, z, w, 0.08, d);
    }
    const st = stationGeometry(s);
    const stationMesh = new THREE.Mesh(st.build(), VCOL);
    stationMesh.position.set(0, 0.05, 0);
    const pivot = new THREE.Group();
    pivot.position.set(c.x, 0, c.z);
    pivot.add(stationMesh);
    stationMesh.castShadow = stationMesh.receiveShadow = true;
    const plaza = new THREE.Mesh(b.build(), VCOL);
    plaza.position.set(c.x, 0, c.z);
    plaza.receiveShadow = true;
    this.group.add(plaza, pivot);

    // painted station code
    const code = paintedText(c.id);
    const cw = s * 0.42;
    code.scale.set(cw, cw * 0.5, 1);
    code.position.set(c.x + s * 0.24, 0.056, c.z + s * 0.3);
    this.group.add(code);

    // yellow direction triangle
    const tri = new THREE.Mesh(triangleGeo(), mat(COLORS.yellow));
    tri.scale.setScalar(s * 0.07);
    tri.position.set(c.x - s * 0.36, 0.057, c.z + s * 0.32);
    this.group.add(tri);

    // waiting passengers stand on the forecourt in front of the station building
    const people = new THREE.InstancedMesh(PERSON, VCOL, MAX_PEOPLE);
    people.count = 0;
    people.castShadow = true;
    people.frustumCulled = false; // instances are written later; bounds computed now would be empty
    const spots: THREE.Matrix4[] = [];
    const tmp = new THREE.Object3D();
    const col = new THREE.Color();
    const front = -s / 2 + 1.2 + 2.0;
    const width = Math.max(4.5, s * 0.8);
    for (let i = 0; i < MAX_PEOPLE; i++) {
      const row = Math.floor(i / 28);
      const colI = i % 28;
      tmp.position.set(
        (colI / 27 - 0.5) * width + (r() - 0.5) * 0.2,
        0.05,
        front + row * 0.4 + (r() - 0.5) * 0.2,
      );
      tmp.rotation.set(0, r() * Math.PI * 2, 0);
      tmp.scale.setScalar(0.9 + r() * 0.25);
      tmp.updateMatrix();
      spots.push(tmp.matrix.clone());
      people.setColorAt(i, col.set(PEOPLE_COLORS[Math.floor(r() * PEOPLE_COLORS.length)]));
    }
    pivot.add(people);

    // label
    const el = document.createElement('div');
    el.className = 'city-label';
    el.innerHTML = `<span class="name"></span><span class="count"></span>`;
    (el.querySelector('.name') as HTMLElement).textContent = c.name;
    const label = new CSS2DObject(el);
    label.position.set(0, 6, -s * 0.5 + 1.2);
    label.center.set(0.5, 1);
    pivot.add(label);

    return {
      city: c, pivot, side: 0, size: s, people, spots, shown: 0, label,
      labelCount: el.querySelector('.count') as HTMLElement, lastWaiting: -1,
    };
  }

  private buildCities() {
    const placed: Placed[] = [];
    const lots: THREE.Matrix4[] = [];
    const counts = new Map<string, number>();
    let cityId = "";
    const tmp = new THREE.Object3D();

    const clearOfPlazas = (x: number, z: number, rad: number) =>
      !CITIES.some((o) => {
        const h = plazaSize(o) / 2 + rad + 0.8;
        return Math.abs(o.x - x) < h && Math.abs(o.z - z) < h;
      });

    const place = (kind: HouseKind, x: number, z: number, ang: number, scale: number, lot: boolean) => {
      const h = HOUSES[kind];
      const rad = h.radius * scale;
      tmp.position.set(x, 0.04, z);
      tmp.rotation.set(0, ang, 0);
      tmp.scale.setScalar(scale);
      tmp.updateMatrix();
      const key = `${cityId}|${kind}`;
      const index = counts.get(key) ?? 0;
      counts.set(key, index + 1);
      const p: Placed = { kind, key, index, x, z, r: rad, m: tmp.matrix.clone() };
      if (lot) {
        const ls = rad * 2 + 1.0;
        tmp.position.set(x, 0.02, z);
        tmp.scale.set(ls, 0.04, ls);
        tmp.updateMatrix();
        p.lot = lots.length;
        p.lotM = tmp.matrix.clone();
        lots.push(p.lotM);
        p.r = ls * 0.7;
      }
      placed.push(p);
    };

    const fits = (x: number, z: number, rad: number) =>
      [[0, 0], [rad, 0], [-rad, 0], [0, rad], [0, -rad]].every(([ox, oz]) => onLand(x + ox, z + oz)) &&
      !placed.some((b) => Math.hypot(b.x - x, b.z - z) < b.r + rad + 0.35) &&
      clearOfPlazas(x, z, rad);

    for (const c of CITIES) {
      const s = plazaSize(c);
      const r = rng(c.id);
      cityId = c.id;
      this.stations.set(c.id, this.buildStation(c, s, r));

      const gridAng = r() * Math.PI;
      const r0 = s * 0.5 + 1.5;
      const maxR = s * 0.5 + 7 + Math.sqrt(c.pop) * 5;

      // one temple per city, close to the station
      for (let t = 0; t < 30; t++) {
        const ang = r() * Math.PI * 2;
        const dist = r0 + 2 + r() * 4;
        const x = c.x + Math.cos(ang) * dist;
        const z = c.z + Math.sin(ang) * dist;
        if (fits(x, z, HOUSES.temple.radius)) { place('temple', x, z, gridAng, 1, false); break; }
      }

      const n = Math.round(Math.min(90, 14 + c.pop * 2.8));
      let made = 0;
      for (let tries = 0; made < n && tries < n * 40; tries++) {
        const ang = r() * Math.PI * 2;
        const f = Math.pow(r(), 1.25);
        const dist = r0 + f * (maxR - r0);
        const zone: Zone = f < 0.3 ? 'core' : f < 0.65 ? 'mid' : 'outer';
        const kind = pickKind(zone, c.pop, r);
        const scale = 0.92 + r() * 0.22;
        const x = c.x + Math.cos(ang) * dist;
        const z = c.z + Math.sin(ang) * dist;
        const lot = (kind === 'apartment' || kind === 'tower' || kind.startsWith('shops')) && r() < 0.4;
        const rad = HOUSES[kind].radius * scale + (lot ? 0.5 : 0);
        if (!fits(x, z, rad)) continue;
        place(kind, x, z, gridAng + Math.floor(r() * 4) * (Math.PI / 2), scale, lot);
        made++;
      }

      // trees fill the gaps, mostly towards the edge of town
      const nt = Math.round(10 + n * 0.6);
      let trees = 0;
      for (let tries = 0; trees < nt && tries < nt * 20; tries++) {
        const ang = r() * Math.PI * 2;
        const dist = r0 + Math.pow(r(), 0.7) * (maxR + 4 - r0);
        const x = c.x + Math.cos(ang) * dist;
        const z = c.z + Math.sin(ang) * dist;
        const scale = 0.8 + r() * 0.6;
        if (!fits(x, z, 0.6 * scale)) continue;
        place(r() < 0.5 ? 'tree' : 'tree2', x, z, r() * Math.PI * 2, scale, false);
        trees++;
      }
    }

    this.placed = placed;
    for (const [key, count] of counts) {
      const kind = key.split('|')[1] as HouseKind;
      const mesh = new THREE.InstancedMesh(HOUSES[kind].geo, VCOL, count);
      mesh.castShadow = mesh.receiveShadow = true;
      this.houseMeshes.set(key, mesh);
      this.group.add(mesh);
    }
    for (const p of placed) this.houseMeshes.get(p.key)!.setMatrixAt(p.index, p.m);

    this.lotMesh = new THREE.InstancedMesh(BOX, mat(COLORS.plaza), Math.max(1, lots.length));
    lots.forEach((m, i) => this.lotMesh.setMatrixAt(i, m));
    this.lotMesh.receiveShadow = true;
    this.group.add(this.lotMesh);
  }

  /** Hide buildings that sit on top of a track corridor. */
  clearCorridors(game: Game) {
    const segs = [...game.net.edges.values()].map((e) => {
      const a = this.stations.get(e.a)!.city;
      const b = this.stations.get(e.b)!.city;
      return { ax: a.x, az: a.z, bx: b.x, bz: b.z, w: formationWidth(e.tracks) / 2 + (e.tracks === 1 ? 1.6 : 0.4) };
    });
    for (const p of this.placed) {
      const blocked = segs.some((s) => segDist(p.x, p.z, s.ax, s.az, s.bx, s.bz) < p.r + s.w);
      if (p.lot !== undefined) this.lotMesh.setMatrixAt(p.lot, blocked ? this.hidden : p.lotM!);
      this.houseMeshes.get(p.key)!.setMatrixAt(p.index, blocked ? this.hidden : p.m);
    }
    for (const m of this.houseMeshes.values()) m.instanceMatrix.needsUpdate = true;
    this.lotMesh.instanceMatrix.needsUpdate = true;
    this.orientStations(game);
  }

  /** Turn each station building to the plaza side furthest from its lines. */
  private orientStations(game: Game) {
    for (const st of this.stations.values()) {
      const links = game.net.adj.get(st.city.id) ?? [];
      const angles = links.map(({ to }) => {
        const o = this.stations.get(to)!.city;
        return Math.atan2(o.x - st.city.x, o.z - st.city.z);
      });
      let best = 0;
      let bestGap = -1;
      for (let k = 0; k < 4; k++) {
        const theta = (k * Math.PI) / 2;
        const facing = theta + Math.PI; // direction of the building's side for rotation theta
        let gap = Math.PI;
        for (const a of angles) {
          const d = Math.abs(Math.atan2(Math.sin(a - facing), Math.cos(a - facing)));
          gap = Math.min(gap, d);
        }
        if (gap > bestGap + 1e-6) { bestGap = gap; best = k; }
      }
      if (best !== st.side) {
        st.side = best;
        st.pivot.rotation.y = (best * Math.PI) / 2;
      }
    }
  }

  private makeBracket(color: number): THREE.Group {
    const g = new THREE.Group();
    const m = mat(color);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const a = new THREE.Mesh(BOX, m);
      a.scale.set(0.25, 0.04, 0.06);
      a.position.set(sx * 0.4, 0, sz * 0.5);
      const b = new THREE.Mesh(BOX, m);
      b.scale.set(0.06, 0.04, 0.25);
      b.position.set(sx * 0.5, 0, sz * 0.4);
      g.add(a, b);
    }
    g.visible = false;
    return g;
  }

  private placeBracket(g: THREE.Group, id: string | null) {
    if (!id) { g.visible = false; return; }
    const st = this.stations.get(id)!;
    const s = st.size + 1.4;
    g.visible = true;
    g.position.set(st.city.x, 0.08, st.city.z);
    g.scale.set(s, 1, s);
  }

  setHover(id: string | null) {
    this.placeBracket(this.bracket, id);
  }

  setSelected(id: string | null) {
    this.placeBracket(this.selectBracket, id);
  }

  /** Per-frame: waiting passengers, labels. */
  update(game: Game, camDistance: number, highlight: Set<string>) {
    // small props are sub-pixel from far away; skip drawing them
    const detail = camDistance < 420;
    // the tile grid only reads up close; further out it turns to noise
    this.terrain.uGrid.value = THREE.MathUtils.clamp((420 - camDistance) / 220, 0, 1);
    if (detail !== this.detail) {
      this.detail = detail;
      for (const [key, m] of this.houseMeshes) if (SMALL_PROPS.has(key.split('|')[1])) m.visible = detail;
    }
    const far = camDistance > 400;
    const minPop = camDistance > 700 ? 9 : 3;
    for (const st of this.stations.values()) {
      const waiting = game.waitingAt(st.city.id);
      const want = Math.min(MAX_PEOPLE, Math.ceil(waiting / PAX_PER_PERSON));
      if (want !== st.shown) {
        for (let i = st.shown; i < want; i++) st.people.setMatrixAt(i, st.spots[i]);
        st.people.count = want;
        st.people.instanceMatrix.needsUpdate = true;
        st.shown = want;
      }
      if (waiting !== st.lastWaiting) {
        st.lastWaiting = waiting;
        st.labelCount.textContent = waiting > 0 ? String(waiting) : '';
      }
      const connected = game.net.isConnected(st.city.id);
      const visible = highlight.has(st.city.id) || !far || st.city.pop >= minPop || (connected && camDistance < 650);
      st.label.visible = visible;
      st.label.element.classList.toggle('connected', connected);
      st.label.element.classList.toggle('hl', highlight.has(st.city.id));
    }
  }

  /** City under a ground point, if any. */
  cityAt(x: number, z: number): string | null {
    let best: string | null = null;
    let bd = Infinity;
    for (const st of this.stations.values()) {
      const d = Math.max(Math.abs(st.city.x - x), Math.abs(st.city.z - z));
      if (d < st.size / 2 + 1.2 && d < bd) { bd = d; best = st.city.id; }
    }
    return best;
  }
}

export function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function paintedText(text: string): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(255,255,255,0.92)';
  let size = 190;
  g.font = `600 ${size}px "Chakra Petch", sans-serif`;
  while (g.measureText(text).width > 480 && size > 40) {
    size -= 10;
    g.font = `600 ${size}px "Chakra Petch", sans-serif`;
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 140);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshLambertMaterial({ map: t, transparent: true, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  return m;
}

let triGeo: THREE.BufferGeometry | null = null;
function triangleGeo(): THREE.BufferGeometry {
  if (triGeo) return triGeo;
  const s = new THREE.Shape([new THREE.Vector2(-0.6, -0.7), new THREE.Vector2(0.9, 0), new THREE.Vector2(-0.6, 0.7)]);
  triGeo = new THREE.ShapeGeometry(s);
  triGeo.rotateX(-Math.PI / 2);
  return triGeo;
}
