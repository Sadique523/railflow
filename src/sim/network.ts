import { city } from '../data/cities';
import { KM_PER_UNIT } from '../data/geo';

export interface TrackEdge {
  id: string;
  a: string;
  b: string;
  length: number; // world units
  tracks: 1 | 2;
  /** Number of signal blocks; crossing loops sit between them. */
  blocks: number;
  /** Runtime: trains whose head is on this edge: travel direction (+1 = a→b) and block. */
  occupants: Map<string, { dir: 1 | -1; block: number }>;
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

export class Network {
  edges = new Map<string, TrackEdge>();
  adj = new Map<string, { edge: TrackEdge; to: string }[]>();

  addEdge(a: string, b: string, tracks: 1 | 2 = 1): TrackEdge {
    const id = edgeId(a, b);
    const existing = this.edges.get(id);
    if (existing) return existing;
    const length = distance(a, b);
    const e: TrackEdge = {
      id, a, b, length, tracks, occupants: new Map(), speedFactor: 1,
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

  /** Dijkstra over track length. Returns node list a..b or null. */
  shortestPath(a: string, b: string): string[] | null {
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
        if (done.has(to)) continue;
        const nd = best + edge.length;
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
  routePath(stops: string[]): string[] | null {
    if (stops.length < 2) return null;
    const out: string[] = [stops[0]];
    for (let i = 1; i < stops.length; i++) {
      const leg = this.shortestPath(stops[i - 1], stops[i]);
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
