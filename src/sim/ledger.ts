// Money book-keeping: every change to funds is booked under a flow, per game hour.

export type Flow = 'fares' | 'running' | 'upkeep' | 'track' | 'trains' | 'research' | 'sales';
export const FLOWS: Flow[] = ['fares', 'running', 'upkeep', 'track', 'trains', 'research', 'sales'];

export type Sums = Record<Flow, number>;

export interface Bucket extends Sums {
  hour: number; // game hour index (minutes / 60, floored)
}

const KEEP_HOURS = 48;

export const zero = (): Sums => ({ fares: 0, running: 0, upkeep: 0, track: 0, trains: 0, research: 0, sales: 0 });

export class Ledger {
  /** Oldest first; hours with no money movement are left out. */
  hours: Bucket[] = [];
  total: Sums = zero();

  constructor(public since: number) {}

  /** Book a signed amount (income positive, spending negative). */
  add(flow: Flow, amount: number, time: number) {
    const hour = Math.floor(time / 60);
    let b = this.hours[this.hours.length - 1];
    if (!b || b.hour !== hour) {
      b = { hour, ...zero() };
      this.hours.push(b);
      while (this.hours.length && this.hours[0].hour <= hour - KEEP_HOURS) this.hours.shift();
    }
    b[flow] += amount;
    this.total[flow] += amount;
  }

  /** Totals over the last `hours` game hours, including the current one. */
  window(now: number, hours: number): Sums {
    const from = Math.floor(now / 60) - hours + 1;
    const s = zero();
    for (const b of this.hours) if (b.hour >= from) for (const f of FLOWS) s[f] += b[f];
    return s;
  }

  /** Per-hour series for the last `hours` hours, oldest first, with empty hours filled in. */
  series(now: number, hours: number): Bucket[] {
    const last = Math.floor(now / 60);
    const by = new Map(this.hours.map((b) => [b.hour, b]));
    const out: Bucket[] = [];
    for (let h = last - hours + 1; h <= last; h++) out.push(by.get(h) ?? { hour: h, ...zero() });
    return out;
  }

  /**
   * Average operating profit (fares less running costs and track upkeep) per game hour
   * over the last `hours` hours, or over the ledger's lifetime if it is younger.
   */
  operatingRate(now: number, hours = 6): number {
    const span = Math.min(hours - 1 + ((now / 60) % 1), (now - this.since) / 60);
    if (span < 0.25) return 0;
    const s = this.window(now, hours);
    return (s.fares + s.running + s.upkeep) / span;
  }

  toJSON() {
    return { since: this.since, hours: this.hours, total: this.total };
  }

  static from(d: { since: number; hours: Bucket[]; total: Sums } | undefined, fallbackSince: number): Ledger {
    const l = new Ledger(d?.since ?? fallbackSince);
    if (d) {
      l.hours = d.hours.map((b) => ({ ...zero(), ...b })); // older saves lack newer flows
      l.total = { ...zero(), ...d.total };
    }
    return l;
  }
}
