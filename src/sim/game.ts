import { CITIES, city } from '../data/cities';
import { TRAIN_TYPE_BY_ID, trainCost } from '../data/trainTypes';
import {
  MAX_TRACK_KM, Network, distance, doubleCost, edgeId, km, trackCost,
} from './network';
import { ON_TIME_MIN, PaxGroup, Segment, Train, TrainConfig } from './train';

export const START_FUNDS = 600;
const FARE_PER_PAX_KM = 0.00003; // ₹ Cr
const DEMAND_PER_HOUR = 3.2; // passengers/hour per sqrt(M·M) of population
const GIVE_UP_MIN = 6 * 60;
const MAX_WAITING_PER_DEST = 1500;
const HEADWAY = 2.5;
const SAVE_KEY = 'railflow-save-v1';

function fmtClock(min: number): string {
  const m = Math.floor(min) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export interface Station {
  id: string;
  waiting: PaxGroup[];
  acc: Map<string, number>;
  demandMult: number;
}

export type EventKind = 'fog' | 'monsoon' | 'signal' | 'festival';

export interface GameEvent {
  kind: EventKind;
  title: string;
  detail: string;
  endsAt: number;
  edgeId?: string;
  cityId?: string;
}

export interface LogEntry {
  id: number;
  time: number;
  text: string;
  tone: 'info' | 'good' | 'bad';
}

export interface Stats {
  delivered: number;
  gaveUp: number;
  arrivals: number;
  onTimeArrivals: number;
  revenue: number;
  costs: number;
}

export class Game {
  net = new Network();
  trains = new Map<string, Train>();
  stations = new Map<string, Station>();
  time = 6 * 60; // game minutes since Day 1 00:00
  funds = START_FUNDS;
  score = 0;
  stats: Stats = { delivered: 0, gaveUp: 0, arrivals: 0, onTimeArrivals: 0, revenue: 0, costs: 0 };
  events: GameEvent[] = [];
  log: LogEntry[] = [];
  /** Exponentially-decayed happiness accumulator. */
  private hSum = 75 * 40;
  private hW = 40;
  private recentArrivals: boolean[] = [];
  private servedPairs: [string, string][] = [];
  private nextTrainNum = 1;
  private nextEventAt = this.time + 20 * 60;
  private logId = 0;
  private lastHour = Math.floor(this.time / 60);
  private lastGiveUpScan = 0;
  /** Bumped whenever tracks or trains change, so renderers can resync. */
  version = 0;

  constructor() {
    for (const c of CITIES) {
      this.stations.set(c.id, { id: c.id, waiting: [], acc: new Map(), demandMult: 1 });
    }
  }

  // ---------------------------------------------------------------- metrics

  get happiness(): number {
    return this.hSum / this.hW;
  }

  get punctuality(): number {
    if (!this.recentArrivals.length) return 100;
    return (100 * this.recentArrivals.filter(Boolean).length) / this.recentArrivals.length;
  }

  get rating(): string {
    const r = (this.happiness + this.punctuality) / 2;
    if (r >= 92) return 'A+';
    if (r >= 85) return 'A';
    if (r >= 75) return 'B';
    if (r >= 62) return 'C';
    if (r >= 50) return 'D';
    return 'E';
  }

  waitingAt(id: string): number {
    let n = 0;
    for (const g of this.stations.get(id)!.waiting) n += g.count;
    return n;
  }

  private recordHappiness(h: number, weight: number) {
    this.hSum += h * weight;
    this.hW += weight;
  }

  private notify(text: string, tone: LogEntry['tone'] = 'info') {
    this.log.push({ id: ++this.logId, time: this.time, text, tone });
    if (this.log.length > 60) this.log.shift();
  }

  // ---------------------------------------------------------------- building

  canBuildTrack(a: string, b: string): { ok: boolean; cost: number; reason?: string } {
    const cost = trackCost(a, b);
    if (a === b) return { ok: false, cost, reason: 'Pick a different city' };
    if (this.net.edges.has(edgeId(a, b))) return { ok: false, cost, reason: 'Already connected' };
    if (km(distance(a, b)) > MAX_TRACK_KM) return { ok: false, cost, reason: `Too long (max ${MAX_TRACK_KM} km)` };
    if (cost > this.funds) return { ok: false, cost, reason: 'Not enough funds' };
    return { ok: true, cost };
  }

  buildTrack(a: string, b: string): boolean {
    const chk = this.canBuildTrack(a, b);
    if (!chk.ok) return false;
    this.funds -= chk.cost;
    this.stats.costs += chk.cost;
    this.net.addEdge(a, b);
    this.version++;
    this.notify(`Track laid: ${city(a).name} – ${city(b).name} (${Math.round(km(distance(a, b)))} km)`);
    return true;
  }

  upgradeTrack(id: string): boolean {
    const e = this.net.edges.get(id);
    if (!e || e.tracks === 2) return false;
    const cost = doubleCost(e);
    if (cost > this.funds) return false;
    this.funds -= cost;
    this.stats.costs += cost;
    e.tracks = 2;
    this.version++;
    this.notify(`Line doubled: ${city(e.a).name} – ${city(e.b).name}`, 'good');
    return true;
  }

  trainsUsingEdge(id: string): Train[] {
    const out: Train[] = [];
    for (const t of this.trains.values()) {
      const route = this.net.routePath(t.cfg.stops) ?? [];
      const uses = (p: string[]) => p.some((n, i) => i > 0 && edgeId(p[i - 1], n) === id);
      if (uses(t.path) || uses(route)) out.push(t);
    }
    return out;
  }

  removeTrack(id: string): boolean {
    const e = this.net.edges.get(id);
    if (!e || this.trainsUsingEdge(id).length) return false;
    this.net.removeEdge(id);
    this.funds += trackCost(e.a, e.b) * 0.25;
    this.version++;
    this.notify(`Track removed: ${city(e.a).name} – ${city(e.b).name}`);
    return true;
  }

  routeInfo(stops: string[]): { ok: boolean; path?: string[]; length?: number; reason?: string } {
    if (stops.length < 2) return { ok: false, reason: 'Add at least two stops' };
    for (let i = 1; i < stops.length; i++) {
      if (stops[i] === stops[i - 1]) return { ok: false, reason: 'Consecutive stops must differ' };
    }
    const path = this.net.routePath(stops);
    if (!path) return { ok: false, reason: 'Stops are not connected by track' };
    return { ok: true, path, length: this.net.pathLength(path) };
  }

  makeTrainNumber(typeId: string): string {
    const prefix = TRAIN_TYPE_BY_ID.get(typeId)!.numberPrefix;
    const n = String(this.nextTrainNum * 37 + 100 + Math.floor(Math.random() * 30)).padStart(5 - prefix.length, '0');
    return (prefix + n).slice(0, 5);
  }

  addTrain(spec: Omit<TrainConfig, 'id' | 'number'> & { number?: string }): Train | string {
    const type = TRAIN_TYPE_BY_ID.get(spec.typeId);
    if (!type) return 'Unknown train type';
    const route = this.routeInfo(spec.stops);
    if (!route.ok) return route.reason!;
    const cost = trainCost(type, spec.coaches);
    if (cost > this.funds) return 'Not enough funds';
    const cfg: TrainConfig = {
      ...spec,
      id: `T${this.nextTrainNum}`,
      number: spec.number ?? this.makeTrainNumber(spec.typeId),
    };
    this.nextTrainNum++;
    const t = new Train(cfg);
    // stagger first departure to the next quarter hour
    const dep = Math.ceil((this.time + 10) / 15) * 15;
    t.start(this.net, this.time, dep);
    this.funds -= cost;
    this.stats.costs += cost;
    this.trains.set(cfg.id, t);
    this.refreshServedPairs();
    this.version++;
    this.notify(`${cfg.number} ${cfg.name} enters service`, 'good');
    return t;
  }

  removeTrain(id: string) {
    const t = this.trains.get(id);
    if (!t) return;
    for (const e of this.net.edges.values()) e.occupants.delete(id);
    this.funds += trainCost(t.type, t.cfg.coaches) * 0.4;
    this.trains.delete(id);
    this.refreshServedPairs();
    this.version++;
    this.notify(`${t.cfg.number} withdrawn from service`);
  }

  private refreshServedPairs() {
    const set = new Set<string>();
    this.servedPairs = [];
    for (const t of this.trains.values()) {
      const s = t.cfg.stops;
      for (const o of s) for (const d of s) {
        if (o === d) continue;
        const k = `${o}>${d}`;
        if (!set.has(k)) { set.add(k); this.servedPairs.push([o, d]); }
      }
    }
  }

  // ---------------------------------------------------------------- simulation

  update(dtMin: number) {
    let left = dtMin;
    while (left > 0) {
      const dt = Math.min(0.5, left);
      left -= dt;
      this.step(dt);
    }
  }

  private step(dt: number) {
    this.time += dt;
    this.spawnPassengers(dt);
    for (const t of this.trains.values()) this.stepTrain(t, dt);
    this.chargeOperatingCosts(dt);

    const hour = Math.floor(this.time / 60);
    if (hour !== this.lastHour) {
      this.lastHour = hour;
      // older happiness samples fade out
      this.hSum *= 0.9;
      this.hW *= 0.9;
    }
    if (this.time - this.lastGiveUpScan >= 10) {
      this.lastGiveUpScan = this.time;
      this.giveUpScan();
    }
    this.updateEvents();
  }

  private chargeOperatingCosts(dt: number) {
    let c = 0;
    for (const t of this.trains.values()) {
      c += (t.type.opCostPerHour + t.type.opCostPerCoachHour * t.cfg.coaches) * (dt / 60);
    }
    this.funds -= c;
    this.stats.costs += c;
  }

  private spawnPassengers(dt: number) {
    if (!this.servedPairs.length) return;
    const hourOfDay = (this.time / 60) % 24;
    const tod = hourOfDay < 5 ? 0.35 : hourOfDay < 7 ? 0.8 : hourOfDay > 22 ? 0.5 : 1;
    for (const [o, d] of this.servedPairs) {
      const so = this.stations.get(o)!;
      const sd = this.stations.get(d)!;
      const rate = (DEMAND_PER_HOUR * Math.sqrt(city(o).pop * city(d).pop) / 60) * tod * so.demandMult * sd.demandMult;
      const acc = (so.acc.get(d) ?? 0) + rate * dt;
      const n = Math.floor(acc);
      so.acc.set(d, acc - n);
      if (n <= 0) continue;
      const last = so.waiting.length ? so.waiting[so.waiting.length - 1] : undefined;
      if (last && last.dest === d && this.time - last.spawn < 20) {
        last.count += n;
        continue;
      }
      let existing = 0;
      for (const g of so.waiting) if (g.dest === d) existing += g.count;
      if (existing > MAX_WAITING_PER_DEST) continue;
      // merge into a recent group for the same destination
      let merged = false;
      for (let i = so.waiting.length - 1; i >= 0 && i >= so.waiting.length - 40; i--) {
        const g = so.waiting[i];
        if (g.dest === d && this.time - g.spawn < 20) { g.count += n; merged = true; break; }
      }
      if (!merged) so.waiting.push({ origin: o, dest: d, count: n, spawn: this.time, boarded: 0, loadAtBoard: 0 });
    }
  }

  private giveUpScan() {
    for (const s of this.stations.values()) {
      if (!s.waiting.length) continue;
      const keep: PaxGroup[] = [];
      let lost = 0;
      for (const g of s.waiting) {
        if (this.time - g.spawn > GIVE_UP_MIN) lost += g.count;
        else keep.push(g);
      }
      if (lost) {
        s.waiting = keep;
        this.stats.gaveUp += lost;
        this.recordHappiness(25, Math.min(lost, 300) * 0.15);
      }
    }
  }

  /**
   * Signalling. Each line is split into blocks with a crossing loop (or a station) at
   * every boundary. A single-track block holds one train; a double-track block lets
   * opposing trains pass and same-direction trains follow at a headway. Trains only
   * hold a reservation for the block their head is in, and loops/stations have
   * unlimited room, so the network cannot deadlock.
   */
  private canEnter(s: Segment, t: Train): boolean {
    for (const [id, o] of s.edge.occupants) {
      if (id === t.cfg.id || o.block !== s.block) continue;
      if (s.edge.tracks === 1) return false;
      if (o.dir !== s.dir) continue;
      const other = this.trains.get(id);
      if (!other) continue;
      if (other.pos - other.segs[other.seg].start < other.length + HEADWAY) return false;
    }
    return true;
  }

  private reserve(t: Train, i: number): boolean {
    const s = t.segs[i];
    if (!this.canEnter(s, t)) return false;
    s.edge.occupants.set(t.cfg.id, { dir: s.dir, block: s.block });
    t.onSeg = true;
    return true;
  }

  private release(t: Train) {
    if (t.onSeg) t.segs[t.seg].edge.occupants.delete(t.cfg.id);
    t.onSeg = false;
  }

  private stepTrain(t: Train, dt: number) {
    if (t.state === 'dwelling') {
      // at a terminal the rake rolls clear of the junction into the platform road
      if (t.pos < t.rollTo) {
        const rem = t.rollTo - t.pos;
        t.v = Math.max(t.length / 8, Math.min(t.v, Math.sqrt(2 * t.decel * rem)));
        t.pos = Math.min(t.rollTo, t.pos + t.v * dt);
        if (t.pos < t.rollTo) return;
      }
      t.v = 0;
      if (this.time < t.dwellUntil) return;
      this.depart(t);
    }
    const nSeg = t.segs.length;
    if (!t.onSeg && t.seg < nSeg) {
      if (!this.reserve(t, t.seg)) {
        t.holding = true;
        t.v = 0;
        return;
      }
    }
    t.holding = false;

    const stopNode = t.stopIdx[t.nextStop];
    const terminal = t.nextStop === t.stopIdx.length - 1;
    const stopTarget = terminal ? t.totalLen + t.length : t.cum[stopNode];
    // a terminal counts as reached when the head arrives; the train then rolls on into the siding
    const arriveAt = terminal ? t.totalLen : stopTarget;
    let target = stopTarget;
    let speedFactor = 1;

    if (t.onSeg) {
      const s = t.segs[t.seg];
      speedFactor = s.edge.speedFactor;
      // signal at the end of this block (loop or pass-through station)
      const ns = t.segs[t.seg + 1];
      if (ns && !(ns.block === 0 && ns.node === stopNode)) {
        const brake = (t.v * t.v) / (2 * t.decel) + 0.6;
        if (s.end - t.pos <= brake && !this.canEnter(ns, t)) target = Math.min(target, s.end);
      }
      // keep distance behind a train ahead in the same block on double track
      if (s.edge.tracks === 2) {
        const mine = t.pos - s.start;
        for (const [id, o] of s.edge.occupants) {
          if (id === t.cfg.id || o.dir !== s.dir || o.block !== s.block) continue;
          const other = this.trains.get(id)!;
          const theirs = other.pos - other.segs[other.seg].start;
          if (theirs > mine) target = Math.min(target, s.start + theirs - other.length - HEADWAY);
        }
      }
    }

    const vmax = t.cruise * speedFactor;
    const remaining = target - t.pos;
    const vBrake = Math.sqrt(2 * t.decel * Math.max(0, remaining));
    t.v = Math.max(0, Math.min(t.v + t.accel * dt, vmax, vBrake));
    let newPos = remaining < 0.03 ? Math.max(t.pos, target) : Math.min(t.pos + Math.max(t.v, 0.01) * dt, target);
    newPos = Math.max(t.pos, newPos);

    // cross block boundaries
    while (t.seg < nSeg && newPos >= t.segs[t.seg].end) {
      this.release(t);
      t.seg++;
      const ns = t.segs[t.seg];
      if (!ns || (ns.block === 0 && ns.node === stopNode)) break;
      if (!this.reserve(t, t.seg)) {
        newPos = ns.start;
        t.v = 0;
        t.holding = true;
        break;
      }
    }
    t.pos = newPos;
    if (t.pos >= arriveAt - 1e-6) this.arrive(t, terminal);
    else if (t.pos >= target - 1e-6) t.v = 0;
  }

  private arrive(t: Train, terminal: boolean) {
    const stopId = t.path[t.stopIdx[t.nextStop]];
    if (terminal) t.rollTo = t.totalLen + t.length;
    else t.v = 0;
    t.state = 'dwelling';
    const delay = Math.max(0, this.time - t.schedArr);
    t.delay = delay;
    const onTime = delay <= ON_TIME_MIN;
    this.recentArrivals.push(onTime);
    if (this.recentArrivals.length > 60) this.recentArrivals.shift();
    this.stats.arrivals++;
    if (onTime) this.stats.onTimeArrivals++;
    if (delay > 30) this.notify(`${t.cfg.number} reached ${city(stopId).name} ${Math.round(delay)} min late`, 'bad');

    // alight
    const keep: PaxGroup[] = [];
    for (const g of t.passengers) {
      if (g.dest === stopId) this.deliver(t, g, delay);
      else keep.push(g);
    }
    t.passengers = keep;

    const planned = terminal ? Train.TERMINAL_DWELL : Train.INTERMEDIATE_DWELL;
    const min = terminal ? Train.MIN_TERMINAL_DWELL : Train.MIN_INTERMEDIATE_DWELL;
    t.schedDep = t.schedArr + planned;
    if (terminal && delay > 45) {
      // badly late rakes get a fresh path at the terminal instead of staying late forever
      t.schedDep = this.time + min + 5;
      this.notify(`${t.cfg.number} re-timed at ${city(stopId).name}, departs ${fmtClock(t.schedDep)}`);
    }
    t.dwellUntil = Math.max(this.time + min, t.schedDep);
    t.nextStop++;
    if (!terminal) this.board(t, stopId);
  }

  private depart(t: Train) {
    if (t.nextStop >= t.stopIdx.length) {
      // reverse at terminal
      const prevDir = t.dir;
      t.dir = (t.dir === 1 ? -1 : 1) as 1 | -1;
      if (!t.buildPath(this.net)) {
        t.dir = prevDir;
        t.dwellUntil = this.time + 30;
        return;
      }
      t.pos = 0;
      t.rollTo = 0;
      t.seg = 0;
      t.onSeg = false;
      t.nextStop = 1;
      t.tripStartedAt = this.time;
    }
    const here = t.path[t.stopIdx[t.nextStop - 1]];
    this.board(t, here);
    const lf = t.load / t.seats;
    for (const g of t.passengers) g.loadAtBoard = Math.max(g.loadAtBoard, lf);
    const legLen = t.cum[t.stopIdx[t.nextStop]] - t.cum[t.stopIdx[t.nextStop - 1]];
    t.schedArr = t.schedDep + t.plannedTravel(legLen);
    t.state = 'running';
  }

  private board(t: Train, stationId: string) {
    const st = this.stations.get(stationId)!;
    if (!st.waiting.length) return;
    const ahead = new Set<string>();
    for (let k = t.nextStop; k < t.stopIdx.length; k++) ahead.add(t.path[t.stopIdx[k]]);
    let free = t.capacity - t.load;
    if (free <= 0) return;
    const keep: PaxGroup[] = [];
    for (const g of st.waiting) {
      if (free > 0 && ahead.has(g.dest)) {
        const n = Math.min(free, g.count);
        free -= n;
        t.passengers.push({ ...g, count: n, boarded: this.time, loadAtBoard: 0 });
        if (n < g.count) keep.push({ ...g, count: g.count - n });
      } else keep.push(g);
    }
    st.waiting = keep;
  }

  private deliver(t: Train, g: PaxGroup, delay: number) {
    const wait = g.boarded - g.spawn;
    const distKm = km(distance(g.origin, g.dest)) * 1.15;
    const waitPen = Math.min(30, Math.max(0, (wait - 30) / 6));
    const delayPen = Math.min(40, Math.max(0, (delay - ON_TIME_MIN) / 2));
    const crowdPen = Math.min(35, Math.max(0, (g.loadAtBoard - 1) * 60));
    const onTime = delay <= ON_TIME_MIN;
    const h = Math.max(0, Math.min(100, 70 + t.type.comfort - waitPen - delayPen - crowdPen + (onTime ? 10 : 0)));
    this.recordHappiness(h, Math.min(g.count, 400));
    const revenue = g.count * distKm * t.type.fareMult * FARE_PER_PAX_KM;
    this.funds += revenue;
    this.stats.revenue += revenue;
    this.stats.delivered += g.count;
    this.score += Math.round(g.count * (distKm / 100) * (h / 100) * (onTime ? 1.25 : 1));
  }

  // ---------------------------------------------------------------- events

  private updateEvents() {
    let changed = false;
    for (const ev of [...this.events]) {
      if (this.time >= ev.endsAt) {
        this.events.splice(this.events.indexOf(ev), 1);
        this.notify(`Cleared: ${ev.title}`, 'good');
        changed = true;
      }
    }
    if (this.time >= this.nextEventAt) {
      this.nextEventAt = this.time + (16 + Math.random() * 20) * 60;
      if (this.net.edges.size && this.trains.size) {
        const ev = this.rollEvent();
        if (ev) {
          this.events.push(ev);
          this.notify(`${ev.title} — ${ev.detail}`, 'bad');
          changed = true;
        }
      }
    }
    if (changed) this.applyEvents();
  }

  private rollEvent(): GameEvent | null {
    const r = Math.random();
    const edges = [...this.net.edges.values()];
    if (r < 0.3) {
      return { kind: 'fog', title: 'Dense fog over North India', detail: 'line speed cut north of 24°N', endsAt: this.time + 8 * 60 };
    }
    if (r < 0.5) {
      return { kind: 'monsoon', title: 'Heavy monsoon rain', detail: 'west-coast lines slowed', endsAt: this.time + 10 * 60 };
    }
    if (r < 0.8) {
      const e = edges[Math.floor(Math.random() * edges.length)];
      return {
        kind: 'signal', title: 'Signal failure', detail: `${city(e.a).name} – ${city(e.b).name} on caution`,
        endsAt: this.time + 3 * 60, edgeId: e.id,
      };
    }
    const served = [...new Set(this.servedPairs.map((p) => p[0]))];
    if (!served.length) return null;
    const c = served[Math.floor(Math.random() * served.length)];
    const fest = ['Diwali', 'Durga Puja', 'Holi', 'Pongal', 'Onam', 'Ganesh Chaturthi', 'Chhath'][Math.floor(Math.random() * 7)];
    return {
      kind: 'festival', title: `${fest} rush`, detail: `demand at ${city(c).name} doubled`,
      endsAt: this.time + 12 * 60, cityId: c,
    };
  }

  applyEvents() {
    for (const e of this.net.edges.values()) {
      let f = 1;
      const a = city(e.a);
      const b = city(e.b);
      for (const ev of this.events) {
        if (ev.kind === 'fog' && a.lat >= 24 && b.lat >= 24) f = Math.min(f, 0.55);
        if (ev.kind === 'monsoon' && a.lon < 77.5 && b.lon < 77.5 && a.lat < 21.5 && b.lat < 21.5) f = Math.min(f, 0.7);
        if (ev.kind === 'signal' && ev.edgeId === e.id) f = Math.min(f, 0.25);
      }
      e.speedFactor = f;
    }
    for (const s of this.stations.values()) {
      s.demandMult = this.events.some((ev) => ev.kind === 'festival' && ev.cityId === s.id) ? 2 : 1;
    }
  }

  // ---------------------------------------------------------------- persistence

  save() {
    const data = {
      v: 1,
      time: this.time,
      funds: this.funds,
      score: this.score,
      stats: this.stats,
      hSum: this.hSum,
      hW: this.hW,
      recent: this.recentArrivals,
      nextTrainNum: this.nextTrainNum,
      edges: [...this.net.edges.values()].map((e) => [e.a, e.b, e.tracks]),
      trains: [...this.trains.values()].map((t) => t.cfg),
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      /* storage unavailable */
    }
  }

  static load(): Game | null {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(SAVE_KEY);
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      const d = JSON.parse(raw);
      if (d.v !== 1) return null;
      const g = new Game();
      g.time = d.time;
      g.funds = d.funds;
      g.score = d.score;
      g.stats = d.stats;
      g.hSum = d.hSum;
      g.hW = d.hW;
      g.recentArrivals = d.recent ?? [];
      g.nextTrainNum = d.nextTrainNum;
      g.lastHour = Math.floor(g.time / 60);
      g.nextEventAt = g.time + 12 * 60;
      for (const [a, b, tracks] of d.edges) g.net.addEdge(a, b, tracks);
      for (const cfg of d.trains as TrainConfig[]) {
        const t = new Train(cfg);
        if (t.start(g.net, g.time, Math.ceil((g.time + 5) / 15) * 15)) g.trains.set(cfg.id, t);
      }
      g.refreshServedPairs();
      if (g.net.edges.size) g.notify('Welcome back. Your network has been restored.');
      return g;
    } catch {
      return null;
    }
  }

  static clearSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* ignore */
    }
  }
}
