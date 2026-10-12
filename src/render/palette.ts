import * as THREE from 'three';

export const COLORS = {
  sea: 0x22336f,
  land: 0xe4e6ec,
  building: 0xf3f4f7,
  plaza: 0x3d63d6,
  bed: 0x4169dc,
  rail: 0x1e2338,
  sleeper: 0x2c3f8c,
  yellow: 0xf2c12e,
  ink: 0x1d2340,
  white: 0xffffff,
  pax: 0x1b2244,
};

const cache = new Map<string, THREE.MeshLambertMaterial>();

/** Shared matte material per colour. */
export function mat(color: number | string, opts: THREE.MeshLambertMaterialParameters = {}) {
  const key = `${color}|${JSON.stringify(opts)}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, ...opts });
    cache.set(key, m);
  }
  return m;
}

export const BOX = new THREE.BoxGeometry(1, 1, 1);

/** Deterministic PRNG seeded from a string. */
export function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
