import * as THREE from 'three';
import { CORE, COUNTRIES, INDIA, RIVERS, Rect, WORLD, XZ, project } from '../data/geo';
import { CITIES, plazaSize } from '../data/cities';
import { COLORS, mat } from './palette';

const SEA_Y = -2.2;
const LAND_DEPTH = 3;

const INK = {
  india: '#eceef3',
  foreign: '#b6bed2',
  foreignBorder: 'rgba(120,130,165,0.55)',
  indiaEdge: '#7a85a8',
  river: '#93a8e6',
  urban: 'rgba(120,132,170,',
  sea: `#${COLORS.sea.toString(16).padStart(6, '0')}`,
  shelf: '#2c4084',
  label: 'rgba(52,64,104,0.42)',
  seaLabel: 'rgba(205,215,245,0.30)',
  graticule: 'rgba(200,212,250,0.07)',
};

/** Shared uniforms; `uGrid` fades the tile grid in as the camera comes close. */
export interface TerrainUniforms {
  uGrid: { value: number };
}

/**
 * Each surface is painted twice: a sharp canvas over the play area and a coarse one over
 * the whole world. Beyond the world the plain base colour carries on to the horizon.
 */
interface Paint {
  core: THREE.Texture;
  world: THREE.Texture;
  base: string;
}

/** Build the endless sea and the land plates into `group`. */
export function buildTerrain(group: THREE.Group): TerrainUniforms {
  const uniforms: TerrainUniforms = { uGrid: { value: 0 } };

  const seaGeo = new THREE.PlaneGeometry(60000, 60000);
  seaGeo.rotateX(-Math.PI / 2);
  seaGeo.translate(0, SEA_Y, 0);
  const sea = new THREE.Mesh(seaGeo, paintedMaterial({
    core: paintSea(CORE, 2048), world: paintSea(WORLD, 2048), base: INK.sea,
  }, null));
  sea.receiveShadow = true;
  group.add(sea);

  // land plates, one shape per ring; borders between countries are only paint
  const shapes = COUNTRIES.flatMap((c) => c.rings.map(shapeOf));
  const land = new THREE.ExtrudeGeometry(shapes, { depth: LAND_DEPTH, bevelEnabled: false, curveSegments: 1 });
  land.rotateX(-Math.PI / 2);
  land.translate(0, -LAND_DEPTH, 0);
  const plate = new THREE.Mesh(land, [paintedMaterial({
    core: paintLand(CORE, 4096), world: paintLand(WORLD, 2048), base: INK.foreign,
  }, uniforms), mat(0xc2c8d8)]);
  plate.receiveShadow = true;
  plate.castShadow = true;
  group.add(plate);

  return uniforms;
}

function shapeOf(ring: XZ[]): THREE.Shape {
  return new THREE.Shape(ring.map((p) => new THREE.Vector2(p.x, -p.z)));
}

const f = (v: number) => v.toFixed(4);

/** GLSL: uv of a world x/z inside a rect, and how far inside it is (0 at the edge, 1 well inside). */
function rectUv(name: string, r: Rect): string {
  const w = r.maxX - r.minX;
  const hgt = r.maxZ - r.minZ;
  return `vec2 ${name}Uv = vec2((vBoardXZ.x - ${f(r.minX)}) / ${f(w)}, 1.0 - (vBoardXZ.y - ${f(r.minZ)}) / ${f(hgt)});
        vec2 ${name}E = min(${name}Uv, 1.0 - ${name}Uv);
        float ${name}In = smoothstep(0.0, 0.03, min(${name}E.x, ${name}E.y));`;
}

