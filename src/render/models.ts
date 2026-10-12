import * as THREE from 'three';
import { GeoBuilder, PRIM } from './batch';
import { CAR, TrainType } from '../data/trainTypes';

export const PAL = {
  wall: '#f5f6f9',
  wall2: '#e7eaf2',
  wall3: '#dde2ee',
  roof: '#cdd3e0',
  roofBlue: '#3d63d6',
  roofSlate: '#8a94b0',
  win: '#2c3966',
  winSoft: '#5d70ab',
  glass: '#6584dc',
  tank: '#23263a',
  door: '#2c3966',
  yellow: '#f2c12e',
  saffron: '#f0962c',
  trunk: '#8d8478',
  leaf: '#a6c79c',
  leaf2: '#8fb98a',
  dark: '#262b40',
  steel: '#e4e8f0',
  concrete: '#6e7590',
  ballast: '#c4c9d7',
  formation: '#4169dc',
  plaza: '#3d63d6',
  shutter: '#aab2c8',
};

type B = GeoBuilder;

/** Windows on all four faces of a W×D block, in `rows` storeys. */
function windows(
  b: B, W: number, D: number, rows: number, y0: number, dy: number,
  colsF: number, colsS: number, ww = 0.26, wh = 0.3, color: string = PAL.win,
) {
  for (let r = 0; r < rows; r++) {
    const y = y0 + r * dy;
    for (let i = 0; i < colsF; i++) {
      const x = -W / 2 + (W / colsF) * (i + 0.5);
      b.box(color, x, y, D / 2 + 0.012, ww, wh, 0.03);
      b.box(color, x, y, -D / 2 - 0.012, ww, wh, 0.03);
    }
    for (let i = 0; i < colsS; i++) {
      const z = -D / 2 + (D / colsS) * (i + 0.5);
      b.box(color, W / 2 + 0.012, y, z, 0.03, wh, ww);
      b.box(color, -W / 2 - 0.012, y, z, 0.03, wh, ww);
    }
  }
}

function parapet(b: B, W: number, D: number, y: number, color: string = PAL.wall) {
  const t = 0.08;
  const h = 0.16;
  b.block(color, 0, y, D / 2 - t / 2, W, h, t);
  b.block(color, 0, y, -D / 2 + t / 2, W, h, t);
  b.block(color, W / 2 - t / 2, y, 0, t, h, D);
  b.block(color, -W / 2 + t / 2, y, 0, t, h, D);
}

function waterTank(b: B, x: number, y: number, z: number, r = 0.2) {
  b.put(PRIM.cyl, PAL.tank, x, y + r * 0.9, z, r * 2, r * 1.8, r * 2);
  b.put(PRIM.cyl, PAL.tank, x, y + r * 1.85, z, r * 1.2, r * 0.12, r * 1.2);
}

export interface HouseModel {
  geo: THREE.BufferGeometry;
  radius: number; // footprint, for spacing
  height: number;
}

function model(fn: (b: B) => void, radius: number, height: number): HouseModel {
  const b = new GeoBuilder();
  fn(b);
  return { geo: b.build(), radius, height };
}

/** Pitched-roof cottage. */
function cottage(roof: string, wall: string = PAL.wall): HouseModel {
  return model((b) => {
    const W = 1.8, D = 1.5, H = 1.15;
    b.block(wall, 0, 0, 0, W, H, D);
    b.put(PRIM.prism, roof, 0, H + 0.36, 0, D + 0.22, 0.72, W + 0.3, Math.PI / 2);
    b.block(PAL.door, 0.35, 0, D / 2 + 0.01, 0.32, 0.62, 0.04);
    b.box(PAL.win, -0.45, 0.68, D / 2 + 0.012, 0.34, 0.3, 0.03);
    b.box(PAL.win, W / 2 + 0.012, 0.68, 0, 0.03, 0.3, 0.34);
    b.box(PAL.win, -W / 2 - 0.012, 0.68, 0, 0.03, 0.3, 0.34);
    b.block(PAL.wall3, -0.5, H + 0.25, -0.25, 0.22, 0.6, 0.22);
    b.block(PAL.wall3, 0.35, 0, D / 2 + 0.25, 0.7, 0.04, 0.45); // step
  }, 1.25, 1.9);
}

