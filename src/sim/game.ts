import { CITIES, city } from '../data/cities';
import { PAX_CLASSES, PAX_CLASS_INFO, PaxClass, TRAIN_TYPE_BY_ID, trainCost } from '../data/trainTypes';
import {
  DFC, DOUBLING_KM_PER_DAY, RESEARCH_BY_ID, lineClass, nextLineClass,
} from '../data/research';
import { COMMODITIES, COMMODITY_INFO, Commodity, flowWeight } from '../data/freight';
import {
  MAX_TRACK_KM, Network, TrackEdge, distance, doubleCost, edgeId, km, liveTracks, routeMode, trackCost,
} from './network';
import { CargoGroup, ON_TIME_MIN, PaxGroup, Segment, Train, TrainConfig } from './train';
import { Flow, Ledger } from './ledger';

export const START_FUNDS = 600;
const FARE_PER_PAX_KM = 0.00003; // ₹ Cr
const DEMAND_PER_HOUR = 9; // passengers/hour per sqrt(M·M) of population, all classes, before service quality
/** How strongly each class responds to service speed (door-to-door km/h). */
const SPEED_ELASTICITY: Record<PaxClass, number> = { general: 0.3, ac: 0.8, premium: 1.4 };
const REFERENCE_KMH = 70;
/** How much crowding bothers each class. */
const CROWD_TOLERANCE: Record<PaxClass, number> = { general: 0.4, ac: 1, premium: 1.5 };
const GIVE_UP_MIN = 6 * 60;
const MAX_WAITING_PER_DEST = 1500;
const HEADWAY = 2.5;
/** Tonnes per hour of freight offered per unit of flow weight. */
const FREIGHT_PER_HOUR = 55;
const MAX_CARGO_WAITING = 8000; // tonnes per flow; beyond this shippers use the road
const SAVE_KEY = 'railflow-save-v1';

/** The block reservations a segment uses: the main line, or the freight corridor alongside. */
function occupancy(s: Segment) {
  return s.dfc ? s.edge.dfcOccupants : s.edge.occupants;
}

/** 0, ½, ¼, ¾, ⅛ … (van der Corput): evenly fills a cycle however many trains join it. */
function spread(k: number): number {
  let f = 0;
  let base = 0.5;
  for (let n = k; n > 0; n >>= 1, base /= 2) if (n & 1) f += base;
  return f;
}

function fmtWhen(min: number): string {
  return `Day ${Math.floor(min / 1440) + 1} ${fmtClock(min)}`;
}