/** Lambert material coloured from the painted canvases, plus an optional tile grid. */
function paintedMaterial(paint: Paint, grid: TerrainUniforms | null): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uCore = { value: paint.core };
    shader.uniforms.uWorld = { value: paint.world };
    shader.uniforms.uBase = { value: new THREE.Color(paint.base) };
    shader.uniforms.uGrid = grid ? grid.uGrid : { value: 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBoardXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBoardXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBoardXZ;\nuniform sampler2D uCore;\nuniform sampler2D uWorld;\nuniform vec3 uBase;\nuniform float uGrid;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        ${rectUv('core', CORE)}
        ${rectUv('world', WORLD)}
        vec3 painted = mix(texture2D(uWorld, worldUv).rgb, texture2D(uCore, coreUv).rgb, coreIn);
        diffuseColor.rgb *= mix(uBase, painted, worldIn);
        if (uGrid > 0.0) {
          vec2 g = vBoardXZ / 5.0;
          vec2 d = abs(fract(g - 0.5) - 0.5) / fwidth(g);
          float minor = 1.0 - min(min(d.x, d.y), 1.0);
          vec2 g2 = vBoardXZ / 10.0;
          vec2 d2 = abs(fract(g2 - 0.5) - 0.5) / fwidth(g2);
          float major = 1.0 - min(min(d2.x, d2.y), 1.0);
          diffuseColor.rgb *= 1.0 - uGrid * max(major * 0.16, minor * 0.07);
        }`,
      );
  };
  return m;
}

/** A canvas over `r`, `px` pixels wide, set up to draw in world units. */
function canvas(r: Rect, px: number) {
  const w = r.maxX - r.minX;
  const hgt = r.maxZ - r.minZ;
  const scale = px / w;
  const c = document.createElement('canvas');
  c.width = px;
  c.height = Math.round(hgt * scale);
  const g = c.getContext('2d')!;
  g.scale(scale, scale);
  g.translate(-r.minX, -r.minZ);
  return { c, g, scale, fill: (color: string) => { g.fillStyle = color; g.fillRect(r.minX, r.minZ, w, hgt); } };
}

function texture(c: HTMLCanvasElement): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function path(g: CanvasRenderingContext2D, rings: XZ[][]) {
  g.beginPath();
  for (const r of rings) {
    g.moveTo(r[0].x, r[0].z);
    for (let i = 1; i < r.length; i++) g.lineTo(r[i].x, r[i].z);
    g.closePath();
  }
}

function polyline(g: CanvasRenderingContext2D, pts: XZ[]) {
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].z);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].z);
}

/** Widely spaced capitals, drawn letter by letter so it works without canvas letterSpacing. */
function spacedText(g: CanvasRenderingContext2D, text: string, x: number, z: number, size: number, spacing: number, color: string) {
  g.save();
  g.font = `600 ${size}px "Chakra Petch", sans-serif`;
  g.fillStyle = color;
  g.textBaseline = 'middle';
  const widths = [...text].map((ch) => g.measureText(ch).width);
  const total = widths.reduce((s, w) => s + w, 0) + spacing * (text.length - 1);
  let cx = x - total / 2;
  [...text].forEach((ch, i) => {
    g.fillText(ch, cx, z);
    cx += widths[i] + spacing;
  });
  g.restore();
}

function label(g: CanvasRenderingContext2D, text: string, lat: number, lon: number, size: number, color: string) {
  const p = project(lat, lon);
  spacedText(g, text, p.x, p.z, size, size * 0.45, color);
}

function paintLand(r: Rect, px: number): THREE.Texture {
  const { c, g, scale, fill } = canvas(r, px);
  g.lineJoin = g.lineCap = 'round';

  // neighbours: a muted plate with thin borders (at least a pixel wide on the coarse canvas)
  fill(INK.foreign);
  g.strokeStyle = INK.foreignBorder;
  g.lineWidth = Math.max(0.45, 1 / scale);
  for (const ctry of COUNTRIES.slice(1)) {
    path(g, ctry.rings);
    g.stroke();
  }

  // India
  path(g, INDIA.rings);
  g.fillStyle = INK.india;
  g.fill();

  // towns sit in a faint urban patch
  for (const city of CITIES) {
    const r = plazaSize(city) * 0.5 + 10 + Math.sqrt(city.pop) * 5;
    const grad = g.createRadialGradient(city.x, city.z, 0, city.x, city.z, r);
    grad.addColorStop(0, `${INK.urban}0.16)`);
    grad.addColorStop(0.6, `${INK.urban}0.08)`);
    grad.addColorStop(1, `${INK.urban}0)`);
    g.fillStyle = grad;
    g.fillRect(city.x - r, city.z - r, r * 2, r * 2);
  }

  // rivers: wider for the big ones
  g.strokeStyle = INK.river;
  for (const r of RIVERS) {
    g.lineWidth = r.rank <= 3 ? 0.8 : r.rank <= 5 ? 0.6 : 0.5;
    polyline(g, r.line);
    g.stroke();
  }

  // a soft inner shade and a crisp line along India's edge
  g.save();
  path(g, INDIA.rings);
  g.clip();
  g.strokeStyle = 'rgba(70,84,135,0.10)';
  g.lineWidth = 7;
  g.stroke();
  g.strokeStyle = 'rgba(70,84,135,0.10)';
  g.lineWidth = 3;
  g.stroke();
  g.restore();
  path(g, INDIA.rings);
  g.strokeStyle = INK.indiaEdge;
  g.lineWidth = 0.5;
  g.stroke();

  // neighbour names
  const L = INK.label;
  label(g, 'PAKISTAN', 28.6, 67.6, 11, L);
  label(g, 'AFGHANISTAN', 34.0, 65.2, 9, L);
  label(g, 'CHINA', 35.0, 87.5, 14, L);
  label(g, 'NEPAL', 28.35, 83.6, 6, L);
  label(g, 'BHUTAN', 27.45, 90.45, 3.4, L);
  label(g, 'BANGLADESH', 23.6, 90.25, 5, L);
  label(g, 'MYANMAR', 21.5, 95.6, 9, L);
  label(g, 'SRI LANKA', 7.75, 80.7, 3.6, L);

  return texture(c);
}

function paintSea(r: Rect, px: number): THREE.Texture {
  const { c, g, scale, fill } = canvas(r, px);
  fill(INK.sea);

  // faint graticule every 5°, across the whole world so both canvases agree
  g.strokeStyle = INK.graticule;
  g.lineWidth = Math.max(0.6, 1 / scale);
  g.setLineDash([3, 3]);
  for (let lat = -20; lat <= 60; lat += 5) {
    polyline(g, [project(lat, 25), project(lat, 140)]);
    g.stroke();
  }
  for (let lon = 25; lon <= 140; lon += 5) {
    polyline(g, [project(-20, lon), project(62, lon)]);
    g.stroke();
  }
  g.setLineDash([]);

  // shallow shelf: the land, filled with a soft glow (the land plates cover the fill itself)
  const all = COUNTRIES.flatMap((ctry) => ctry.rings);
  g.save();
  g.fillStyle = INK.shelf;
  g.shadowColor = INK.shelf;
  for (const units of [19, 7]) {
    g.shadowBlur = units * scale; // canvas pixels, unaffected by the transform
    path(g, all);
    g.fill();
  }
  g.restore();

  const S = INK.seaLabel;
  label(g, 'ARABIAN SEA', 15.5, 65.8, 12, S);
  label(g, 'BAY OF BENGAL', 15.0, 88.0, 12, S);
  label(g, 'INDIAN OCEAN', 6.2, 86.0, 10, S);
  label(g, 'ANDAMAN SEA', 11.2, 96.4, 6, S);

  return texture(c);
}