/** Two-storey flat-roof house with water tank and balcony. */
function flatHouse(band: string): HouseModel {
  return model((b) => {
    const W = 2.0, D = 1.8, H = 1.9;
    b.block(PAL.wall, 0, 0, 0, W, H, D);
    b.block(band, 0, 0.9, 0, W + 0.02, 0.08, D + 0.02);
    parapet(b, W, D, H);
    windows(b, W, D, 2, 0.6, 0.95, 2, 2, 0.34, 0.34, PAL.winSoft);
    b.block(PAL.door, 0, 0, D / 2 + 0.01, 0.34, 0.66, 0.04);
    // balcony
    b.block(PAL.wall2, 0, 0.94, D / 2 + 0.2, W * 0.7, 0.07, 0.4);
    b.block(band, 0, 1.01, D / 2 + 0.38, W * 0.7, 0.24, 0.04);
    // stair room + tank
    b.block(PAL.wall2, -0.5, H, -0.4, 0.7, 0.6, 0.7);
    waterTank(b, 0.45, H, -0.35);
  }, 1.45, 2.6);
}

/** Narrow three-storey house. */
function townHouse(band: string): HouseModel {
  return model((b) => {
    const W = 1.6, D = 1.7, H = 2.8;
    b.block(PAL.wall2, 0, 0, 0, W, H, D);
    for (const y of [0.92, 1.85]) b.block(band, 0, y, 0, W + 0.02, 0.07, D + 0.02);
    parapet(b, W, D, H, PAL.wall2);
    windows(b, W, D, 3, 0.55, 0.93, 2, 2, 0.3, 0.34, PAL.winSoft);
    b.block(PAL.door, 0, 0, D / 2 + 0.01, 0.3, 0.62, 0.04);
    waterTank(b, 0.3, H, 0.2, 0.22);
    b.block(PAL.wall, -0.35, H, -0.3, 0.6, 0.5, 0.6);
  }, 1.3, 3.5);
}

/** Mid-rise apartment block. */
function apartment(): HouseModel {
  return model((b) => {
    const W = 3.4, D = 2.4, H = 4.8;
    b.block(PAL.wall, 0, 0, 0, W, H, D);
    b.block(PAL.wall3, 0, 0, 0, W + 0.04, 0.5, D + 0.04);
    for (let i = 1; i < 6; i++) b.block(PAL.wall2, 0, 0.5 + i * 0.72 - 0.04, 0, W + 0.03, 0.05, D + 0.03);
    parapet(b, W, D, H);
    windows(b, W, D, 6, 0.85, 0.72, 4, 2, 0.42, 0.3, PAL.winSoft);
    b.block(PAL.door, 0, 0, D / 2 + 0.01, 0.6, 0.42, 0.04);
    b.block(PAL.wall2, 0.8, H, 0, 0.9, 0.7, 0.9);
    waterTank(b, -0.7, H, 0.4, 0.24);
    waterTank(b, -1.2, H, -0.3, 0.24);
  }, 2.2, 5.6);
}

