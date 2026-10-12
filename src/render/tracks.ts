import * as THREE from 'three';
import { city, plazaSize } from '../data/cities';
import { CAR } from '../data/trainTypes';
import { BOX, COLORS } from './palette';
import { GeoBuilder, PRIM, VCOL } from './batch';
import { PAL } from './models';
import type { Game } from '../sim/game';
import type { TrackEdge } from '../sim/network';

const SLEEPER_STEP = 0.5;
const GAUGE = 0.24; // half distance between rails
const MAST_STEP = 7;
const LOOP_LEN = 7;
const LOOP_X = -1.3;

export function formationWidth(tracks: number): number {
  return tracks === 2 ? 3.4 : 2.3;
}

/** One running line: ballast shoulder, sleepers and two rails along z ∈ [z0, z1]. */
function lane(b: GeoBuilder, x: number, z0: number, z1: number, sleepers = true) {
  const len = z1 - z0;
  const zc = (z0 + z1) / 2;
  b.put(PRIM.trapezoid, PAL.ballast, x, 0.145, zc, 1.3, 0.13, len);
  if (sleepers) {
    const n = Math.floor(len / SLEEPER_STEP);
    for (let k = 0; k < n; k++) b.box(PAL.concrete, x, 0.235, z0 + (k + 0.5) * SLEEPER_STEP, 0.95, 0.05, 0.16);
  }
  for (const sx of [-GAUGE, GAUGE]) {
    b.box(PAL.dark, x + sx, 0.29, zc, 0.04, 0.06, len);
    b.box(PAL.steel, x + sx, 0.33, zc, 0.075, 0.025, len);
  }
}

/** A short rail segment between two points in the edge frame (for turnouts). */
function diagonal(b: GeoBuilder, x0: number, z0: number, x1: number, z1: number) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const ang = Math.atan2(x1 - x0, z1 - z0);
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const n = Math.floor(len / SLEEPER_STEP);
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    b.box(PAL.concrete, x0 + (x1 - x0) * t, 0.235, z0 + (z1 - z0) * t, 0.95, 0.05, 0.16, ang);
  }
  for (const s of [-GAUGE, GAUGE]) {
    const ox = Math.cos(ang) * s;
    const oz = -Math.sin(ang) * s;
    b.box(PAL.dark, cx + ox, 0.29, cz + oz, 0.04, 0.06, len, ang);
    b.box(PAL.steel, cx + ox, 0.33, cz + oz, 0.075, 0.025, len, ang);
  }
}

/** Covered platform alongside the line, on the +x (side=1) or -x side. */
function platform(b: GeoBuilder, x: number, z0: number, z1: number, side: 1 | -1) {
  const len = z1 - z0;
  const zc = (z0 + z1) / 2;
  b.block(PAL.wall, x, 0.08, zc, 1.1, 0.24, len);
  b.box(PAL.yellow, x - side * 0.47, 0.325, zc, 0.07, 0.012, len);
  const posts = Math.max(2, Math.floor(len / 1.8));
  for (let i = 0; i < posts; i++) {
    const z = z0 + 0.6 + ((len - 1.2) * i) / (posts - 1);
    b.block(PAL.dark, x + side * 0.25, 0.32, z, 0.06, 0.95, 0.06);
  }
  b.block(PAL.roofBlue, x + side * 0.1, 1.27, zc, 1.15, 0.07, len - 0.4);
  b.block(PAL.wall2, x + side * 0.1, 1.2, zc, 0.9, 0.07, len - 0.6);
  for (let i = 1; i < posts; i += 2) {
    const z = z0 + 0.6 + ((len - 1.2) * (i - 0.5)) / (posts - 1);
    b.block(PAL.wall3, x + side * 0.28, 0.32, z, 0.22, 0.14, 0.5); // bench
  }
}

