import * as THREE from 'three';

/** A flat-shaded primitive, stored as non-indexed position/normal arrays. */
export interface Prim {
  p: ArrayLike<number>;
  n: ArrayLike<number>;
}

function prim(g: THREE.BufferGeometry): Prim {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.deleteAttribute('normal');
  ng.computeVertexNormals(); // non-indexed → flat face normals
  return { p: ng.attributes.position.array, n: ng.attributes.normal.array };
}

function shapePrim(points: [number, number][]): Prim {
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  return prim(g);
}

// All primitives are unit-sized and centred on the origin.
export const PRIM = {
  box: prim(new THREE.BoxGeometry(1, 1, 1)),
  /** Gable roof: triangle across x, ridge along z. */
  prism: shapePrim([[-0.5, -0.5], [0.5, -0.5], [0, 0.5]]),
  /** Square pyramid. */
  pyramid: prim(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4)),
  cyl: prim(new THREE.CylinderGeometry(0.5, 0.5, 1, 8)),
  ico: prim(new THREE.IcosahedronGeometry(0.5, 0)),
  /** Ballast shoulder profile across x, along z. */
  trapezoid: shapePrim([[-0.5, -0.5], [0.5, -0.5], [0.36, 0.5], [-0.36, 0.5]]),
};

const tmpM = new THREE.Matrix4();
const full = new THREE.Matrix4();
const nm = new THREE.Matrix3();
const v = new THREE.Vector3();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const c = new THREE.Color();
const vp = new THREE.Vector3();
const vs = new THREE.Vector3();

/** Accumulates transformed, vertex-coloured primitives into one geometry. */
export class GeoBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  /** Applied after each part's own transform. */
  base = new THREE.Matrix4();

  add(src: Prim, m: THREE.Matrix4, color: THREE.ColorRepresentation) {
    full.multiplyMatrices(this.base, m);
    nm.getNormalMatrix(full);
    c.set(color);
    const n = src.p.length / 3;
    for (let i = 0; i < n; i++) {
      v.set(src.p[i * 3], src.p[i * 3 + 1], src.p[i * 3 + 2]).applyMatrix4(full);
      this.pos.push(v.x, v.y, v.z);
      v.set(src.n[i * 3], src.n[i * 3 + 1], src.n[i * 3 + 2]).applyMatrix3(nm).normalize();
      this.nor.push(v.x, v.y, v.z);
      this.col.push(c.r, c.g, c.b);
    }
  }

  /** Place a primitive by centre, size and rotation (radians). */
  put(
    src: Prim, color: THREE.ColorRepresentation,
    x: number, y: number, z: number, sx: number, sy: number, sz: number,
    ry = 0, rx = 0, rz = 0,
  ) {
    tmpM.compose(vp.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), vs.set(sx, sy, sz));
    this.add(src, tmpM, color);
  }

  box(color: THREE.ColorRepresentation, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0) {
    this.put(PRIM.box, color, x, y, z, sx, sy, sz, ry, rx, rz);
  }

  /** Box resting on y0 (bottom face at y0). */
  block(color: THREE.ColorRepresentation, x: number, y0: number, z: number, sx: number, sy: number, sz: number, ry = 0) {
    this.put(PRIM.box, color, x, y0 + sy / 2, z, sx, sy, sz, ry);
  }

  get empty() {
    return this.pos.length === 0;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Shared material for all vertex-coloured geometry. */
export const VCOL = new THREE.MeshLambertMaterial({ vertexColors: true });