/** Office / residential tower with glass bands. */
function tower(): HouseModel {
  return model((b) => {
    const W = 2.8, D = 2.8, H = 9.0;
    b.block(PAL.wall3, 0, 0, 0, W + 0.3, 0.8, D + 0.3);
    const floors = 13;
    const fh = (H - 0.8) / floors;
    for (let i = 0; i < floors; i++) {
      const y = 0.8 + i * fh;
      b.block(PAL.wall, 0, y, 0, W, fh * 0.4, D);
      b.block(PAL.glass, 0, y + fh * 0.4, 0, W - 0.12, fh * 0.6, D - 0.12);
    }
    // corner fins
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.block(PAL.wall, sx * (W / 2 - 0.1), 0.8, sz * (D / 2 - 0.1), 0.22, H - 0.8, 0.22);
    b.block(PAL.wall, 0, H, 0, W, 0.35, D);
    b.block(PAL.wall2, 0, H + 0.35, 0, 1.2, 0.6, 1.2);
    b.block(PAL.dark, 0.9, H + 0.35, 0.9, 0.06, 1.4, 0.06);
  }, 2.1, 10.5);
}

/** Row of shops with shutters and a sign band. */
function shops(sign: string): HouseModel {
  return model((b) => {
    const W = 4.2, D = 1.7, H = 1.35;
    b.block(PAL.wall, 0, 0, 0, W, H, D);
    parapet(b, W, D, H);
    b.block(sign, 0, H - 0.32, D / 2 + 0.02, W - 0.1, 0.22, 0.04);
    for (let i = 0; i < 4; i++) {
      const x = -W / 2 + (W / 4) * (i + 0.5);
      b.block(PAL.shutter, x, 0, D / 2 + 0.015, W / 4 - 0.18, 0.78, 0.03);
      for (let k = 0; k < 4; k++) b.block(PAL.roofSlate, x, 0.12 + k * 0.17, D / 2 + 0.03, W / 4 - 0.18, 0.02, 0.02);
    }
    b.block(PAL.wall2, 0, 0.92, D / 2 + 0.25, W, 0.05, 0.5); // awning slab
    windows(b, W, D, 1, 0.75, 0, 0, 2, 0.3, 0.3);
  }, 2.3, 1.6);
}

/** Small mandir with stepped shikhara and a flag. */
function temple(): HouseModel {
  return model((b) => {
    b.block(PAL.wall2, 0, 0, 0, 3.0, 0.3, 3.0);
    b.block(PAL.wall3, 0, 0, 1.65, 1.2, 0.15, 0.4);
    b.block(PAL.wall, 0, 0.3, 0.4, 2.0, 1.0, 1.6);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.block(PAL.wall, sx * 0.85, 0.3, 1.0 + sz * 0.28, 0.16, 1.0, 0.16);
    b.block(PAL.wall2, 0, 1.3, 0.75, 2.1, 0.12, 0.9);
    b.block(PAL.door, 0, 0.3, 1.21, 0.4, 0.6, 0.04);
    b.block(PAL.wall, 0, 0.3, -0.5, 1.7, 1.2, 1.7);
    let s = 1.6;
    let y = 1.5;
    for (let i = 0; i < 4; i++) {
      b.block(i % 2 ? PAL.wall2 : PAL.wall, 0, y, -0.5, s, 0.42, s);
      y += 0.42;
      s *= 0.78;
    }
    b.put(PRIM.pyramid, PAL.wall, 0, y + 0.45, -0.5, s * 1.1, 0.9, s * 1.1);
    b.put(PRIM.cyl, PAL.yellow, 0, y + 0.95, -0.5, 0.16, 0.12, 0.16);
    b.box(PAL.dark, 0, y + 1.4, -0.5, 0.04, 1.0, 0.04);
    b.box(PAL.saffron, 0.22, y + 1.72, -0.5, 0.42, 0.26, 0.02);
  }, 1.9, 5.5);
}

function tree(leaf: string): HouseModel {
  return model((b) => {
    b.put(PRIM.cyl, PAL.trunk, 0, 0.3, 0, 0.16, 0.6, 0.16);
    b.put(PRIM.ico, leaf, 0, 0.95, 0, 1.0, 0.9, 1.0);
    b.put(PRIM.ico, leaf, 0.18, 1.35, 0.05, 0.62, 0.6, 0.62, 0.7);
  }, 0.6, 1.6);
}

