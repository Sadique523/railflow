import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RESEARCH_BY_ID } from '../data/research';
import { city } from '../data/cities';
import { Game } from '../sim/game';
import { km, distance } from '../sim/network';
import { Stage } from '../render/stage';
import { World } from '../render/world';
import { TrackView } from '../render/tracks';
import { TrainView } from '../render/trains';
import { TrainBuilder } from './builder';
import { Inspector, Selection } from './inspector';
import { fmt, h, svg } from './dom';

type Tool = 'select' | 'track' | 'train';

const SPEEDS = [0, 1, 2, 4, 8];
const GAME_MIN_PER_SEC = 4; // at 1×

const ICONS = {
  select: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3l14 8-6 2-2 6z"/></svg>',
  track: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 2L5 22M16 2l3 20M6.5 7h11M6 12h12M5.3 17h13.4"/></svg>',
  train: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="3" width="14" height="14" rx="1"/><path d="M5 11h14M8 21l2-4M16 21l-2-4"/></svg>',
  traffic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20L10 4M14 4l6 16M12 6v2M12 11v2M12 16v2"/></svg>',
  research: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M7.5 15h9"/></svg>',
  money: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 4h11M7 9h11M7 4c6 0 6 9 0 9h-1l9 8"/></svg>',
};

export class App {
  game: Game;
  stage: Stage;
  world: World;
  tracks: TrackView;
  trainsView: TrainView;
  builder: TrainBuilder;
  inspector: Inspector;
  tool: Tool = 'select';
  selection: Selection | null = null;
  following: string | null = null;
  private speedIdx = 1;
  private trackFrom: string | null = null;
  private hoverCity: string | null = null;
  private pointer = new THREE.Vector2();
  private pointerPx = { x: 0, y: 0 };
  private downAt: { x: number; y: number } | null = null;
  private ray = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private seenVersion = -1;
  private builderRoute: string[] = [];
  private ui: Record<string, HTMLElement> = {};
  private feedSeen = 0;
  private lastUi = 0;
  private clock = 0;
  private guideDismissed = false;
  private congestionOn = false;
  private lastCongestion = 0;

