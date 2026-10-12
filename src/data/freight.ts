// Freight. Indian Railways earns most of its money hauling coal, ore, steel, grain and
// containers, and uses it to keep passenger fares low. Flows follow real geography: coal
// from the Jharkhand/Chhattisgarh fields to power stations, steel from the eastern plants,
// wheat and rice out of Punjab and Madhya Pradesh, containers between ports and inland depots.

export type Commodity = 'coal' | 'steel' | 'grain' | 'containers';
export const COMMODITIES: Commodity[] = ['coal', 'steel', 'grain', 'containers'];

export interface CommodityInfo {
  name: string;
  color: string; // wagon load and UI colour
  /** ₹ Cr per tonne-km. */
  rate: number;
  /** Where it is loaded, with relative output. */
  sources: Record<string, number>;
  /** Where it is wanted, with relative demand. */
  sinks: Record<string, number>;
}

const PORTS = { CSMT: 10, RJT: 6, MAS: 6, VSKP: 4, HWH: 4 }; // JNPT, Mundra/Kandla, Chennai, Vizag, Haldia
const DEPOTS = { NDLS: 8, LDH: 4, ADI: 4, SBC: 4, HYB: 3, NGP: 3, PUNE: 3, JP: 2, CNB: 2 };

export const COMMODITY_INFO: Record<Commodity, CommodityInfo> = {
  coal: {
    name: 'Coal', color: '#2b2d38', rate: 0.000032,
    sources: { DHN: 10, R: 8, RNC: 6, NGP: 4 },
    sinks: { NDLS: 6, CNB: 4, PRYJ: 3, CSMT: 4, ADI: 4, LDH: 3, MAS: 3, BZA: 3, BPL: 2, PNBE: 2, HWH: 3 },
  },
  steel: {
    name: 'Steel & ore', color: '#8a94b0', rate: 0.000042,
    sources: { RNC: 5, R: 5, BBS: 4, VSKP: 4 },
    sinks: { CSMT: 4, NDLS: 4, MAS: 3, ADI: 3, HWH: 3, SBC: 2, HYB: 2, LDH: 2, VSKP: 2 },
  },
  grain: {
    name: 'Grain', color: '#d9a43a', rate: 0.000028,
    sources: { LDH: 8, ASR: 6, CDG: 3, BPL: 3, KOTA: 2, LKO: 2 },
    sinks: { MAS: 4, HWH: 4, SBC: 3, HYB: 3, PNBE: 3, GHY: 3, TVC: 3, ERS: 2, BBS: 2, CSMT: 2 },
  },
  containers: {
    name: 'Containers', color: '#d0423f', rate: 0.00005,
    sources: { ...PORTS, ...DEPOTS },
    sinks: { ...PORTS, ...DEPOTS },
  },
};

/** Weight of the flow of a commodity from `o` to `d` (0 if there is none). */
export function flowWeight(c: Commodity, o: string, d: string): number {
  const info = COMMODITY_INFO[c];
  const wo = info.sources[o];
  const wd = info.sinks[d];
  if (!wo || !wd || o === d) return 0;
  // containers move between a port and an inland depot, in either direction
  if (c === 'containers' && (o in PORTS) === (d in PORTS)) return 0;
  return Math.sqrt(wo * wd);
}

/** Commodities a city loads or receives, for the station panel. */
export function cityFreight(id: string): { loads: Commodity[]; receives: Commodity[] } {
  return {
    loads: COMMODITIES.filter((c) => COMMODITY_INFO[c].sources[id]),
    receives: COMMODITIES.filter((c) => COMMODITY_INFO[c].sinks[id]),
  };
}