export const HOUSES = {
  cottage: cottage(PAL.roof),
  cottageBlue: cottage(PAL.roofBlue),
  cottageSlate: cottage(PAL.roofSlate, PAL.wall2),
  flatBlue: flatHouse(PAL.roofBlue),
  flatYellow: flatHouse(PAL.yellow),
  town: townHouse(PAL.roofBlue),
  townSlate: townHouse(PAL.roofSlate),
  apartment: apartment(),
  tower: tower(),
  shopsBlue: shops(PAL.roofBlue),
  shopsYellow: shops(PAL.yellow),
  temple: temple(),
  tree: tree(PAL.leaf),
  tree2: tree(PAL.leaf2),
};
export type HouseKind = keyof typeof HOUSES;

/** Waiting passenger: body + head, tinted per instance. */
export const PERSON = (() => {
  const b = new GeoBuilder();
  b.put(PRIM.cyl, '#ffffff', 0, 0.2, 0, 0.2, 0.4, 0.16);
  b.put(PRIM.box, '#e9e2d8', 0, 0.48, 0, 0.14, 0.14, 0.14);
  return b.build();
})();

/** Main station building for a plaza of size s, centred on the origin. */
export function stationGeometry(s: number): GeoBuilder {
  const b = new GeoBuilder();
  const L = Math.max(5, s * 0.55);
  const z = -s / 2 + 1.2;
  // main hall
  b.block(PAL.wall, 0, 0, z, L, 1.7, 1.8);
  b.block(PAL.wall2, 0, 1.7, z, L + 0.2, 0.14, 2.0);
  b.block(PAL.yellow, 0, 1.25, z + 0.91, L, 0.08, 0.03);
  const n = Math.floor(L / 0.7);
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (L / n) * (i + 0.5);
    if (Math.abs(x) < 1.0) continue;
    b.box(PAL.win, x, 0.75, z + 0.912, 0.32, 0.6, 0.03);
    b.box(PAL.win, x, 0.75, z - 0.912, 0.32, 0.6, 0.03);
  }
  // end pavilions with pyramid roofs
  for (const sx of [-1, 1]) {
    b.block(PAL.wall, sx * (L / 2 - 0.5), 0, z, 1.2, 2.2, 2.2);
    b.put(PRIM.pyramid, PAL.roofBlue, sx * (L / 2 - 0.5), 2.2 + 0.35, z, 1.4, 0.7, 2.4);
  }
  // central clock tower
  b.block(PAL.wall, 0, 0, z, 1.6, 3.4, 1.6);
  b.block(PAL.wall2, 0, 3.4, z, 1.8, 0.14, 1.8);
  b.block(PAL.wall, 0, 3.54, z, 1.2, 0.8, 1.2);
  b.put(PRIM.pyramid, PAL.roofBlue, 0, 4.34 + 0.55, z, 1.5, 1.1, 1.5);
  b.put(PRIM.cyl, '#ffffff', 0, 2.7, z + 0.81, 0.62, 0.04, 0.62, 0, Math.PI / 2);
  b.box(PAL.dark, 0, 2.78, z + 0.84, 0.04, 0.22, 0.02);
  b.box(PAL.dark, 0.06, 2.7, z + 0.84, 0.14, 0.04, 0.02);
  // entrance arch + canopy
  b.block(PAL.door, 0, 0, z + 0.81, 0.7, 1.1, 0.04);
  b.block(PAL.wall2, 0, 1.25, z + 1.3, 2.4, 0.08, 1.0);
  for (const sx of [-1, 1]) b.block(PAL.wall, sx * 1.1, 0, z + 1.7, 0.1, 1.25, 0.1);
  // benches and lamp posts on the forecourt
  for (let i = -2; i <= 2; i++) {
    if (i === 0) continue;
    b.block(PAL.dark, i * 1.5, 0, z + 2.4, 0.06, 1.2, 0.06);
    b.block(PAL.yellow, i * 1.5, 1.2, z + 2.4, 0.16, 0.1, 0.16);
    b.block(PAL.wall2, i * 1.5 + 0.6, 0, z + 2.4, 0.7, 0.18, 0.22);
  }
  return b;
}