function buildEdgeGeometry(e: TrackEdge): { geo: THREE.BufferGeometry; len: number } {
  const a = city(e.a);
  const bc = city(e.b);
  const len = Math.hypot(bc.x - a.x, bc.z - a.z);
  const z0 = -len / 2;
  const z1 = len / 2;
  const halfA = plazaSize(a) / 2;
  const halfB = plazaSize(bc) / 2;
  const b = new GeoBuilder();
  const fw = formationWidth(e.tracks);
  const lanes = e.tracks === 2 ? [-CAR.lane, CAR.lane] : [0];

  b.box(PAL.formation, 0, 0.04, 0, fw, 0.08, len);
  for (const lx of lanes) lane(b, lx, z0, z1);

  // overhead electrification, kept out of the station areas
  const wz0 = z0 + halfA + 1;
  const wz1 = z1 - halfB - 1;
  if (wz1 - wz0 > 2) {
    const masts = Math.max(2, Math.round((wz1 - wz0) / MAST_STEP) + 1);
    const sides = e.tracks === 2 ? [-1, 1] : [1];
    for (let i = 0; i < masts; i++) {
      const z = wz0 + ((wz1 - wz0) * i) / (masts - 1);
      for (const s of sides) {
        const mx = s * (fw / 2 - 0.12);
        const lx = e.tracks === 2 ? s * CAR.lane : 0;
        b.block(PAL.concrete, mx, 0.08, z, 0.22, 0.12, 0.22);
        b.block(PAL.dark, mx, 0.2, z, 0.08, 1.65, 0.08);
        b.box(PAL.dark, (mx + lx) / 2, 1.78, z, Math.abs(mx - lx) + 0.1, 0.05, 0.05);
        b.box(PAL.dark, (mx + lx) / 2, 1.66, z, Math.abs(mx - lx) * 0.8, 0.03, 0.03, 0, 0, s * 0.2);
        b.box(PAL.dark, lx, 1.62, z, 0.025, 0.3, 0.025);
      }
    }
    for (const lx of lanes) b.box(PAL.dark, lx, 1.48, (wz0 + wz1) / 2, 0.025, 0.025, wz1 - wz0);
  }

  // crossing loops between signal blocks on single lines
  if (e.tracks === 1) {
    for (let j = 1; j < e.blocks; j++) {
      const z = z0 + (j * len) / e.blocks;
      b.box(PAL.formation, LOOP_X / 2, 0.04, z, Math.abs(LOOP_X) + fw, 0.08, LOOP_LEN + 4);
      lane(b, LOOP_X, z - LOOP_LEN / 2, z + LOOP_LEN / 2);
      diagonal(b, 0, z - LOOP_LEN / 2 - 1.6, LOOP_X, z - LOOP_LEN / 2);
      diagonal(b, LOOP_X, z + LOOP_LEN / 2, 0, z + LOOP_LEN / 2 + 1.6);
      // signal posts
      for (const s of [-1, 1]) {
        const sz = z + s * (LOOP_LEN / 2 + 2.4);
        b.block(PAL.dark, 0.85, 0.08, sz, 0.06, 1.1, 0.06);
        b.block(PAL.dark, 0.85, 1.05, sz, 0.18, 0.32, 0.12);
        b.box(PAL.yellow, 0.85, 1.25, sz - s * 0.065, 0.08, 0.08, 0.02);
      }
    }
  }

  // platforms where the line runs into each station
  const px = (e.tracks === 2 ? CAR.lane : 0) + 0.42 + 0.55;
  for (const [half, end] of [[halfA, -1], [halfB, 1]] as const) {
    const d0 = 3.2;
    const d1 = Math.min(half + 2.5, len / 2 - 1);
    if (d1 - d0 < 3) continue;
    const pz0 = end < 0 ? z0 + d0 : z1 - d1;
    const pz1 = end < 0 ? z0 + d1 : z1 - d0;
    platform(b, px, pz0, pz1, 1);
    if (e.tracks === 2) platform(b, -px, pz0, pz1, -1);
  }
  return { geo: b.build(), len };
}

/** Track meshes, rebuilt per edge when the network changes. */
export class TrackView {
  group = new THREE.Group();
  private views = new Map<string, { tracks: number; mesh: THREE.Mesh }>();
  private ghost: THREE.Mesh;
  private highlight = new THREE.Group();

  constructor(scene: THREE.Scene) {
    scene.add(this.group, this.highlight);
    this.ghost = new THREE.Mesh(
      BOX,
      new THREE.MeshBasicMaterial({ color: COLORS.yellow, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.ghost.visible = false;
    scene.add(this.ghost);
  }

  sync(game: Game) {
    for (const [id, v] of this.views) {
      const e = game.net.edges.get(id);
      if (!e || e.tracks !== v.tracks) {
        this.group.remove(v.mesh);
        v.mesh.geometry.dispose();
        this.views.delete(id);
      }
    }
    for (const e of game.net.edges.values()) {
      if (this.views.has(e.id)) continue;
      const a = city(e.a);
      const b = city(e.b);
      const { geo } = buildEdgeGeometry(e);
      const mesh = new THREE.Mesh(geo, VCOL);
      mesh.position.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
      mesh.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      this.views.set(e.id, { tracks: e.tracks, mesh });
    }
  }

  showGhost(from: string | null, to: { x: number; z: number } | null, ok: boolean) {
    if (!from || !to) { this.ghost.visible = false; return; }
    const a = city(from);
    const len = Math.hypot(to.x - a.x, to.z - a.z);
    this.ghost.visible = len > 0.5;
    this.ghost.position.set((a.x + to.x) / 2, 0.2, (a.z + to.z) / 2);
    this.ghost.rotation.y = Math.atan2(to.x - a.x, to.z - a.z);
    this.ghost.scale.set(formationWidth(1), 0.06, len);
    (this.ghost.material as THREE.MeshBasicMaterial).color.set(ok ? COLORS.yellow : 0xd0423f);
  }

  /** Yellow overlay along a node path (selected train's route or a selected track). */
  setHighlight(path: string[] | null) {
    for (const c of [...this.highlight.children]) this.highlight.remove(c);
    if (!path) return;
    const m = new THREE.MeshBasicMaterial({ color: COLORS.yellow, transparent: true, opacity: 0.9, depthWrite: false });
    for (let i = 1; i < path.length; i++) {
      const a = city(path[i - 1]);
      const b = city(path[i]);
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const s = new THREE.Mesh(BOX, m);
      s.position.set((a.x + b.x) / 2, 0.27, (a.z + b.z) / 2);
      s.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      s.scale.set(0.2, 0.01, len);
      this.highlight.add(s);
    }
  }

  /** Track edge under a ground point. */
  edgeAt(game: Game, x: number, z: number): string | null {
    let best: string | null = null;
    let bd = 1.8;
    for (const e of game.net.edges.values()) {
      const a = city(e.a);
      const b = city(e.b);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
      const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
      if (d < bd) { bd = d; best = e.id; }
    }
    return best;
  }
}