  constructor(private root: HTMLElement) {
    let era: 'modern' | '1951' = 'modern';
    try {
      if (localStorage.getItem('railflow-era') === '1951') era = '1951';
      localStorage.removeItem('railflow-era');
    } catch { /* ignore */ }
    this.game = Game.load() ?? new Game(era);
    this.stage = new Stage(root);
    this.world = new World(this.stage.scene);
    this.tracks = new TrackView(this.stage.scene);
    this.trainsView = new TrainView(this.stage.scene);
    this.builder = new TrainBuilder({
      game: this.game,
      close: () => this.setTool('select'),
      onRoute: (_path, stops) => { this.builderRoute = stops; this.tracks.setHighlight(_path); },
      onBuilt: (id) => { this.setTool('select'); this.select({ kind: 'train', id }); },
    });
    this.inspector = new Inspector(this);
    try { this.guideDismissed = localStorage.getItem('railflow-guide') === 'done'; } catch { /* ignore */ }

    this.buildUi();
    this.bindInput();

    const start = this.game.net.edges.size ? [...this.game.net.edges.values()][0] : null;
    const focus = start ? city(start.a) : city('NDLS');
    this.stage.lookAt(focus.x, focus.z + 10, 150);

    setInterval(() => this.game.save(), 15000);
    window.addEventListener('beforeunload', () => this.game.save());

    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ---------------------------------------------------------------- UI

  private buildUi() {
    const r = this.root;
    const cell = (label: string, key: string) =>
      h('div', { class: 'cell' }, h('span', { class: 'lbl' }, label), (this.ui[key] = h('span', { class: 'val mono' })));

    r.append(h('div', { class: 'shadow' },
      h('div', { class: 'top-hud' }, cell('Day:', 'day'), cell('Time:', 'time'), cell('Score:', 'score'), cell('Rating:', 'rating'))));
    r.append((this.ui.chips = h('div', { class: 'chips' })));

    // speed controls + menu
    const speedBtns = SPEEDS.map((s, i) =>
      h('button', { class: 'sq', title: s ? `${s}× speed (${i})` : 'Pause (Space)', onclick: () => this.setSpeed(i) },
        s ? `${s}×` : '❚❚'));
    this.ui.speedBtns = h('div', { class: 'speed shadow' }, speedBtns,
      h('button', { class: 'sq', title: 'Menu', onclick: () => this.ui.menu.classList.toggle('open') }, '≡'));
    r.append(this.ui.speedBtns);
    r.append((this.ui.menu = h('div', { class: 'menu panel shadow' },
      h('button', { onclick: () => { this.ui.menu.classList.remove('open'); this.showHelp(); } }, 'How to play'),
      h('button', {
        onclick: (e: Event) => {
          this.stage.setAO(!this.stage.aoEnabled);
          (e.target as HTMLElement).textContent = `Soft shadows: ${this.stage.aoEnabled ? 'on' : 'off'}`;
        },
      }, 'Soft shadows: on'),
      h('button', { onclick: () => this.game.save() }, 'Save now'),
      h('button', { onclick: () => { this.ui.menu.classList.remove('open'); this.showNewGame(); } }, 'New game'),
    )));

    // toolbar
    const tool = (id: Tool, label: string, key: string) =>
      h('button', { class: 'tool', 'data-tool': id, title: `${label} (${key})`, onclick: () => this.setTool(this.tool === id && id !== 'select' ? 'select' : id) },
        svg(ICONS[id]), h('span', { class: 't' }, label), h('span', { class: 'key' }, key));
    r.append((this.ui.toolbar = h('div', { class: 'toolbar shadow' },
      tool('select', 'Select', 'V'), tool('track', 'Track', 'T'), tool('train', 'Train', 'N'),
      (this.ui.researchBtn = h('button', { class: 'tool', title: 'Research (R)', onclick: () => this.togglePanel('research') },
        svg(ICONS.research), h('span', { class: 't' }, 'Research'), h('span', { class: 'key' }, 'R'))),
      (this.ui.moneyBtn = h('button', { class: 'tool', title: 'Money (M)', onclick: () => this.toggleMoney() },
        svg(ICONS.money), h('span', { class: 't' }, 'Money'), h('span', { class: 'key' }, 'M'))),
      (this.ui.trafficBtn = h('button', { class: 'tool', title: 'Traffic view: how busy each line is (C)', onclick: () => this.toggleCongestion() },
        svg(ICONS.traffic), h('span', { class: 't' }, 'Traffic'), h('span', { class: 'key' }, 'C'))))));

    // bottom stats
    const segs = (cls: string, key: string) => (this.ui[key] = h('div', { class: `bar ${cls}` }, Array.from({ length: 10 }, () => h('i'))));
    r.append(h('div', { class: 'shadow' }, h('div', { class: 'stat left panel click', title: 'Open money (M)', onclick: () => this.toggleMoney() },
      h('div', { class: 'head' }, h('span', { class: 'swatch y' }), h('span', { class: 'lbl' }, 'Happiness'), (this.ui.happy = h('span', { class: 'val mono' }))),
      segs('y', 'happyBar'),
      h('div', { class: 'foot' },
        h('span', null, 'Funds:', (this.ui.funds = h('b', { class: 'mono' })), (this.ui.rate = h('em', { class: 'rate mono' }))),
        h('span', null, 'Pax:', (this.ui.pax = h('b', { class: 'mono' })))),
    )));
    r.append(h('div', { class: 'shadow' }, h('div', { class: 'stat right panel' },
      h('div', { class: 'head' }, h('span', { class: 'swatch b' }), h('span', { class: 'lbl' }, 'Punctuality'), (this.ui.punct = h('span', { class: 'val mono' }))),
      segs('b', 'punctBar'),
      h('div', { class: 'foot' },
        h('span', null, 'Trains:', (this.ui.trains = h('b', { class: 'mono' }))),
        h('span', null, 'On time:', (this.ui.ontime = h('b', { class: 'mono' })))),
    )));

    r.append((this.ui.feed = h('div', { class: 'feed' })));
    r.append(this.builder.el);
    this.builder.el.style.display = 'none';
    r.append(this.inspector.el);
    r.append((this.ui.tip = h('div', { class: 'tip' })));
    r.append((this.ui.guide = h('div', { class: 'shadow' })));

    if (!this.game.net.edges.size && !this.guideDismissed) this.showHelp();
    this.setSpeed(1);
  }

  private showHelp() {
    const bg = h('div', { class: 'modal-bg', onclick: (e: Event) => { if (e.target === bg) bg.remove(); } },
      h('div', { class: 'shadow' }, h('div', { class: 'modal panel' },
        h('div', { class: 'lbl' }, 'Indian Railways network sim'),
        h('h1', null, 'RAILFLOW'),
        h('p', null, 'Lay track between Indian cities, run trains on it and keep passengers happy. There is no finish line — build the most punctual, best-loved network you can.'),
        h('h3', null, 'Build'),
        h('ul', null,
          h('li', null, h('kbd', null, 'T'), ' Track tool: click a city, then another to lay line. Keep clicking to chain.'),
          h('li', null, h('kbd', null, 'N'), ' New train: choose a preset, coaches and stops. It shuttles end to end.'),
          h('li', null, 'Click a line to ', h('b', null, 'double'), ' or ', h('b', null, 'speed it up'), '. Works slow the line for days, so plan a way round first.'),
          h('li', null, 'Run ', h('b', null, 'goods trains'), ' from coal fields, steel plants, grain belts and ports. Freight pays the bills but clogs shared lines; ', h('kbd', null, 'C'), ' shows traffic.'),
          h('li', null, h('kbd', null, 'R'), ' Research: you start with MEMU and Express. LHB coaches, faster track, Kavach, Vande Bharat and bullet trains come later.')),
        h('h3', null, 'Score'),
        h('ul', null,
          h('li', null, h('b', null, 'Passengers'), ' — most travel general class and only take cheap trains; a smaller AC and premium crowd pays more and wants speed. Run a mix.'),
          h('li', null, h('b', null, 'Happiness'), ' — short waits, punctual trains, comfort and seats for everyone.'),
          h('li', null, h('b', null, 'Punctuality'), ' — arrivals within 5 minutes of the timetable.'),
          h('li', null, 'Points come from every passenger delivered: longer trips and happier riders score more. Fares pay for running costs.'),
          h('li', null, 'Passengers give up after 6 hours waiting. Fog, monsoon, signal failures and festival rushes will test you.')),
        h('h3', null, 'Camera'),
        h('p', null, 'Drag to pan · right-drag to rotate · scroll to zoom · ', h('kbd', null, 'WASD'), ' pan · ', h('kbd', null, 'Q'), h('kbd', null, 'E'), ' rotate · ', h('kbd', null, 'Space'), ' pause · ', h('kbd', null, '1–4'), ' speed'),
        h('button', { class: 'cta y', onclick: () => bg.remove() }, this.game.net.edges.size ? 'Back to the network' : 'Start building'),
      )));
    this.root.append(bg);
  }

  /** Pick an era for a fresh game; the choice is handed to the reload through storage. */
  private showNewGame() {
    const start = (era: 'modern' | '1951') => {
      Game.clearSave();
      try { localStorage.setItem('railflow-era', era); } catch { /* ignore */ }
      this.game.save = () => {};
      location.reload();
    };
    const bg = h('div', { class: 'modal-bg', onclick: (e: Event) => { if (e.target === bg) bg.remove(); } },
      h('div', { class: 'shadow' }, h('div', { class: 'modal panel' },
        h('div', { class: 'lbl' }, 'New game'),
        h('h1', null, 'CHOOSE AN ERA'),
        h('p', null, 'Your current network will be lost.'),
        h('div', { class: 'eras' },
          h('button', { class: 'era', onclick: () => start('modern') },
            h('b', null, 'Today'),
            h('span', null, 'An empty map and ₹600 Cr. Lay your own broad gauge network from scratch and research your way to Vande Bharat and bullet trains.')),
          h('button', { class: 'era', onclick: () => start('1951') },
            h('b', null, '1951'),
            h('span', null, 'Inherit the railways of independent India: broad gauge trunk lines and large metre gauge systems that do not connect. ₹400 Cr. Convert gauge, close the gaps and modernise.')),
        ),
        h('button', { class: 'cta', onclick: () => bg.remove() }, 'Cancel'),
      )));
    this.root.append(bg);
  }

  private renderGuide() {
    const g = this.game;
    const steps: [string, boolean][] = [
      ['Press T and click two cities to lay your first line (try Delhi → Agra).', g.net.edges.size > 0],
      ['Press N to build a train and add its stops.', g.trains.size > 0],
      ['Deliver your first 500 passengers.', g.stats.delivered >= 500],
      ['Double a busy line or add a second train.', [...g.net.edges.values()].some((e) => e.tracks === 2) || g.trains.size > 1],
    ];
    const all = steps.every((s) => s[1]);
    if (all || this.guideDismissed) {
      if (all && !this.guideDismissed) {
        this.guideDismissed = true;
        try { localStorage.setItem('railflow-guide', 'done'); } catch { /* ignore */ }
      }
      this.ui.guide.replaceChildren();
      return;
    }
    const key = steps.map((s) => +s[1]).join('');
    if (this.ui.guide.dataset.key === key) return;
    this.ui.guide.dataset.key = key;
    this.ui.guide.replaceChildren(h('div', { class: 'guide panel' },
      h('div', { class: 'lbl' }, 'Getting started'),
      h('button', {
        class: 'x', title: 'Hide',
        onclick: () => { this.guideDismissed = true; try { localStorage.setItem('railflow-guide', 'done'); } catch { /* ignore */ } this.renderGuide(); },
      }, '×'),
      h('ol', null, steps.map(([t, done]) => h('li', { class: done ? 'done' : '' }, h('i'), t))),
    ));
  }

  setSpeed(i: number) {
    this.speedIdx = i;
    [...this.ui.speedBtns.children].forEach((b, k) => b.classList.toggle('on', k === i));
  }

  setTool(t: Tool, arg?: string) {
    this.tool = t;
    this.trackFrom = null;
    this.tracks.showGhost(null, null, true);
    this.root.className = `tool-${t}`;
    [...this.ui.toolbar.children].forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.tool === t));
    if (t === 'train') {
      this.select(null);
      this.builder.el.style.display = '';
      document.body.classList.add('panel-open');
      this.builder.open(arg);
    } else {
      this.builder.el.style.display = 'none';
      document.body.classList.remove('panel-open');
      this.builderRoute = [];
      if (this.selection?.kind !== 'train') this.tracks.setHighlight(null);
    }
    if (t === 'track') {
      this.select(null);
      if (arg) this.trackFrom = arg;
    }
  }

  select(sel: Selection | null) {
    this.selection = sel;
    if (!sel || sel.kind !== 'train') this.following = null;
    this.inspector.show(sel);
    this.ui.moneyBtn.classList.toggle('on', sel?.kind === 'finance');
    this.ui.researchBtn.classList.toggle('on', sel?.kind === 'research');
    this.world.setSelected(sel?.kind === 'city' ? sel.id : null);
    if (sel?.kind === 'train') {
      const t = this.game.trains.get(sel.id)!;
      this.tracks.setHighlight(this.game.net.routePath(t.cfg.stops));
    } else if (sel?.kind === 'track') {
      const e = this.game.net.edges.get(sel.id)!;
      this.tracks.setHighlight([e.a, e.b]);
    } else if (this.tool !== 'train') this.tracks.setHighlight(null);
  }

  toggleMoney() {
    this.togglePanel('finance');
  }

  toggleCongestion() {
    this.congestionOn = !this.congestionOn;
    this.ui.trafficBtn.classList.toggle('on', this.congestionOn);
    this.lastCongestion = -1;
    if (!this.congestionOn) this.tracks.showCongestion(null);
  }

  /** Open or close one of the full-height panels (money, research). */
  togglePanel(kind: 'finance' | 'research') {
    if (this.selection?.kind === kind) return this.select(null);
    if (this.tool !== 'select') this.setTool('select');
    this.select({ kind });
  }

  startTrack(from: string) {
    this.setTool('track', from);
  }

  newTrain(from: string) {
    this.setTool('train', from);
  }

  follow(id: string | null) {
    this.following = id;
    this.inspector.show(this.selection);
  }

  // ---------------------------------------------------------------- input

  private bindInput() {
    const canvas = this.stage.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.downAt = { x: e.clientX, y: e.clientY };
      if (e.button === 2 && this.tool === 'track' && this.trackFrom) {
        this.trackFrom = null;
        this.tracks.showGhost(null, null, true);
      }
    });
    canvas.addEventListener('pointerup', (e) => {
      if (e.button !== 0 || !this.downAt) return;
      const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
      this.downAt = null;
      if (moved < 6) this.click(e);
      else this.following = null;
    });
    canvas.addEventListener('pointermove', (e) => {
      this.pointerPx = { x: e.clientX, y: e.clientY };
      this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    });
    canvas.addEventListener('pointerleave', () => { this.pointer.set(99, 99); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', () => this.ui.menu.classList.remove('open'));
    canvas.addEventListener('wheel', () => { this.following = null; }, { passive: true });

    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      const k = e.key.toLowerCase();
      if (k === ' ') { e.preventDefault(); this.setSpeed(this.speedIdx === 0 ? 1 : 0); }
      else if (k >= '1' && k <= '4') this.setSpeed(Number(k));
      else if (k === 't') this.setTool(this.tool === 'track' ? 'select' : 'track');
      else if (k === 'n') this.setTool(this.tool === 'train' ? 'select' : 'train');
      else if (k === 'v') this.setTool('select');
      else if (k === 'm') this.toggleMoney();
      else if (k === 'r') this.togglePanel('research');
      else if (k === 'c') this.toggleCongestion();
      else if (k === 'escape') {
        if (this.tool === 'track' && this.trackFrom) { this.trackFrom = null; this.tracks.showGhost(null, null, true); }
        else if (this.tool !== 'select') this.setTool('select');
        else this.select(null);
      }
    });
  }

  private groundPoint(): THREE.Vector3 | null {
    if (Math.abs(this.pointer.x) > 1) return null;
    this.ray.setFromCamera(this.pointer, this.stage.camera);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.ground, p);
  }

  private click(e: PointerEvent) {
    this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    const p = this.groundPoint();
    if (!p) return;
    const cityId = this.world.cityAt(p.x, p.z);
    const g = this.game;

    if (this.tool === 'track') {
      if (!cityId) { this.trackFrom = null; return; }
      if (!this.trackFrom) { this.trackFrom = cityId; return; }
      if (cityId === this.trackFrom) { this.trackFrom = null; return; }
      const chk = g.canBuildTrack(this.trackFrom, cityId);
      if (chk.ok && g.buildTrack(this.trackFrom, cityId)) this.trackFrom = cityId;
      return;
    }
    if (this.tool === 'train') {
      if (cityId) this.builder.addStop(cityId);
      return;
    }
    const trainId = this.trainsView.trainAt(p.x, p.z);
    if (trainId) return this.select({ kind: 'train', id: trainId });
    if (cityId) return this.select({ kind: 'city', id: cityId });
    const edge = this.tracks.edgeAt(g, p.x, p.z);
    if (edge) return this.select({ kind: 'track', id: edge });
    this.select(null);
  }

  // ---------------------------------------------------------------- frame

  private frame(dt: number) {
    this.clock += dt;
    const g = this.game;
    const speed = SPEEDS[this.speedIdx];
    if (speed) g.update(dt * speed * GAME_MIN_PER_SEC);
    for (const p of g.payouts.splice(0)) this.cashPop(p.cityId, p.amount, p.freight);
    if (this.congestionOn && this.clock - this.lastCongestion > 0.25) {
      this.lastCongestion = this.clock;
      this.tracks.showCongestion(g, THREE.MathUtils.clamp(this.stage.distance / 90, 1.2, 9));
    }

    if (g.version !== this.seenVersion) {
      this.seenVersion = g.version;
      this.tracks.sync(g);
      this.trainsView.sync(g);
      this.world.clearCorridors(g);
      if (this.selection?.kind === 'train' && g.trains.has(this.selection.id)) this.select(this.selection);
    }

    // follow camera
    if (this.following) {
      const p = this.trainsView.headPosition(this.following);
      if (p) {
        const t = this.stage.controls.target;
        const dx = (p.x - t.x) * Math.min(1, dt * 4);
        const dz = (p.z - t.z) * Math.min(1, dt * 4);
        t.x += dx; t.z += dz;
        this.stage.camera.position.x += dx;
        this.stage.camera.position.z += dz;
      }
    }

    this.stage.update(dt);
    this.updateHover();

    const highlight = new Set<string>(this.builderRoute);
    if (this.trackFrom) highlight.add(this.trackFrom);
    if (this.hoverCity) highlight.add(this.hoverCity);
    if (this.selection?.kind === 'city') highlight.add(this.selection.id);
    this.world.update(g, this.stage.distance, highlight);
    this.trainsView.update(g, this.selection?.kind === 'train' ? this.selection.id : null, this.clock);
    this.stage.render();

    if (this.clock - this.lastUi > 0.2) {
      this.lastUi = this.clock;
      this.updateHud();
    }
  }

  /** Floating "+₹" over a station where a train just collected fares. */
  private cashPop(cityId: string, amount: number, freight = false) {
    if (amount < 0.005) return;
    const c = city(cityId);
    const el = h('div', { class: `cash-pop${freight ? ' freight' : ''}` }, h('span', null, fmt.money(amount, true)));
    const obj = new CSS2DObject(el);
    obj.position.set(c.x, 4, c.z);
    obj.center.set(0.5, 1);
    this.stage.scene.add(obj);
    setTimeout(() => {
      this.stage.scene.remove(obj);
      el.remove();
    }, 2200);
  }

  private updateHover() {
    const p = this.groundPoint();
    const tip = this.ui.tip;
    const cityId = p ? this.world.cityAt(p.x, p.z) : null;
    this.hoverCity = cityId;
    this.world.setHover(this.tool !== 'select' || cityId ? cityId : null);
    tip.classList.remove('show');

    if (this.tool === 'track' && p) {
      if (this.trackFrom) {
        const to = cityId && cityId !== this.trackFrom ? city(cityId) : p;
        if (cityId && cityId !== this.trackFrom) {
          const chk = this.game.canBuildTrack(this.trackFrom, cityId);
          this.tracks.showGhost(this.trackFrom, to, chk.ok);
          tip.innerHTML = '';
          const t = chk.terrain;
          const hard = t.label ? `${t.label}${t.kmhCap ? `, max ${t.kmhCap} km/h` : ''}` : '';
          const bridges = t.bridges.length ? `${t.bridges.length} river bridge${t.bridges.length > 1 ? 's' : ''} (${t.bridges.join(', ')})` : '';
          tip.append(
            `${city(this.trackFrom).name} → ${city(cityId).name} · ${Math.round(km(distance(this.trackFrom, cityId)))} km · ${fmt.cr(chk.cost)} · ${fmt.dur(chk.hours * 60)} to build`,
            hard || bridges ? h('div', { class: 'terrain' }, [hard, bridges].filter(Boolean).join(' · ')) : '',
            chk.ok ? '' : h('div', { class: 'bad' }, chk.reason!),
          );
        } else {
          this.tracks.showGhost(this.trackFrom, to, true);
          tip.textContent = `From ${city(this.trackFrom).name} — click a city`;
        }
      } else {
        this.tracks.showGhost(null, null, true);
        tip.textContent = cityId ? `Start line at ${city(cityId).name}` : 'Click a city to start a line';
      }
      tip.classList.add('show');
    } else if (this.tool === 'train' && cityId) {
      tip.textContent = this.game.net.isConnected(cityId) ? `Add ${city(cityId).name} as a stop` : `${city(cityId).name} has no track`;
      tip.classList.add('show');
    }
    tip.style.left = `${this.pointerPx.x}px`;
    tip.style.top = `${this.pointerPx.y}px`;
  }

  private updateHud() {
    const g = this.game;
    const u = this.ui;
    u.day.textContent = String(fmt.day(g.time));
    u.time.textContent = fmt.clock(g.time);
    u.score.textContent = fmt.int(g.score);
    u.rating.textContent = g.rating;
    const hap = g.happiness;
    const pun = g.punctuality;
    u.happy.textContent = String(Math.round(hap));
    u.punct.textContent = String(Math.round(pun));
    [...u.happyBar.children].forEach((c, i) => c.classList.toggle('on', i < Math.round(hap / 10)));
    [...u.punctBar.children].forEach((c, i) => c.classList.toggle('on', i < Math.round(pun / 10)));
    u.funds.textContent = fmt.cr(g.funds);
    u.funds.classList.toggle('neg', g.funds < 0);
    const rate = g.ledger.operatingRate(g.time);
    u.rate.textContent = g.trains.size ? `${rate >= 0 ? '▲' : '▼'} ${fmt.money(rate, true).replace(' Cr', '')}/h` : '';
    u.rate.className = `rate mono ${rate >= 0 ? 'pos' : 'neg'}`;
    u.pax.textContent = fmt.int(g.stats.delivered);
    u.trains.textContent = String(g.trains.size);
    u.ontime.textContent = `${fmt.int(g.stats.onTimeArrivals)}/${fmt.int(g.stats.arrivals)}`;

    // event chips, plus research and works in progress
    const ra = g.research.active;
    const works = [...g.net.edges.values()].filter((e) => e.works).length;
    const rPct = ra ? Math.floor(((g.time - ra.start) / (ra.end - ra.start)) * 20) * 5 : 0;
    const chipKey = g.events.map((e) => e.title + e.endsAt).join('|') + `|${ra?.id}:${rPct}|${works}`;
    if (u.chips.dataset.key !== chipKey) {
      u.chips.dataset.key = chipKey;
      const chips = g.events.map((e) => h('div', { class: 'chip shadow', title: e.detail }, h('i'), e.title));
      if (ra) chips.push(h('div', { class: 'chip info shadow', title: 'Open research (R)', onclick: () => this.togglePanel('research') }, h('i'), `${RESEARCH_BY_ID.get(ra.id)!.name} · ${rPct}%`));
      if (works) chips.push(h('div', { class: 'chip works shadow' }, h('i'), `${works} line${works > 1 ? 's' : ''} under works`));
      u.chips.replaceChildren(...chips);
    }

    // feed
    for (const entry of g.log) {
      if (entry.id <= this.feedSeen) continue;
      this.feedSeen = entry.id;
      const item = h('div', { class: `item ${entry.tone}` }, h('span', { class: 't' }, fmt.clock(entry.time)), entry.text);
      u.feed.prepend(item);
      setTimeout(() => item.classList.add('fade'), 9000);
      setTimeout(() => item.remove(), 9700);
      while (u.feed.children.length > 5) u.feed.lastChild!.remove();
    }

    this.inspector.refresh();
    this.renderGuide();
  }
}