// ---------------------------------------------------------------- trains

const W = CAR.width;
const H = CAR.height;
const FLOOR = 0.24; // underframe height above rail
const AC_TYPES = new Set(['vande', 'rajdhani', 'shatabdi']);

function bogie(b: B, z: number, axles: number) {
  b.block(PAL.dark, 0, 0.02, z, W * 0.78, 0.16, 0.18 + axles * 0.14);
  for (let i = 0; i < axles; i++) {
    const az = z + (i - (axles - 1) / 2) * 0.17;
    b.put(PRIM.cyl, '#3b4058', 0, 0.09, az, 0.16, W * 0.86, 0.16, 0, 0, Math.PI / 2);
  }
}

/** Coach body with a chamfered roof: profile extruded along z. */
function bodyShell(b: B, color: string, len: number, h: number) {
  const ch = 0.09;
  b.block(color, 0, FLOOR, 0, W, h - ch, len);
  b.block(color, 0, FLOOR + h - ch, 0, W - ch * 2, ch, len);
  b.put(PRIM.prism, color, W / 2 - ch, FLOOR + h - ch / 2, 0, ch * 2, ch, len, 0, 0, 0);
  b.put(PRIM.prism, color, -W / 2 + ch, FLOOR + h - ch / 2, 0, ch * 2, ch, len, 0, 0, 0);
}

function coachGeo(t: TrainType): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const L = CAR.coachLen;
  const h = H;
  const body = PAL.wall;
  b.block(PAL.dark, 0, 0.14, 0, W * 0.86, 0.1, L * 0.92);
  bogie(b, L / 2 - 0.2, 2);
  bogie(b, -L / 2 + 0.2, 2);
  bodyShell(b, body, L, h);
  // window band with pillars
  const wy = FLOOR + h * 0.58;
  b.box(PAL.win, 0, wy, 0, W + 0.02, h * 0.24, L * 0.74);
  const n = 5;
  for (let i = 0; i <= n; i++) b.box(body, 0, wy, -L * 0.37 + (L * 0.74 * i) / n, W + 0.03, h * 0.24, 0.035);
  // livery stripe
  b.box(t.accent, 0, FLOOR + h * 0.3, 0, W + 0.025, h * 0.1, L * 0.98);
  // doors
  for (const sz of [-1, 1]) b.box(t.accent, 0, FLOOR + h * 0.42, sz * (L / 2 - 0.09), W + 0.03, h * 0.66, 0.1);
  // gangways
  for (const sz of [-1, 1]) b.block(PAL.dark, 0, FLOOR + 0.04, sz * (L / 2 + CAR.gap / 4), W * 0.56, h * 0.82, CAR.gap / 2 + 0.02);
  // roof equipment
  if (AC_TYPES.has(t.id)) {
    for (const sz of [-1, 1]) b.block(PAL.steel, 0, FLOOR + h, sz * L * 0.3, W * 0.5, 0.06, 0.24);
  } else {
    for (let i = -1; i <= 1; i++) b.put(PRIM.cyl, PAL.steel, 0, FLOOR + h + 0.02, i * L * 0.3, 0.12, 0.06, 0.12);
  }
  return b.build();
}

