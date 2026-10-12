// The research tree follows how Indian Railways actually got faster: better coaches first,
// then track fit for higher speeds, safety systems before going past 130 km/h, home-grown
// semi high-speed trainsets, and finally dedicated high-speed lines.

export interface ResearchProject {
  id: string;
  name: string;
  blurb: string;
  cost: number; // ₹ Cr, paid up front
  hours: number; // game hours to complete
  requires: string[];
  unlocks: string;
}

export const RESEARCH: ResearchProject[] = [
  {
    id: 'lhb', name: 'LHB coaches', cost: 40, hours: 18, requires: [],
    blurb: 'Lighter, safer German-designed coaches built in India. The basis for faster premium trains.',
    unlocks: 'Shatabdi and Rajdhani Express',
  },
  {
    id: 'track130', name: '130 km/h track', cost: 60, hours: 24, requires: ['lhb'],
    blurb: 'Heavier rails, deeper ballast and fenced curves. Lines can be upgraded from 110 to 130 km/h.',
    unlocks: 'Line upgrade to 130 km/h',
  },
  {
    id: 'kavach', name: 'Kavach train protection', cost: 70, hours: 24, requires: ['track130'],
    blurb: 'Automatic train protection that brakes for the driver. Without it, fast lines see signal incidents.',
    unlocks: 'Safe running above 110 km/h',
  },
  {
    id: 'vande', name: 'Vande Bharat trainsets', cost: 120, hours: 36, requires: ['track130'],
    blurb: 'A self-propelled trainset designed and built at ICF Chennai. Fast acceleration, 160 km/h capable.',
    unlocks: 'Vande Bharat Express',
  },
  {
    id: 'track160', name: '160 km/h track', cost: 150, hours: 36, requires: ['kavach'],
    blurb: 'Mission Raftaar: track, signalling and level-crossing removal for 160 km/h running.',
    unlocks: 'Line upgrade to 160 km/h',
  },
  {
    id: 'hsr', name: 'High-speed rail', cost: 400, hours: 72, requires: ['track160', 'vande'],
    blurb: 'Dedicated standard-gauge high-speed lines on viaducts. Hugely expensive and slow to build.',
    unlocks: 'High-speed lines (300 km/h) and the bullet train',
  },
  {
    id: 'wag12', name: 'WAG-12 locomotives', cost: 80, hours: 24, requires: [],
    blurb: '12,000 hp twin-section electric locomotives for heavier, faster bulk trains.',
    unlocks: 'Heavy haul freight trains',
  },
  {
    id: 'dfc', name: 'Dedicated freight corridors', cost: 140, hours: 48, requires: [],
    blurb: 'A separate double-track freight railway built alongside an existing line. Freight stops blocking passenger trains.',
    unlocks: 'Building freight corridors along your lines',
  },
  {
    id: 'doublestack', name: 'Double-stack containers', cost: 90, hours: 30, requires: ['dfc'],
    blurb: 'High-rise overhead wires on the corridors let wagons carry two containers stacked.',
    unlocks: 'Double-stack container trains',
  },
];

/** Freight corridor alongside a line: ₹ Cr per km, km built per day, upkeep per km per day. */
export const DFC = { costPerKm: 0.3, kmPerDay: 120, upkeepPerKmDay: 0.004, kmh: 100, color: '#c77a2e' };

/** Sideways distance from a line's centre to its freight corridor's centre (world units). */
export function dfcOffset(tracks: 1 | 2): number {
  return (tracks === 2 ? 3.4 : 2.3) / 2 + 1.9;
}

export const RESEARCH_BY_ID = new Map(RESEARCH.map((r) => [r.id, r]));

/** Line speed classes, in upgrade order. */
export interface LineClass {
  kmh: number;
  name: string;
  research?: string;
  /** ₹ Cr per km to upgrade to this class from the one below. */
  costPerKm: number;
  /** Track km the works crews get through per game day. */
  kmPerDay: number;
  /** Upkeep, ₹ Cr per km per game day. */
  upkeepPerKmDay: number;
  color: string; // formation colour
}

export const LINE_CLASSES: LineClass[] = [
  { kmh: 110, name: 'Conventional', costPerKm: 0, kmPerDay: 0, upkeepPerKmDay: 0.003, color: '#4169dc' },
  { kmh: 130, name: '130 km/h', research: 'track130', costPerKm: 0.06, kmPerDay: 220, upkeepPerKmDay: 0.004, color: '#2b8fd6' },
  { kmh: 160, name: '160 km/h', research: 'track160', costPerKm: 0.12, kmPerDay: 140, upkeepPerKmDay: 0.0055, color: '#1d2340' },
  { kmh: 300, name: 'High-speed', research: 'hsr', costPerKm: 0.9, kmPerDay: 45, upkeepPerKmDay: 0.012, color: '#e9ecf3' },
];

export function lineClass(kmh: number): LineClass {
  return LINE_CLASSES.find((c) => c.kmh === kmh) ?? LINE_CLASSES[0];
}

export function nextLineClass(kmh: number): LineClass | undefined {
  return LINE_CLASSES[LINE_CLASSES.findIndex((c) => c.kmh === kmh) + 1];
}

/** Doubling works: track km per game day. */
export const DOUBLING_KM_PER_DAY = 160;
/** Line speed while works are on, as a share of normal. */
export const WORKS_SPEED = 0.25;