function fmtClock(min: number): string {
  const m = Math.floor(min) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export interface Station {
  id: string;
  waiting: PaxGroup[];
  cargo: CargoGroup[];
  acc: Map<string, number>;
  demandMult: number;
}

export type EventKind = 'fog' | 'monsoon' | 'signal' | 'festival' | 'incident';

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

/** Fares collected by one train at one stop, for the on-map popups. */
export interface Payout {
  trainId: string;
  cityId: string;
  amount: number;
  freight: boolean;
}

/** One class of passengers between two stations, and the service they get. */
interface ServedPair {
  o: string;
  d: string;
  cls: PaxClass;
  trains: number;
  kmh: number; // best door-to-door speed among trains they can take
}

export interface ResearchState {
  done: Set<string>;
  active: { id: string; start: number; end: number } | null;
}

export interface Stats {
  delivered: number;
  gaveUp: number;
  arrivals: number;
  onTimeArrivals: number;
  revenue: number;
  costs: number;
  freightTons: number;
}

export class Game {
  net = new Network();
  trains = new Map<string, Train>();
  stations = new Map<string, Station>();
  time = 6 * 60; // game minutes since Day 1 00:00
  funds = START_FUNDS;
  score = 0;
  stats: Stats = { delivered: 0, gaveUp: 0, arrivals: 0, onTimeArrivals: 0, revenue: 0, costs: 0, freightTons: 0 };
  events: GameEvent[] = [];
  log: LogEntry[] = [];
  ledger = new Ledger(this.time);
  /** Unread payouts; the UI drains this. */
  payouts: Payout[] = [];
  /** Exponentially-decayed happiness accumulator. */
  private hSum = 75 * 40;
  private hW = 40;
  private recentArrivals: boolean[] = [];
  private servedPairs: ServedPair[] = [];
  research: ResearchState = { done: new Set(), active: null };
  /** Freight flows some train can carry: commodity from o to d, and how many trains offer it. */
  private freightFlows: { o: string; d: string; c: Commodity; trains: number }[] = [];
  /** Train-minutes spent held at signals this step, by line, for the congestion view. */
  private heldThisStep = new Map<TrackEdge, number>();
  private nextTrainNum = 1;
  private nextEventAt = this.time + 20 * 60;
  private logId = 0;
  private lastHour = Math.floor(this.time / 60);
  private lastGiveUpScan = 0;
  /** Bumped whenever tracks or trains change, so renderers can resync. */
  version = 0;

  constructor() {
    for (const c of CITIES) {
      this.stations.set(c.id, { id: c.id, waiting: [], cargo: [], acc: new Map(), demandMult: 1 });
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

  /** The only place funds change. Income is positive, spending negative. */
  private book(flow: Flow, amount: number, train?: Train) {
    this.funds += amount;
    if (flow === 'fares' || flow === 'freight') this.stats.revenue += amount;
    else if (amount < 0) this.stats.costs -= amount;
    this.ledger.add(flow, amount, this.time);
    train?.money.add(flow, amount, this.time);
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
    this.book('track', -chk.cost);
    this.net.addEdge(a, b);
    this.version++;
    this.notify(`Track laid: ${city(a).name} – ${city(b).name} (${Math.round(km(distance(a, b)))} km)`);
    return true;
  }

  upgradeTrack(id: string): boolean {
    const info = this.doubleInfo(id);
    if (!info.ok) return false;
    const e = this.net.edges.get(id)!;
    this.book('track', -info.cost!);
    e.works = { kind: 'double', start: this.time, end: this.time + info.hours! * 60 };
    this.version++;
    this.notify(`Doubling works begin: ${city(e.a).name} – ${city(e.b).name}. ${this.worksImpact(e)}`, 'bad');
    return true;
  }

  trainsUsingEdge(id: string): Train[] {
    const out: Train[] = [];
    for (const t of this.trains.values()) {
      const route = this.net.routePath(t.cfg.stops, routeMode(t.type)) ?? [];
      const uses = (p: string[]) => p.some((n, i) => i > 0 && edgeId(p[i - 1], n) === id);
      if (uses(t.path) || uses(route)) out.push(t);
    }
    return out;
  }

  removeTrack(id: string): boolean {
    const e = this.net.edges.get(id);
    if (!e || this.trainsUsingEdge(id).length) return false;
    this.net.removeEdge(id);
    this.book('sales', trackCost(e.a, e.b) * 0.25);
    this.version++;
    this.notify(`Track removed: ${city(e.a).name} – ${city(e.b).name}`);
    return true;
  }

  // ---------------------------------------------------------------- research

  isResearched(id: string | undefined): boolean {
    return !id || this.research.done.has(id);
  }

  canResearch(id: string): { ok: boolean; reason?: string } {
    const r = RESEARCH_BY_ID.get(id);
    if (!r) return { ok: false, reason: 'Unknown project' };
    if (this.research.done.has(id)) return { ok: false, reason: 'Done' };
    if (this.research.active) return { ok: false, reason: 'Another project is running' };
    const missing = r.requires.filter((q) => !this.research.done.has(q));
    if (missing.length) return { ok: false, reason: `Needs ${missing.map((q) => RESEARCH_BY_ID.get(q)!.name).join(' and ')}` };
    if (r.cost > this.funds) return { ok: false, reason: 'Not enough funds' };
    return { ok: true };
  }

  startResearch(id: string): boolean {
    if (!this.canResearch(id).ok) return false;
    const r = RESEARCH_BY_ID.get(id)!;
    this.book('research', -r.cost);
    this.research.active = { id, start: this.time, end: this.time + r.hours * 60 };
    this.notify(`Research started: ${r.name}, ready ${fmtWhen(this.research.active.end)}`);
    return true;
  }

  private updateResearch() {
    const a = this.research.active;
    if (!a || this.time < a.end) return;
    this.research.done.add(a.id);
    this.research.active = null;
    const r = RESEARCH_BY_ID.get(a.id)!;
    this.notify(`Research complete: ${r.name}. Unlocked ${r.unlocks}.`, 'good');
    this.version++;
  }

  // ---------------------------------------------------------------- line works

  /** Next speed upgrade for a line, if any, with its cost and length of works. */
  upgradeInfo(id: string): { ok: boolean; toKmh?: number; cost?: number; hours?: number; reason?: string } {
    const e = this.net.edges.get(id);
    if (!e) return { ok: false, reason: 'No such line' };
    const next = nextLineClass(e.kmh);
    if (!next) return { ok: false, reason: 'Already at top speed' };
    const cost = km(e.length) * next.costPerKm * (e.tracks === 2 ? 1.7 : 1);
    const hours = Math.max(6, (km(e.length) / next.kmPerDay) * 24);
    const base = { toKmh: next.kmh, cost, hours };
    if (!this.isResearched(next.research)) return { ok: false, ...base, reason: `Research ${RESEARCH_BY_ID.get(next.research!)!.name}` };
    if (e.works) return { ok: false, ...base, reason: 'Works already under way' };
    if (cost > this.funds) return { ok: false, ...base, reason: 'Not enough funds' };
    return { ok: true, ...base };
  }

  upgradeLine(id: string): boolean {
    const info = this.upgradeInfo(id);
    if (!info.ok) return false;
    const e = this.net.edges.get(id)!;
    this.book('track', -info.cost!);
    e.works = { kind: 'upgrade', toKmh: info.toKmh, start: this.time, end: this.time + info.hours! * 60 };
    this.version++;
    this.notify(`Works begin: ${city(e.a).name} – ${city(e.b).name} to ${info.toKmh} km/h. ${this.worksImpact(e)}`, 'bad');
    return true;
  }

  doubleInfo(id: string): { ok: boolean; cost?: number; hours?: number; reason?: string } {
    const e = this.net.edges.get(id);
    if (!e) return { ok: false, reason: 'No such line' };
    if (e.tracks === 2) return { ok: false, reason: 'Already double' };
    const cost = doubleCost(e) * (lineClass(e.kmh).costPerKm > 0 ? 1.3 : 1);
    const hours = Math.max(6, (km(e.length) / DOUBLING_KM_PER_DAY) * 24);
    if (e.works) return { ok: false, cost, hours, reason: 'Works already under way' };
    if (cost > this.funds) return { ok: false, cost, hours, reason: 'Not enough funds' };
    return { ok: true, cost, hours };
  }

  /** Building a freight corridor alongside a line: cost, time, and why not. */
  dfcInfo(id: string): { ok: boolean; cost?: number; hours?: number; reason?: string } {
    const e = this.net.edges.get(id);
    if (!e) return { ok: false, reason: 'No such line' };
    if (e.dfc) return { ok: false, reason: 'Corridor built' };
    const cost = km(e.length) * DFC.costPerKm;
    const hours = Math.max(8, (km(e.length) / DFC.kmPerDay) * 24);
    if (!this.research.done.has('dfc')) return { ok: false, cost, hours, reason: 'Research Dedicated freight corridors' };
    if (e.works) return { ok: false, cost, hours, reason: 'Works already under way' };
    if (cost > this.funds) return { ok: false, cost, hours, reason: 'Not enough funds' };
    return { ok: true, cost, hours };
  }

  buildDfc(id: string): boolean {
    const info = this.dfcInfo(id);
    if (!info.ok) return false;
    const e = this.net.edges.get(id)!;
    this.book('track', -info.cost!);
    e.works = { kind: 'dfc', start: this.time, end: this.time + info.hours! * 60 };
    this.version++;
    this.notify(`Freight corridor under construction: ${city(e.a).name} – ${city(e.b).name}. Built alongside, so traffic keeps moving.`);
    return true;
  }

  /** Trains on a line that could take another way round, for planning works. */
  diversions(id: string): { users: Train[]; stuck: Train[] } {
    const e = this.net.edges.get(id);
    const users = this.trainsUsingEdge(id);
    if (!e) return { users, stuck: [] };
    const saved = e.kmh;
    e.kmh = 0.001; // price the line out of the route search
    const stuck = users.filter((t) => {
      const p = this.net.routePath(t.cfg.stops, routeMode(t.type));
      return !p || p.some((n, i) => i > 0 && edgeId(p[i - 1], n) === id);
    });
    e.kmh = saved;
    return { users, stuck };
  }

  /** How works on a line will hit traffic, for the notice when they start. */
  private worksImpact(e: TrackEdge): string {
    const { users, stuck } = this.diversions(e.id);
    if (!users.length) return 'No trains affected.';
    if (stuck.length) return `${stuck.length} train${stuck.length > 1 ? 's have' : ' has'} no diversion and will crawl through the works.`;
    const through = this.trainsUsingEdge(e.id).length;
    return through ? `${through} train${through > 1 ? 's' : ''} will still run through; the way round is slower.` : `All ${users.length} affected trains divert.`;
  }

  private updateWorks() {
    for (const e of this.net.edges.values()) {
      const w = e.works;
      if (!w || this.time < w.end) continue;
      if (w.kind === 'upgrade') e.kmh = w.toKmh!;
      else if (w.kind === 'dfc') e.dfc = true;
      else e.tracks = 2;
      e.works = null;
      this.version++;
      const what = w.kind === 'upgrade' ? `now ${e.kmh} km/h` : w.kind === 'dfc' ? 'freight corridor open' : 'now double track';
      this.notify(`Works complete: ${city(e.a).name} – ${city(e.b).name} ${what}`, 'good');
    }
  }

  routeInfo(stops: string[], typeId?: string): { ok: boolean; path?: string[]; length?: number; reason?: string } {
    if (stops.length < 2) return { ok: false, reason: 'Add at least two stops' };
    for (let i = 1; i < stops.length; i++) {
      if (stops[i] === stops[i - 1]) return { ok: false, reason: 'Consecutive stops must differ' };
    }
    const type = typeId ? TRAIN_TYPE_BY_ID.get(typeId) : undefined;
    const path = this.net.routePath(stops, type ? routeMode(type) : {});
    if (!path) {
      if (type?.needsLineKmh) return { ok: false, reason: `Needs ${type.needsLineKmh} km/h high-speed line between every stop` };
      if (type?.needsDfc) return { ok: false, reason: 'Needs a freight corridor between every stop' };
      return { ok: false, reason: 'Stops are not connected by track' };
    }
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
    if (!this.isResearched(type.research)) return `Research ${RESEARCH_BY_ID.get(type.research!)!.name} first`;
    const route = this.routeInfo(spec.stops, spec.typeId);
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
    t.money = new Ledger(this.time);
    // first departure on the next quarter hour; trains added to an identical route are
    // spread through its cycle (½, ¼, ¾ …) so they do not run in a bunch
    const same = [...this.trains.values()].filter((o) => o.cfg.stops.join() === spec.stops.join()).length;
    t.start(this.net, this.time, this.time);
    const cycle = 2 * (t.journeyTime(this.net) + Train.TERMINAL_DWELL);
    const dep = Math.ceil((this.time + 10 + cycle * spread(same)) / 15) * 15;
    t.start(this.net, this.time, dep);
    this.book('trains', -cost, t);
    this.trains.set(cfg.id, t);
    this.refreshServedPairs();
    this.version++;
    this.notify(`${cfg.number} ${cfg.name} enters service`, 'good');
    return t;
  }

  removeTrain(id: string) {
    const t = this.trains.get(id);
    if (!t) return;
    for (const e of this.net.edges.values()) {
      e.occupants.delete(id);
      e.dfcOccupants.delete(id);
    }
    this.book('sales', trainCost(t.type, t.cfg.coaches) * 0.4);
    this.trains.delete(id);
    this.refreshServedPairs();
    this.version++;
    this.notify(`${t.cfg.number} withdrawn from service`);
  }

  /** Which classes can travel between which stations, how often and how fast. */
  private refreshServedPairs() {
    const by = new Map<string, ServedPair>();
    for (const t of this.trains.values()) {
      const s = t.cfg.stops;
      for (const cls of PAX_CLASSES) {
        if (!t.carries(cls)) continue;
        for (const o of s) for (const d of s) {
          if (o === d) continue;
          const k = `${o}>${d}>${cls}`;
          const p = by.get(k);
          if (p) {
            p.trains++;
            p.kmh = Math.max(p.kmh, t.serviceKmh);
          } else by.set(k, { o, d, cls, trains: 1, kmh: t.serviceKmh });
        }
      }
    }
    this.servedPairs = [...by.values()];

    const flows = new Map<string, { o: string; d: string; c: Commodity; trains: number }>();
    for (const t of this.trains.values()) {
      if (!t.freight) continue;
      const s = t.cfg.stops;
      for (const c of COMMODITIES) {
        if (!t.carriesCargo(c)) continue;
        for (const o of s) for (const d of s) {
          if (!flowWeight(c, o, d)) continue;
          const k = `${o}>${d}>${c}`;
          const f = flows.get(k);
          if (f) f.trains++;
          else flows.set(k, { o, d, c, trains: 1 });
        }
      }
    }
    this.freightFlows = [...flows.values()];
  }

  /** Tonnes per hour offered on a freight flow. */
  flowTons(f: { o: string; d: string; c: Commodity; trains: number }): number {
    return FREIGHT_PER_HOUR * flowWeight(f.c, f.o, f.d) * Math.pow(Math.min(6, f.trains), 0.3);
  }

  private spawnCargo(dt: number) {
    for (const f of this.freightFlows) {
      const so = this.stations.get(f.o)!;
      const key = `${f.d}|${f.c}`;
      const acc = (so.acc.get(key) ?? 0) + (this.flowTons(f) / 60) * dt;
      const n = Math.floor(acc);
      so.acc.set(key, acc - n);
      if (n <= 0) continue;
      const g = so.cargo.find((x) => x.dest === f.d && x.commodity === f.c);
      if (g) g.tons = Math.min(MAX_CARGO_WAITING, g.tons + n);
      else so.cargo.push({ commodity: f.c, origin: f.o, dest: f.d, tons: n, spawn: this.time });
    }
  }

  cargoAt(id: string): number {
    let n = 0;
    for (const g of this.stations.get(id)!.cargo) n += g.tons;
    return n;
  }

  /** Passengers per hour a served pair generates, before time of day and events. */
  pairDemand(p: { o: string; d: string; cls: PaxClass; trains: number; kmh: number }): number {
    const speed = Math.pow(Math.max(0.4, p.kmh / REFERENCE_KMH), SPEED_ELASTICITY[p.cls]);
    const freq = Math.pow(Math.min(6, p.trains), 0.45);
    return DEMAND_PER_HOUR * Math.sqrt(city(p.o).pop * city(p.d).pop) * PAX_CLASS_INFO[p.cls].share * speed * freq;
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
    this.spawnCargo(dt);
    this.heldThisStep.clear();
    for (const t of this.trains.values()) this.stepTrain(t, dt);
    this.measureLines(dt);
    this.chargeOperatingCosts(dt);
    this.updateResearch();
    this.updateWorks();

    const hour = Math.floor(this.time / 60);
    if (hour !== this.lastHour) {
      this.lastHour = hour;
      // trains re-time at each reversal, so service speeds drift; refresh demand hourly
      this.refreshServedPairs();
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
    for (const t of this.trains.values()) this.book('running', -t.runningCostPerHour * (dt / 60), t);
    let upkeep = 0;
    for (const e of this.net.edges.values()) {
      upkeep += km(e.length) * (lineClass(e.kmh).upkeepPerKmDay * (e.tracks === 2 ? 1.6 : 1) + (e.dfc ? DFC.upkeepPerKmDay : 0));
    }
    if (upkeep) this.book('upkeep', -upkeep * (dt / 1440));
  }

  private spawnPassengers(dt: number) {
    if (!this.servedPairs.length) return;
    const hourOfDay = (this.time / 60) % 24;
    const tod = hourOfDay < 5 ? 0.35 : hourOfDay < 7 ? 0.8 : hourOfDay > 22 ? 0.5 : 1;
    for (const p of this.servedPairs) {
      const { o, d, cls } = p;
      const so = this.stations.get(o)!;
      const sd = this.stations.get(d)!;
      const rate = (this.pairDemand(p) / 60) * tod * so.demandMult * sd.demandMult;
      const key = `${d}|${cls}`;
      const acc = (so.acc.get(key) ?? 0) + rate * dt;
      const n = Math.floor(acc);
      so.acc.set(key, acc - n);
      if (n <= 0) continue;
      let existing = 0;
      for (const g of so.waiting) if (g.dest === d && g.cls === cls) existing += g.count;
      if (existing > MAX_WAITING_PER_DEST * PAX_CLASS_INFO[cls].share) continue;
      // merge into a recent group for the same destination and class
      let merged = false;
      for (let i = so.waiting.length - 1; i >= 0 && i >= so.waiting.length - 40; i--) {
        const g = so.waiting[i];
        if (g.dest === d && g.cls === cls && this.time - g.spawn < 20) { g.count += n; merged = true; break; }
      }
      if (!merged) so.waiting.push({ cls, origin: o, dest: d, count: n, spawn: this.time, boarded: 0, loadAtBoard: 0 });
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
  /** Smoothed block use and signal holds per line, for the congestion view (≈2 h memory). */
  private measureLines(dt: number) {
    const k = Math.min(1, dt / 120);
    for (const e of this.net.edges.values()) {
      const use = e.occupants.size / (e.blocks * liveTracks(e));
      e.util += (use - e.util) * k;
      const held = ((this.heldThisStep.get(e) ?? 0) / dt) * 60;
      e.held += (held - e.held) * k;
    }
  }

  private noteHeld(t: Train, dt: number) {
    const s = t.segs[t.seg];
    if (s && !s.dfc) this.heldThisStep.set(s.edge, (this.heldThisStep.get(s.edge) ?? 0) + dt);
  }

  private canEnter(s: Segment, t: Train): boolean {
    for (const [id, o] of occupancy(s)) {
      if (id === t.cfg.id || o.block !== s.block) continue;
      if (!s.dfc && liveTracks(s.edge) === 1) return false;
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
    occupancy(s).set(t.cfg.id, { dir: s.dir, block: s.block });
    t.onSeg = true;
    return true;
  }

  private release(t: Train) {
    if (t.onSeg) occupancy(t.segs[t.seg]).delete(t.cfg.id);
    t.onSeg = false;
  }

  private stepTrain(t: Train, dt: number) {
    if (t.state === 'dwelling') {
      t.v = 0;
      if (this.time < t.dwellUntil) return;
      this.depart(t);
    }
    const nSeg = t.segs.length;
    if (!t.onSeg && t.seg < nSeg) {
      if (!this.reserve(t, t.seg)) {
        t.holding = true;
        t.v = 0;
        this.noteHeld(t, dt);
        return;
      }
    }
    t.holding = false;

    const stopNode = t.stopIdx[t.nextStop];
    const terminal = t.nextStop === t.stopIdx.length - 1;
    // every stop, terminals included, is reached when the head draws up at the station
    const arriveAt = t.cum[stopNode];
    let target = arriveAt;
    let vmax = t.cruise;

    if (t.onSeg) {
      const s = t.segs[t.seg];
      vmax = t.vmaxOn(s.edge) * s.edge.speedFactor;
      // signal at the end of this block (loop or pass-through station)
      const ns = t.segs[t.seg + 1];
      if (ns && !(ns.block === 0 && ns.node === stopNode)) {
        const brake = (t.v * t.v) / (2 * t.decel) + 0.6;
        if (s.end - t.pos <= brake && !this.canEnter(ns, t)) target = Math.min(target, s.end);
      }
      // keep distance behind a train ahead in the same block on double track
      if (s.dfc || liveTracks(s.edge) === 2) {
        const mine = t.pos - s.start;
        for (const [id, o] of occupancy(s)) {
          if (id === t.cfg.id || o.dir !== s.dir || o.block !== s.block) continue;
          const other = this.trains.get(id)!;
          const theirs = other.pos - other.segs[other.seg].start;
          if (theirs > mine) target = Math.min(target, s.start + theirs - other.length - HEADWAY);
        }
      }
    }

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
    t.v = 0;
    t.state = 'dwelling';
    const delay = Math.max(0, this.time - t.schedArr);
    t.delay = delay;
    // freight runs to paths, not a public timetable, so it does not count towards punctuality
    if (!t.freight) {
      const onTime = delay <= ON_TIME_MIN;
      this.recentArrivals.push(onTime);
      if (this.recentArrivals.length > 60) this.recentArrivals.shift();
      this.stats.arrivals++;
      if (onTime) this.stats.onTimeArrivals++;
      if (delay > 30) this.notify(`${t.cfg.number} reached ${city(stopId).name} ${Math.round(delay)} min late`, 'bad');
    }

    // alight / unload
    const keep: PaxGroup[] = [];
    let fares = 0;
    for (const g of t.passengers) {
      if (g.dest === stopId) fares += this.deliver(t, g, delay);
      else keep.push(g);
    }
    t.passengers = keep;
    const kept: CargoGroup[] = [];
    for (const g of t.cargo) {
      if (g.dest === stopId) fares += this.deliverCargo(t, g);
      else kept.push(g);
    }
    t.cargo = kept;
    t.tripFares += fares;
    if (fares > 0) {
      this.payouts.push({ trainId: t.cfg.id, cityId: stopId, amount: fares, freight: t.freight });
      if (this.payouts.length > 40) this.payouts.shift();
    }
    if (terminal) {
      t.lastTripFares = t.tripFares;
      t.tripFares = 0;
    }

    const { planned, min } = t.dwell(terminal);
    t.schedDep = t.schedArr + planned;
    if (terminal && delay > 45) {
      // badly late rakes get a fresh path at the terminal instead of staying late forever
      t.schedDep = this.time + min + 5;
      if (!t.freight) this.notify(`${t.cfg.number} re-timed at ${city(stopId).name}, departs ${fmtClock(t.schedDep)}`);
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
      t.placeAtOrigin();
      t.nextStop = 1;
      t.tripStartedAt = this.time;
    }
    const here = t.path[t.stopIdx[t.nextStop - 1]];
    this.board(t, here);
    const lf = t.load / t.seats;
    for (const g of t.passengers) g.loadAtBoard = Math.max(g.loadAtBoard, lf);
    t.schedArr = t.schedDep + t.legTime(this.net, t.stopIdx[t.nextStop - 1], t.stopIdx[t.nextStop]);
    t.state = 'running';
  }

  private board(t: Train, stationId: string) {
    if (t.freight) return this.loadCargo(t, stationId);
    const st = this.stations.get(stationId)!;
    if (!st.waiting.length) return;
    const ahead = new Set<string>();
    for (let k = t.nextStop; k < t.stopIdx.length; k++) ahead.add(t.path[t.stopIdx[k]]);
    let free = t.capacity - t.load;
    if (free <= 0) return;
    const keep: PaxGroup[] = [];
    for (const g of st.waiting) {
      if (free > 0 && ahead.has(g.dest) && t.carries(g.cls)) {
        const n = Math.min(free, g.count);
        free -= n;
        t.passengers.push({ ...g, count: n, boarded: this.time, loadAtBoard: 0 });
        if (n < g.count) keep.push({ ...g, count: g.count - n });
      } else keep.push(g);
    }
    st.waiting = keep;
  }

  private loadCargo(t: Train, stationId: string) {
    const st = this.stations.get(stationId)!;
    if (!st.cargo.length) return;
    const ahead = new Set<string>();
    for (let k = t.nextStop; k < t.stopIdx.length; k++) ahead.add(t.path[t.stopIdx[k]]);
    let free = t.capacity - t.load;
    // load the best-paying consignments first: long hauls of high-value goods
    const value = (g: CargoGroup) => COMMODITY_INFO[g.commodity].rate * distance(g.origin, g.dest);
    const order = [...st.cargo].sort((a, b) => value(b) - value(a));
    for (const g of order) {
      if (free <= 0) break;
      if (!ahead.has(g.dest) || !t.carriesCargo(g.commodity)) continue;
      const n = Math.min(free, g.tons);
      free -= n;
      g.tons -= n;
      t.cargo.push({ ...g, tons: n });
    }
    st.cargo = st.cargo.filter((g) => g.tons > 0);
  }

  /** Freight charge for a consignment delivered; it is booked as freight income. */
  private deliverCargo(t: Train, g: CargoGroup): number {
    const revenue = g.tons * km(distance(g.origin, g.dest)) * 1.1 * COMMODITY_INFO[g.commodity].rate;
    this.book('freight', revenue, t);
    this.stats.freightTons += g.tons;
    return revenue;
  }

  /** Hand a group over at its destination; returns the fares it paid. */
  private deliver(t: Train, g: PaxGroup, delay: number): number {
    const wait = g.boarded - g.spawn;
    const distKm = km(distance(g.origin, g.dest)) * 1.15;
    const waitPen = Math.min(30, Math.max(0, (wait - 30) / 6));
    const delayPen = Math.min(40, Math.max(0, (delay - ON_TIME_MIN) / 2));
    const crowdPen = Math.min(35, Math.max(0, (g.loadAtBoard - 1) * 60 * CROWD_TOLERANCE[g.cls]));
    const onTime = delay <= ON_TIME_MIN;
    const h = Math.max(0, Math.min(100, 70 + t.type.comfort - waitPen - delayPen - crowdPen + (onTime ? 10 : 0)));
    this.recordHappiness(h, Math.min(g.count, 400));
    const revenue = g.count * distKm * (t.type.fares[g.cls] ?? 1) * FARE_PER_PAX_KM;
    this.book('fares', revenue, t);
    this.stats.delivered += g.count;
    this.score += Math.round(g.count * (distKm / 100) * (h / 100) * (onTime ? 1.25 : 1));
    return revenue;
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
    // fast lines without automatic train protection see signal incidents
    const unsafe = this.research.done.has('kavach') ? [] : edges.filter((e) => e.kmh > 110);
    if (unsafe.length && Math.random() < 0.45) {
      const e = unsafe[Math.floor(Math.random() * unsafe.length)];
      this.recordHappiness(20, 120);
      return {
        kind: 'incident', title: 'Signal passed at danger', detail: `${city(e.a).name} – ${city(e.b).name} near miss, line held for inquiry. Kavach prevents this.`,
        endsAt: this.time + 5 * 60, edgeId: e.id,
      };
    }
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
    const served = [...new Set(this.servedPairs.map((p) => p.o))];
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
        if (ev.kind === 'incident' && ev.edgeId === e.id) f = Math.min(f, 0.1);
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
      edges: [...this.net.edges.values()].map((e) => [e.a, e.b, e.tracks, e.kmh, e.works, e.dfc]),
      research: { done: [...this.research.done], active: this.research.active },
      trains: [...this.trains.values()].map((t) => t.cfg),
      ledger: this.ledger.toJSON(),
      trainMoney: Object.fromEntries([...this.trains.values()].map((t) => [t.cfg.id, { ledger: t.money.toJSON(), lastTrip: t.lastTripFares }])),
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
      g.stats = { freightTons: 0, ...d.stats };
      g.hSum = d.hSum;
      g.hW = d.hW;
      g.recentArrivals = d.recent ?? [];
      g.nextTrainNum = d.nextTrainNum;
      g.lastHour = Math.floor(g.time / 60);
      g.nextEventAt = g.time + 12 * 60;
      g.ledger = Ledger.from(d.ledger, g.time);
      for (const [a, b, tracks, kmh, works, dfc] of d.edges) g.net.addEdge(a, b, tracks, kmh ?? 110, !!dfc).works = works ?? null;
      g.research = { done: new Set(d.research?.done ?? []), active: d.research?.active ?? null };
      for (const cfg of d.trains as TrainConfig[]) {
        const t = new Train(cfg);
        const money = d.trainMoney?.[cfg.id];
        t.money = Ledger.from(money?.ledger, g.time);
        t.lastTripFares = money?.lastTrip ?? null;
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