/** Electric locomotive (WAP-7 style): flat cab at +z. */
function locoGeo(t: TrainType): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const L = CAR.powerLen;
  const h = H;
  b.block(PAL.dark, 0, 0.14, 0, W * 0.86, 0.1, L * 0.94);
  bogie(b, L / 2 - 0.3, 3);
  bogie(b, -L / 2 + 0.3, 3);
  bodyShell(b, t.accent, L, h);
  b.box('#ffffff', 0, FLOOR + h * 0.36, 0, W + 0.025, h * 0.12, L * 0.98);
  b.box(PAL.yellow, 0, FLOOR + h * 0.24, 0, W + 0.025, h * 0.05, L * 0.98);
  // side grilles
  for (let i = 0; i < 4; i++) b.box(PAL.dark, 0, FLOOR + h * 0.66, -L * 0.25 + i * 0.16, W + 0.02, h * 0.2, 0.1);
  // cab windscreen + headlights
  for (const sx of [-1, 1]) b.box(PAL.win, sx * W * 0.22, FLOOR + h * 0.7, L / 2 + 0.01, W * 0.36, h * 0.22, 0.03);
  b.box(PAL.yellow, 0, FLOOR + h * 0.92, L / 2 + 0.01, 0.12, 0.06, 0.03);
  for (const sx of [-1, 1]) b.box('#fff6c8', sx * W * 0.32, FLOOR + h * 0.15, L / 2 + 0.01, 0.08, 0.06, 0.03);
  b.box(PAL.dark, 0, FLOOR + 0.03, L / 2 + 0.03, W * 0.9, 0.08, 0.06); // buffer beam
  // pantograph
  const ry = FLOOR + h;
  b.block(PAL.steel, 0, ry, -L * 0.18, W * 0.5, 0.05, 0.3);
  b.box(PAL.dark, 0, ry + 0.17, -L * 0.24, 0.03, 0.03, 0.34, 0, 0.9);
  b.box(PAL.dark, 0, ry + 0.17, -L * 0.12, 0.03, 0.03, 0.34, 0, -0.9);
  b.box(PAL.dark, 0, ry + 0.3, -L * 0.18, W * 0.62, 0.03, 0.05);
  b.block(PAL.steel, 0, ry, L * 0.2, W * 0.4, 0.08, 0.3);
  return b.build();
}

/** Streamlined EMU driving car (Vande Bharat / MEMU): nose at +z. */
function aeroGeo(t: TrainType): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const L = CAR.powerLen;
  const h = H;
  const noseStart = L * 0.08;
  b.block(PAL.dark, 0, 0.14, 0, W * 0.86, 0.1, L * 0.9);
  bogie(b, L / 2 - 0.35, 2);
  bogie(b, -L / 2 + 0.25, 2);
  // body behind the nose
  const bodyLen = noseStart + L / 2;
  b.block(PAL.wall, 0, FLOOR, -L / 2 + bodyLen / 2, W, h - 0.09, bodyLen);
  b.block(PAL.wall, 0, FLOOR + h - 0.09, -L / 2 + bodyLen / 2, W - 0.18, 0.09, bodyLen);
  // nose: a stack of tapering slices
  const slices = 6;
  const noseLen = L / 2 - noseStart;
  for (let i = 0; i < slices; i++) {
    const f = i / slices;
    const z0 = noseStart + noseLen * f;
    const sh = (h - 0.09) * (1 - 0.72 * Math.pow(f + 1 / slices, 1.4));
    const sw = W * (1 - 0.12 * f);
    b.block(PAL.wall, 0, FLOOR, z0 + noseLen / slices / 2, sw, Math.max(0.14, sh), noseLen / slices + 0.002);
  }
  // sloped windscreen
  const ang = Math.atan2(h * 0.55, noseLen * 0.8);
  b.box(PAL.win, 0, FLOOR + h * 0.62, noseStart + noseLen * 0.38, W * 0.82, 0.03, noseLen * 0.62, 0, ang);
  // livery
  b.box(t.accent, 0, FLOOR + 0.08, L * 0.02, W + 0.025, 0.14, L * 1.0);
  b.box(t.accent, 0, FLOOR + h * 0.42, -L * 0.12, W + 0.025, h * 0.08, L * 0.76);
  b.box(PAL.win, 0, FLOOR + h * 0.62, -L * 0.2, W + 0.02, h * 0.22, L * 0.5);
  for (const sx of [-1, 1]) b.box('#fff6c8', sx * W * 0.3, FLOOR + 0.2, L / 2 - 0.02, 0.1, 0.05, 0.05);
  b.box(t.accent, 0, FLOOR - 0.02, L / 2 - 0.05, W * 0.9, 0.12, 0.12);
  // roof pod
  b.block(PAL.steel, 0, FLOOR + h, -L * 0.2, W * 0.5, 0.06, 0.4);
  b.block(PAL.dark, 0, FLOOR + 0.04, -L / 2 - CAR.gap / 4, W * 0.56, h * 0.82, CAR.gap / 2 + 0.02);
  return b.build();
}

