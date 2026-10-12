// Train presets. Everything a train does is driven by these numbers, so a
// future custom-train editor only needs to produce another TrainType.

/**
 * Who travels. Most Indian rail journeys are unreserved or sleeper class and very price
 * sensitive; a smaller AC slice pays more; a thin premium slice pays most and cares about speed.
 */
export type PaxClass = 'general' | 'ac' | 'premium';
export const PAX_CLASSES: PaxClass[] = ['general', 'ac', 'premium'];
export const PAX_CLASS_INFO: Record<PaxClass, { name: string; share: number; color: string }> = {
  general: { name: 'General & sleeper', share: 0.72, color: '#8a94b0' },
  ac: { name: 'AC', share: 0.21, color: '#3d63d6' },
  premium: { name: 'Premium', share: 0.07, color: '#f2c12e' },
};

export interface TrainType {
  id: string;
  name: string;
  short: string;
  blurb: string;
  cruiseKmh: number;
  accelKmhPerMin: number;
  minCoaches: number;
  maxCoaches: number;
  defaultCoaches: number;
  seatsPerCoach: number;
  /** Max load as a multiple of seats (standing passengers). */
  standingFactor: number;
  /** Added to passenger happiness on every trip. */
  comfort: number;
  /** Classes carried, with the fare multiplier each pays on the base per-km fare. */
  fares: Partial<Record<PaxClass, number>>;
  baseCost: number; // ₹ Cr
  coachCost: number; // ₹ Cr per coach
  opCostPerHour: number; // ₹ Cr / game hour
  opCostPerCoachHour: number;
  accent: string;
  /** Rendered nose shape. */
  nose: 'aero' | 'flat';
  numberPrefix: string;
  /** Research project that unlocks this type; available from the start when absent. */
  research?: string;
  /** Only runs where every section of its route is at least this fast. */
  needsLineKmh?: number;
}

export const TRAIN_TYPES: TrainType[] = [
  {
    id: 'memu', name: 'MEMU Passenger', short: 'MEMU',
    blurb: 'Slow commuter EMU for short hops. Huge standing capacity, quick off the mark, very cheap to run. General class only.',
    cruiseKmh: 80, accelKmhPerMin: 25, minCoaches: 8, maxCoaches: 16, defaultCoaches: 12,
    seatsPerCoach: 90, standingFactor: 2, comfort: -10, fares: { general: 0.6 },
    baseCost: 8, coachCost: 0.8, opCostPerHour: 0.08, opCostPerCoachHour: 0.005,
    accent: '#f2c12e', nose: 'aero', numberPrefix: '6',
  },
  {
    id: 'mail', name: 'Mail / Express', short: 'Express',
    blurb: 'The workhorse. Long rakes of general and sleeper coaches with a few AC coaches. Carries the masses cheaply.',
    cruiseKmh: 110, accelKmhPerMin: 10, minCoaches: 12, maxCoaches: 24, defaultCoaches: 18,
    seatsPerCoach: 72, standingFactor: 1.4, comfort: 0, fares: { general: 1.0, ac: 1.6 },
    baseCost: 15, coachCost: 1.2, opCostPerHour: 0.12, opCostPerCoachHour: 0.01,
    accent: '#24315e', nose: 'flat', numberPrefix: '1',
  },
  {
    id: 'shatabdi', name: 'Shatabdi Express', short: 'Shatabdi',
    blurb: 'Fast day-time AC chair car for intercity hops. Needs LHB coaches.',
    cruiseKmh: 130, accelKmhPerMin: 15, minCoaches: 8, maxCoaches: 20, defaultCoaches: 12,
    seatsPerCoach: 78, standingFactor: 1, comfort: 8, fares: { ac: 1.8, premium: 2.6 },
    baseCost: 25, coachCost: 2, opCostPerHour: 0.18, opCostPerCoachHour: 0.015,
    accent: '#3fa7d6', nose: 'flat', numberPrefix: '12', research: 'lhb',
  },
  {
    id: 'rajdhani', name: 'Rajdhani Express', short: 'Rajdhani',
    blurb: 'Premium AC sleeper for long overnight runs. Fewer berths, high comfort. Needs LHB coaches.',
    cruiseKmh: 130, accelKmhPerMin: 12, minCoaches: 10, maxCoaches: 22, defaultCoaches: 16,
    seatsPerCoach: 54, standingFactor: 1, comfort: 14, fares: { ac: 2.0, premium: 2.8 },
    baseCost: 30, coachCost: 2.5, opCostPerHour: 0.2, opCostPerCoachHour: 0.02,
    accent: '#d0423f', nose: 'flat', numberPrefix: '12', research: 'lhb',
  },
  {
    id: 'vande', name: 'Vande Bharat Express', short: 'Vande Bharat',
    blurb: 'Indigenous semi high-speed trainset. Up to 160 km/h, but only as fast as the line allows.',
    cruiseKmh: 160, accelKmhPerMin: 30, minCoaches: 8, maxCoaches: 16, defaultCoaches: 8,
    seatsPerCoach: 78, standingFactor: 1, comfort: 18, fares: { ac: 2.2, premium: 3.2 },
    baseCost: 45, coachCost: 3.5, opCostPerHour: 0.25, opCostPerCoachHour: 0.025,
    accent: '#3d63d6', nose: 'aero', numberPrefix: '22', research: 'vande',
  },
  {
    id: 'bullet', name: 'Bullet train', short: 'Bullet',
    blurb: 'High-speed trainset at 300 km/h. Runs only on dedicated high-speed lines, end to end. Premium fares.',
    cruiseKmh: 300, accelKmhPerMin: 40, minCoaches: 8, maxCoaches: 16, defaultCoaches: 10,
    seatsPerCoach: 75, standingFactor: 1, comfort: 22, fares: { ac: 3.4, premium: 4.6 },
    baseCost: 120, coachCost: 8, opCostPerHour: 0.5, opCostPerCoachHour: 0.04,
    accent: '#1e9e7a', nose: 'aero', numberPrefix: '0', research: 'hsr', needsLineKmh: 300,
  },
];

export const TRAIN_TYPE_BY_ID = new Map(TRAIN_TYPES.map((t) => [t.id, t]));

export function trainCost(t: TrainType, coaches: number): number {
  return t.baseCost + t.coachCost * coaches;
}

export function trainCapacity(t: TrainType, coaches: number): number {
  return Math.round(t.seatsPerCoach * coaches * t.standingFactor);
}

export function trainSeats(t: TrainType, coaches: number): number {
  return t.seatsPerCoach * coaches;
}

// Visual dimensions (world units)
export const CAR = { powerLen: 1.6, coachLen: 1.1, gap: 0.1, width: 0.66, height: 0.62, lane: 0.62, railTop: 0.345 };

export function trainLength(coaches: number): number {
  // power car at each end + coaches
  return 2 * CAR.powerLen + coaches * CAR.coachLen + (coaches + 1) * CAR.gap;
}
