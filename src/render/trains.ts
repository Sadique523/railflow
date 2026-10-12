import * as THREE from 'three';
import { CAR } from '../data/trainTypes';
import { COLORS } from './palette';
import { VCOL } from './batch';
import { carGeometry, wagonLoadGeometry } from './models';
import type { Game } from '../sim/game';
import type { Train } from '../sim/train';

interface CarView {
  obj: THREE.Group;
  center: number;
  len: number;
  /** Freight wagons: the visible load, shown when the wagon is full. */
  load?: THREE.Mesh;
}

interface TrainViewEntry {
  train: Train;
  root: THREE.Group;
  cars: CarView[];
}

export class TrainView {
  group = new THREE.Group();
  private views = new Map<string, TrainViewEntry>();
  private ring: THREE.Mesh;
  private p = { x: 0, z: 0, ang: 0 };
  private q = { x: 0, z: 0, ang: 0 };

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(1.5, 1.75, 48),
      new THREE.MeshBasicMaterial({ color: COLORS.yellow, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    scene.add(this.ring);
  }

  sync(game: Game) {
    for (const [id, v] of this.views) {
      if (!game.trains.has(id)) {
        this.group.remove(v.root);
        this.views.delete(id);
      }
    }
    for (const t of game.trains.values()) {
      if (this.views.has(t.cfg.id)) continue;
      const root = new THREE.Group();
      const cars: CarView[] = t.carOffsets().map((c, i, all) => {
        const obj = new THREE.Group();
        const mesh = new THREE.Mesh(carGeometry(t.type, c.power), VCOL);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.position.y = CAR.railTop;
        // rear power car faces backwards
        if (c.power && i === all.length - 1) mesh.rotation.y = Math.PI;
        obj.add(mesh);
        root.add(obj);
        let load: THREE.Mesh | undefined;
        if (t.freight && !c.power) {
          load = new THREE.Mesh(wagonLoadGeometry(t.type, i), VCOL);
          load.position.y = CAR.railTop;
          load.castShadow = true;
          load.visible = false;
          obj.add(load);
        }
        return { obj, center: c.center, len: c.len, load };
      });
      this.group.add(root);
      this.views.set(t.cfg.id, { train: t, root, cars });
    }
  }

  update(game: Game, selected: string | null, time: number) {
    for (const v of this.views.values()) {
      const t = v.train;
      // fill wagons from the front in proportion to the tonnage aboard
      let full = t.freight ? Math.round((t.load / t.capacity) * t.cfg.coaches) : 0;
      for (const c of v.cars) {
        if (c.load) c.load.visible = full-- > 0;
        t.sample(t.pos - c.center + c.len / 2, game.net, this.p);
        t.sample(t.pos - c.center - c.len / 2, game.net, this.q);
        c.obj.position.set((this.p.x + this.q.x) / 2, 0, (this.p.z + this.q.z) / 2);
        c.obj.rotation.y = Math.atan2(this.p.x - this.q.x, this.p.z - this.q.z);
      }
    }
    const sel = selected ? this.views.get(selected) : undefined;
    this.ring.visible = !!sel;
    if (sel) {
      const head = sel.cars[0].obj.position;
      this.ring.position.set(head.x, 0.4, head.z);
      const s = 1 + Math.sin(time * 4) * 0.06;
      this.ring.scale.set(s, s, 1);
    }
  }

  trainAt(x: number, z: number): string | null {
    let best: string | null = null;
    let bd = 1.2;
    for (const v of this.views.values()) {
      for (const c of v.cars) {
        const d = Math.hypot(c.obj.position.x - x, c.obj.position.z - z);
        if (d < bd) { bd = d; best = v.train.cfg.id; }
      }
    }
    return best;
  }

  headPosition(id: string): THREE.Vector3 | null {
    return this.views.get(id)?.cars[0].obj.position ?? null;
  }
}
