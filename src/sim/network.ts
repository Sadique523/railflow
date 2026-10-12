import { city } from '../data/cities';
import { KM_PER_UNIT } from '../data/geo';
import { DFC, WORKS_SPEED } from '../data/research';
import { TrainType, isFreight } from '../data/trainTypes';
import { TerrainProfile, terrainProfile } from '../data/terrain';

export type Gauge = 'bg' | 'mg';
/** Metre gauge lines are light, curvy and slow. */
export const MG_KMH = 75;

/**
 * Engineering works on a line: building it, an upgrade to a faster class, doubling, a freight
 * corridor alongside, or converting metre gauge to broad gauge.
 */
export interface Works {
  kind: 'build' | 'upgrade' | 'double' | 'dfc' | 'gauge';
  toKmh?: number; // upgrade target
  start: number; // game minutes
  end: number;
  /** High-speed lines: land is bought first, and its final bill is only known when that is done. */
  landEnd?: number;
  landCost?: number; // the extra to pay when land acquisition finishes
  landPaid?: boolean;
}

export interface TrackEdge {
  id: string;
  a: string;
  b: string;
  length: number; // world units
  tracks: 1 | 2;
  /** Line speed class (max km/h). */
  kmh: number;
  works: Works | null;
  /** A dedicated freight corridor (double track) runs alongside. */
  dfc: boolean;
  gauge: Gauge;
  /** What the line runs through: hard ground caps its speed below high-speed class. */
  terrain: TerrainProfile;
  /** Number of signal blocks; crossing loops sit between them. */
  blocks: number;
  /** Runtime: trains whose head is on this edge: travel direction (+1 = a→b) and block. */
  occupants: Map<string, { dir: 1 | -1; block: number }>;
  /** Runtime: the same for freight trains on the corridor. */
  dfcOccupants: Map<string, { dir: 1 | -1; block: number }>;
  /** Runtime: smoothed share of block capacity in use (0–1+), for the congestion view. */
  util: number;
  /** Runtime: smoothed train-minutes per hour spent held at signals waiting for this line. */
  held: number;
  /** Runtime: event speed multiplier. */
  speedFactor: number;
}

export const TRACK_COST_PER_KM = 0.22; // ₹ Cr, single line
export const DOUBLE_COST_PER_KM = 0.16; // ₹ Cr, doubling an existing line
export const MAX_TRACK_KM = 900;
/** Length of a signal block between crossing loops, in world units (50 km). */
export const BLOCK_UNITS = 50 / KM_PER_UNIT;

export function edgeId(a: string, b: string): string {
  return a < b ? `${a}~${b}` : `${b}~${a}`;
}

export function distance(a: string, b: string): number {
  const ca = city(a);
  const cb = city(b);
  return Math.hypot(ca.x - cb.x, ca.z - cb.z);
}

export function km(units: number): number {
  return units * KM_PER_UNIT;
}

export function trackCost(a: string, b: string): number {
  return km(distance(a, b)) * TRACK_COST_PER_KM;
}

export function doubleCost(e: TrackEdge): number {
  return km(e.length) * DOUBLE_COST_PER_KM;
}

/** Tracks in use: a double line under upgrade works runs on one track while the other is relaid. */
export function liveTracks(e: TrackEdge): 1 | 2 {
  return e.works?.kind === 'upgrade' ? 1 : e.tracks;
}

/**
 * Works on the line itself slow it. Freight corridors and high-speed lines go up alongside on
 * their own alignment, so traffic is undisturbed.
 */
export function slowedByWorks(e: TrackEdge): boolean {
  return (e.works?.kind === 'upgrade' && (e.works.toKmh ?? 0) < 300) || e.works?.kind === 'double';
}

/** Lines being built, or closed for gauge conversion, carry no trains. */
export function isOpen(e: TrackEdge): boolean {
  return e.works?.kind !== 'build' && e.works?.kind !== 'gauge';
}

/** The fastest the line allows, before works and events: its class, held back by gauge and terrain. */
export function lineTopKmh(e: TrackEdge): number {
  if (e.kmh >= 300) return e.kmh; // high-speed lines tunnel through
  let v = e.kmh;
  if (e.gauge === 'mg') v = Math.min(v, MG_KMH);
  if (e.terrain.kmhCap) v = Math.min(v, e.terrain.kmhCap);
  return v;
}

/** Line speed limit in km/h, allowing for works (events are applied separately). */
export function lineKmh(e: TrackEdge): number {
  return lineTopKmh(e) * (slowedByWorks(e) ? WORKS_SPEED : 1);
}

/** How a train type searches for routes. */
export interface RouteMode {
  minKmh?: number; // high-speed trains: only lines at least this fast
  freight?: boolean; // freight uses corridors where there are any
  needsDfc?: boolean; // only lines with a corridor
  gauge?: Gauge; // stay on one gauge (routePath tries broad, then metre)
  anyGauge?: boolean; // diagnostics: ignore breaks of gauge
  includeClosed?: boolean; // diagnostics: include lines being built or converted
}

