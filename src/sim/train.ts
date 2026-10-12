import { CAR, PaxClass, TRAIN_TYPE_BY_ID, TrainType, trainCapacity, trainLength } from '../data/trainTypes';
import { KM_PER_UNIT } from '../data/geo';
import { city } from '../data/cities';
import { Network, TrackEdge, km, lineKmh, liveTracks } from './network';
import { Ledger } from './ledger';

export interface TrainConfig {
  id: string;
  number: string;
  name: string;
  typeId: string;
  coaches: number;
  stops: string[];
}

export interface PaxGroup {
  cls: PaxClass;
  origin: string;
  dest: string;
  count: number;
  spawn: number; // game minute the group started waiting
  boarded: number;
  loadAtBoard: number; // load factor (vs seats) when departing
}

export type TrainState = 'dwelling' | 'running';

/** One signal block along a train's path. */
export interface Segment {
  edge: TrackEdge;
  block: number; // block index within the edge, in the edge's a→b order
  dir: 1 | -1;
  start: number; // distance along path
  end: number;
  node: number; // path index of the node this edge starts from
}

const INTERMEDIATE_DWELL = 5;
const TERMINAL_DWELL = 30;
const MIN_INTERMEDIATE_DWELL = 2;
const MIN_TERMINAL_DWELL = 12;
export const ON_TIME_MIN = 5;

/** km/h → world units per game minute */
export function kmhToUpm(kmh: number): number {
  return kmh / KM_PER_UNIT / 60;
}

export class Train {
  readonly type: TrainType;
  readonly length: number;
  readonly capacity: number;

  dir: 1 | -1 = 1;
  path: string[] = [];
  cum: number[] = [];
  /** Indices into `path` of the stops in the current direction. */
  stopIdx: number[] = [];
  nextStop = 0; // index into stopIdx
  pos = 0; // head distance along path
  v = 0; // units / min
  segs: Segment[] = [];
  seg = 0; // block the head is in (or waiting to enter)
  onSeg = false; // head holds the reservation for segs[seg]
  state: TrainState = 'dwelling';
  dwellUntil = 0;
  schedArr = 0; // scheduled arrival at next stop
  schedDep = 0; // scheduled departure from current stop
  delay = 0; // minutes, at last stop
  holding = false; // waiting for a signal (blocked edge)
  passengers: PaxGroup[] = [];
  tripStartedAt = 0;
  /** Fares and running costs booked to this train. */
  money: Ledger;
  tripFares = 0; // fares collected so far on the current end-to-end run
  lastTripFares: number | null = null;

  constructor(public cfg: TrainConfig) {
    const t = TRAIN_TYPE_BY_ID.get(cfg.typeId);
    if (!t) throw new Error(`Unknown train type ${cfg.typeId}`);
    this.type = t;
    this.length = trainLength(cfg.coaches);
    this.capacity = trainCapacity(t, cfg.coaches);
    this.money = new Ledger(0);
  }

  get seats(): number {
    return this.type.seatsPerCoach * this.cfg.coaches;
  }

  get load(): number {
    let n = 0;
    for (const g of this.passengers) n += g.count;
    return n;
  }

  get cruise(): number {
    return kmhToUpm(this.type.cruiseKmh);
  }

  get accel(): number {
    return kmhToUpm(this.type.accelKmhPerMin);
  }

  get decel(): number {
    return this.accel * 1.2;
  }

  /** Stops in the order the train is currently travelling. */
  get dirStops(): string[] {
    return this.dir === 1 ? this.cfg.stops : [...this.cfg.stops].reverse();
  }

  currentStopId(): string {
    return this.path[this.stopIdx[Math.max(0, this.nextStop - (this.state === 'dwelling' ? 0 : 1))]] ?? this.path[0];
  }

  nextStopId(): string {
    return this.path[this.stopIdx[this.nextStop]] ?? this.path[this.path.length - 1];
  }

  /** Top speed on a line right now (train or line limit, whichever is lower), units/min. */
  vmaxOn(e: TrackEdge): number {
    return Math.min(this.cruise, kmhToUpm(lineKmh(e)));
  }

  /**
   * Timetabled minutes between two path indices: each section at its line speed (planned
   * works included), plus a margin and the accel/brake overhead of one stop-to-stop run.
   */
  legTime(net: Network, from: number, to: number): number {
    let t = 0;
    let top = 0;
    for (let i = from + 1; i <= to; i++) {
      const e = net.edge(this.path[i - 1], this.path[i])!;
      const v = this.vmaxOn(e);
      t += e.length / v;
      top = Math.max(top, v);
    }
    return t * 1.06 + top / this.accel + 1;
  }

  /** End-to-end journey minutes including stops, for the current path. */
  journeyTime(net: Network): number {
    let t = 0;
    for (let k = 1; k < this.stopIdx.length; k++) {
      t += this.legTime(net, this.stopIdx[k - 1], this.stopIdx[k]);
      if (k < this.stopIdx.length - 1) t += INTERMEDIATE_DWELL;
    }
    return t;
  }

