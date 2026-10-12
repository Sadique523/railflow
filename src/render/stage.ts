import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { N8AOPass } from 'n8ao';
import { COLORS } from './palette';
import { MAP_BOUNDS } from '../data/geo';

/** Renderer, camera, lights, controls and post-processing. */
export class Stage {
  renderer: THREE.WebGLRenderer;
  labels: CSS2DRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: MapControls;
  sun: THREE.DirectionalLight;
  composer: EffectComposer;
  private ao: N8AOPass;
  private renderPass: RenderPass;
  private keys = new Set<string>();
  aoEnabled = true;

  constructor(container: HTMLElement) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.setSize(w, h);
    this.labels.domElement.className = 'label-layer';
    container.appendChild(this.labels.domElement);

    // the world runs on to the horizon and fades into haze, so there is no edge to see
    this.scene.background = new THREE.Color(COLORS.haze);
    this.scene.fog = new THREE.Fog(COLORS.haze, 1000, 3000);

    this.camera = new THREE.PerspectiveCamera(38, w / h, 1, 4000);
    this.camera.position.set(0, 160, 110);

    this.controls = new MapControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 18;
    this.controls.maxDistance = 1150;
    this.controls.minPolarAngle = 0.15;
    this.controls.maxPolarAngle = 1.05;
    this.controls.zoomToCursor = true;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c3e6, 1.55));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.005;
    this.sun.shadow.radius = 2;
    this.scene.add(this.sun, this.sun.target);

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.ao = new N8AOPass(this.scene, this.camera, w, h);
    this.ao.configuration.gammaCorrection = false;
    this.ao.configuration.aoRadius = 2.2;
    this.ao.configuration.distanceFalloff = 1.0;
    this.ao.configuration.intensity = 2.6;
    this.ao.configuration.color = new THREE.Color(0x1d2650);
    this.ao.setQualityMode('Medium');
    this.composer.addPass(this.ao);
    this.composer.addPass(new SMAAPass());
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  setAO(on: boolean) {
    if (on === this.aoEnabled) return;
    this.aoEnabled = on;
    this.composer.passes[0] = on ? this.ao : this.renderPass;
  }

  lookAt(x: number, z: number, distance?: number) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    if (distance) offset.setLength(distance);
    this.controls.target.set(x, 0, z);
    this.camera.position.copy(this.controls.target).add(offset);
  }

  get distance(): number {
    return this.camera.position.distanceTo(this.controls.target);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.labels.setSize(w, h);
  }

  update(realDt: number) {
    // WASD / arrow panning, Q/E rotation
    const k = this.keys;
    const speed = this.distance * 0.9 * realDt;
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const move = new THREE.Vector3();
    if (k.has('w') || k.has('arrowup')) move.add(fwd);
    if (k.has('s') || k.has('arrowdown')) move.sub(fwd);
    if (k.has('d') || k.has('arrowright')) move.add(right);
    if (k.has('a') || k.has('arrowleft')) move.sub(right);
    if (move.lengthSq()) {
      move.setLength(speed);
      this.controls.target.add(move);
      this.camera.position.add(move);
    }
    const rot = (k.has('e') ? 1 : 0) - (k.has('q') ? 1 : 0);
    if (rot) {
      const off = this.camera.position.clone().sub(this.controls.target);
      off.applyAxisAngle(new THREE.Vector3(0, 1, 0), rot * realDt * 1.4);
      this.camera.position.copy(this.controls.target).add(off);
    }
    // keep the target on the board
    const t = this.controls.target;
    const cx = THREE.MathUtils.clamp(t.x, MAP_BOUNDS.minX, MAP_BOUNDS.maxX) - t.x;
    const cz = THREE.MathUtils.clamp(t.z, MAP_BOUNDS.minZ, MAP_BOUNDS.maxZ) - t.z;
    if (cx || cz) {
      t.x += cx; t.z += cz;
      this.camera.position.x += cx; this.camera.position.z += cz;
    }
    // the further out, the less the camera may tilt, so the view stays on the map
    const far = THREE.MathUtils.smoothstep(this.distance, 350, 1000);
    this.controls.maxPolarAngle = THREE.MathUtils.lerp(1.05, 0.6, far);
    this.controls.update();

    const fog = this.scene.fog as THREE.Fog;
    fog.near = this.distance * 1.2;
    fog.far = this.distance * 2.6;
    const camFar = Math.max(4000, fog.far * 1.2);
    if (this.camera.far !== camFar) {
      this.camera.far = camFar;
      this.camera.updateProjectionMatrix();
    }

    // the sun follows the view so shadows stay crisp
    const d = this.distance;
    const size = THREE.MathUtils.clamp(d * 0.85, 30, 520);
    const sc = this.sun.shadow.camera;
    if (sc.right !== size) {
      sc.left = -size; sc.right = size; sc.top = size; sc.bottom = -size;
      sc.near = 1; sc.far = 1000;
      sc.updateProjectionMatrix();
    }
    this.sun.position.set(t.x + 130, 150, t.z - 45);
    this.sun.target.position.copy(t);
  }

  render() {
    this.composer.render();
    this.labels.render(this.scene, this.camera);
  }
}