export function routeMode(t: TrainType): RouteMode {
  return { minKmh: t.needsLineKmh, freight: isFreight(t), needsDfc: t.needsDfc };
}

/** Speed a train of this mode is planned at on a line, km/h. */
export function routeKmh(e: TrackEdge, mode: RouteMode): number {
  return mode.freight && e.dfc ? DFC.kmh : lineKmh(e);
}

export class Network {
  edges = new Map<string, TrackEdge>();
  adj = new Map<string, { edge: TrackEdge; to: string }[]>();

  addEdge(a: string, b: string, tracks: 1 | 2 = 1, kmh = 110, dfc = false, gauge: Gauge = 'bg'): TrackEdge {
    const id = edgeId(a, b);
    const existing = this.edges.get(id);
    if (existing) return existing;
    const length = distance(a, b);
    const e: TrackEdge = {
      id, a, b, length, tracks, kmh, works: null, dfc, gauge, occupants: new Map(), dfcOccupants: new Map(), util: 0, held: 0, speedFactor: 1,
      terrain: terrainProfile(city(a), city(b)),
      blocks: Math.max(1, Math.round(length / BLOCK_UNITS)),
    };
    this.edges.set(id, e);
    this.link(a, e, b);
    this.link(b, e, a);
    return e;
  }

  private link(from: string, edge: TrackEdge, to: string) {
    let list = this.adj.get(from);
    if (!list) this.adj.set(from, (list = []));
    list.push({ edge, to });
  }

  removeEdge(id: string) {
    const e = this.edges.get(id);
    if (!e) return;
    this.edges.delete(id);
    for (const n of [e.a, e.b]) {
      const list = (this.adj.get(n) ?? []).filter((l) => l.edge !== e);
      if (list.length) this.adj.set(n, list);
      else this.adj.delete(n);
    }
  }

  edge(a: string, b: string): TrackEdge | undefined {
    return this.edges.get(edgeId(a, b));
  }

  isConnected(cityId: string): boolean {
    return this.adj.has(cityId);
  }

  /**
   * Dijkstra over running time at line speed, so trains prefer fast lines and divert
   * around works when there is a quicker way. `minKmh` restricts the search to lines at
   * least that fast (high-speed trains).
   */
  shortestPath(a: string, b: string, mode: RouteMode = {}): string[] | null {
    if (a === b) return [a];
    if (!this.adj.has(a) || !this.adj.has(b)) return null;
    const dist = new Map<string, number>([[a, 0]]);
    const prev = new Map<string, string>();
    const open = new Set<string>([a]);
    const done = new Set<string>();
    while (open.size) {
      let cur = '';
      let best = Infinity;
      for (const n of open) {
        const d = dist.get(n)!;
        if (d < best) { best = d; cur = n; }
      }
      open.delete(cur);
      if (cur === b) break;
      done.add(cur);
      for (const { edge, to } of this.adj.get(cur) ?? []) {
        if (done.has(to) || edge.kmh < (mode.minKmh ?? 0) || (mode.needsDfc && !edge.dfc)) continue;
        if ((!mode.includeClosed && !isOpen(edge)) || (mode.gauge && edge.gauge !== mode.gauge)) continue;
        // a little per-section overhead keeps routes from zig-zagging through every junction
        const nd = best + edge.length / routeKmh(edge, mode) + 0.02;
        if (nd < (dist.get(to) ?? Infinity)) {
          dist.set(to, nd);
          prev.set(to, cur);
          open.add(to);
        }
      }
    }
    if (!prev.has(b)) return null;
    const path = [b];
    while (path[0] !== a) path.unshift(prev.get(path[0])!);
    return path;
  }

  /** Full node path through a list of stops, or null if any leg is unreachable. */
  /**
   * A train cannot change gauge, so its whole route is either broad or metre gauge: try
   * broad gauge first, then metre gauge.
   */
  routePath(stops: string[], mode: RouteMode = {}): string[] | null {
    if (mode.gauge || mode.anyGauge) return this.routeOn(stops, mode);
    return this.routeOn(stops, { ...mode, gauge: 'bg' }) ?? this.routeOn(stops, { ...mode, gauge: 'mg' });
  }

  private routeOn(stops: string[], mode: RouteMode): string[] | null {
    if (stops.length < 2) return null;
    const out: string[] = [stops[0]];
    for (let i = 1; i < stops.length; i++) {
      const leg = this.shortestPath(stops[i - 1], stops[i], mode);
      if (!leg) return null;
      out.push(...leg.slice(1));
    }
    return out;
  }

  pathLength(path: string[]): number {
    let d = 0;
    for (let i = 1; i < path.length; i++) d += this.edge(path[i - 1], path[i])!.length;
    return d;
  }
}