  /** Average door-to-door speed over the route, km/h. Passengers respond to this. */
  serviceKmh = 0;

  carries(cls: PaxClass): boolean {
    return this.type.fares[cls] !== undefined;
  }

  buildPath(net: Network): boolean {
    const p = net.routePath(this.dirStops, this.type.needsLineKmh ?? 0);
    if (!p) return false;
    this.path = p;
    this.cum = [0];
    this.segs = [];
    for (let i = 1; i < p.length; i++) {
      const e = net.edge(p[i - 1], p[i])!;
      const start = this.cum[i - 1];
      const dir: 1 | -1 = e.a === p[i - 1] ? 1 : -1;
      const bl = e.length / e.blocks;
      for (let k = 0; k < e.blocks; k++) {
        this.segs.push({
          edge: e, dir, node: i - 1,
          block: dir === 1 ? k : e.blocks - 1 - k,
          start: start + k * bl,
          end: k === e.blocks - 1 ? start + e.length : start + (k + 1) * bl,
        });
      }
      this.cum.push(start + e.length);
    }
    const stops = this.dirStops;
    this.stopIdx = [];
    let k = 0;
    for (let i = 0; i < p.length && k < stops.length; i++) {
      if (p[i] === stops[k]) { this.stopIdx.push(i); k++; }
    }
    this.serviceKmh = km(this.totalLen) / (this.journeyTime(net) / 60);
    return true;
  }

  /** Place at origin, ready to depart at `departAt`. */
  start(net: Network, now: number, departAt: number): boolean {
    this.dir = 1;
    if (!this.buildPath(net)) return false;
    this.placeAtOrigin();
    this.v = 0;
    this.nextStop = 1;
    this.state = 'dwelling';
    this.schedDep = departAt;
    this.dwellUntil = departAt;
    this.tripStartedAt = now;
    return true;
  }

  /**
   * Stand the train in the platform at the start of its path: the rake lies along the
   * first line out with its tail at the station, so a reversing push-pull train just
   * changes ends instead of running past the buffers.
   */
  placeAtOrigin() {
    const firstStop = this.cum[this.stopIdx[1]] ?? this.totalLen;
    this.pos = Math.max(0, Math.min(this.length, firstStop - 1));
    this.seg = 0;
    while (this.seg < this.segs.length - 1 && this.segs[this.seg].end <= this.pos) this.seg++;
    this.onSeg = false;
  }

  /** Running cost per game hour. */
  get runningCostPerHour(): number {
    return this.type.opCostPerHour + this.type.opCostPerCoachHour * this.cfg.coaches;
  }

  get totalLen(): number {
    return this.cum[this.cum.length - 1];
  }

  // ---- sampling for rendering ----

  /** World position + heading at distance d along the current path (extrapolates past ends). */
  sample(d: number, net: Network, out: { x: number; z: number; ang: number }) {
    const p = this.path;
    const n = p.length;
    let i: number;
    if (d <= 0) i = 0;
    else if (d >= this.cum[n - 1]) i = n - 2;
    else {
      i = 0;
      while (i < n - 2 && this.cum[i + 1] < d) i++;
    }
    const a = city(p[i]);
    const b = city(p[i + 1]);
    const len = this.cum[i + 1] - this.cum[i];
    const t = (d - this.cum[i]) / len;
    const dx = (b.x - a.x) / len;
    const dz = (b.z - a.z) / len;
    let x = a.x + (b.x - a.x) * t;
    let z = a.z + (b.z - a.z) * t;
    // left-hand running on double track, easing to centre at stations
    const e = net.edge(p[i], p[i + 1]);
    if (e && liveTracks(e) === 2) {
      const along = d - this.cum[i];
      const ease = Math.min(1, Math.max(0, Math.min(along, len - along) / 4));
      const off = CAR.lane * ease * ease * (3 - 2 * ease);
      x += dz * off;
      z += -dx * off;
    }
    out.x = x;
    out.z = z;
    out.ang = Math.atan2(dx, dz);
  }

  /** Centre distances of each car from the head, front to back. */
  carOffsets(): { center: number; len: number; power: boolean }[] {
    const cars: { center: number; len: number; power: boolean }[] = [];
    let d = 0;
    cars.push({ center: d + CAR.powerLen / 2, len: CAR.powerLen, power: true });
    d += CAR.powerLen + CAR.gap;
    for (let i = 0; i < this.cfg.coaches; i++) {
      cars.push({ center: d + CAR.coachLen / 2, len: CAR.coachLen, power: false });
      d += CAR.coachLen + CAR.gap;
    }
    cars.push({ center: d + CAR.powerLen / 2, len: CAR.powerLen, power: true });
    return cars;
  }

  static readonly INTERMEDIATE_DWELL = INTERMEDIATE_DWELL;
  static readonly TERMINAL_DWELL = TERMINAL_DWELL;
  static readonly MIN_INTERMEDIATE_DWELL = MIN_INTERMEDIATE_DWELL;
  static readonly MIN_TERMINAL_DWELL = MIN_TERMINAL_DWELL;
}