/** Freight wagon: an open BOXN for bulk, or a low well wagon for double-stack containers. */
function wagonGeo(t: TrainType): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const L = CAR.wagonLen;
  b.block(PAL.dark, 0, 0.12, 0, W * 0.8, 0.08, L * 0.94);
  bogie(b, L / 2 - 0.12, 1);
  bogie(b, -L / 2 + 0.12, 1);
  if (t.id === 'doublestack') {
    b.block('#4a4f66', 0, 0.16, 0, W * 0.9, 0.06, L * 0.98);
    for (const sz of [-1, 1]) b.block('#4a4f66', 0, 0.16, sz * (L / 2 - 0.03), W * 0.9, 0.16, 0.05);
  } else {
    const rust = '#8c5a3c';
    const h = 0.36;
    b.block(rust, 0, 0.16, 0, W * 0.92, 0.04, L * 0.96);
    for (const sx of [-1, 1]) b.block(rust, sx * (W * 0.46 - 0.02), 0.2, 0, 0.04, h, L * 0.96);
    for (const sz of [-1, 1]) b.block(rust, 0, 0.2, sz * (L * 0.48 - 0.02), W * 0.92, h, 0.04);
    // side stanchions
    for (const sx of [-1, 1]) for (const f of [-0.3, 0, 0.3]) b.block('#6e4630', sx * W * 0.47, 0.2, f * L, 0.03, h, 0.04);
  }
  return b.build();
}

/** What a loaded wagon shows: a heap of bulk, or two stacked containers (three colour schemes). */
export function wagonLoadGeometry(t: TrainType, variant: number): THREE.BufferGeometry {
  const key = `${t.id}|load|${variant % 3}`;
  let g = carCache.get(key);
  if (g) return g;
  const b = new GeoBuilder();
  const L = CAR.wagonLen;
  if (t.id === 'doublestack') {
    const schemes = [['#d0423f', '#3d63d6'], ['#2c3966', '#f2c12e'], ['#e7eaf2', '#2b8f6e']];
    const [lo, hi] = schemes[variant % 3];
    b.block(lo, 0, 0.22, 0, W * 0.86, 0.3, L * 0.92);
    b.block(hi, 0, 0.53, 0, W * 0.86, 0.3, L * 0.92);
  } else {
    b.block('#2b2d38', 0, 0.2, 0, W * 0.84, 0.34, L * 0.88);
    b.put(PRIM.pyramid, '#34374a', 0, 0.6, 0, W * 0.82, 0.14, L * 0.86);
  }
  g = b.build();
  carCache.set(key, g);
  return g;
}

const carCache = new Map<string, THREE.BufferGeometry>();

export function carGeometry(t: TrainType, power: boolean): THREE.BufferGeometry {
  const key = `${t.id}|${power}`;
  let g = carCache.get(key);
  if (!g) {
    g = power ? (t.nose === 'aero' ? aeroGeo(t) : locoGeo(t)) : t.cargo ? wagonGeo(t) : coachGeo(t);
    carCache.set(key, g);
  }
  return g;
}
