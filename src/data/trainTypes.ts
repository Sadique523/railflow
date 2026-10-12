// Train presets. Everything a train does is driven by these numbers, so a
// future custom-train editor only needs to produce another TrainType.

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
  /** Fare multiplier on the base per-km fare. */
  fareMult: number;
  baseCost: number; // ₹ Cr
  coachCost: number; // ₹ Cr per coach
  opCostPerHour: number; // ₹ Cr / game hour
  opCostPerCoachHour: number;
  accent: string;
  /** Rendered nose shape. */
  nose: 'aero' | 'flat';
  numberPrefix: string;
}

export const TRAIN_TYPES: TrainType[] = [
  {
    id: 'vande', name: 'Vande Bharat Express', short: 'Vande Bharat',
    blurb: 'Semi high-speed chair car. Fastest and most comfortable, but expensive.',
    cruiseKmh: 130, accelKmhPerMin: 30, minCoaches: 8, maxCoaches: 16, defaultCoaches: 8,
    seatsPerCoach: 78, standingFactor: 1, comfort: 18, fareMult: 2.2,
    baseCost: 45, coachCost: 3.5, opCostPerHour: 0.25, opCostPerCoachHour: 0.025,
    accent: '#3d63d6', nose: 'aero', numberPrefix: '22',
  },
  {
    id: 'rajdhani', name: 'Rajdhani Express', short: 'Rajdhani',
    blurb: 'Premium overnight sleeper linking the capital. High comfort, fewer berths.',
    cruiseKmh: 120, accelKmhPerMin: 12, minCoaches: 10, maxCoaches: 22, defaultCoaches: 16,
    seatsPerCoach: 54, standingFactor: 1, comfort: 14, fareMult: 2.0,
    baseCost: 30, coachCost: 2.5, opCostPerHour: 0.2, opCostPerCoachHour: 0.02,
    accent: '#d0423f', nose: 'flat', numberPrefix: '12',
  },
  {
    id: 'shatabdi', name: 'Shatabdi Express', short: 'Shatabdi',
    blurb: 'Fast day-time chair car for short intercity hops.',
    cruiseKmh: 115, accelKmhPerMin: 15, minCoaches: 8, maxCoaches: 20, defaultCoaches: 12,
    seatsPerCoach: 78, standingFactor: 1, comfort: 8, fareMult: 1.5,
    baseCost: 25, coachCost: 2, opCostPerHour: 0.18, opCostPerCoachHour: 0.015,
    accent: '#3fa7d6', nose: 'flat', numberPrefix: '12',
  },
  {
    id: 'mail', name: 'Mail / Express', short: 'Express',
    blurb: 'The workhorse. Long rakes, cheap fares, crowded general coaches.',
    cruiseKmh: 90, accelKmhPerMin: 10, minCoaches: 12, maxCoaches: 24, defaultCoaches: 18,
    seatsPerCoach: 72, standingFactor: 1.4, comfort: 0, fareMult: 1.0,
    baseCost: 15, coachCost: 1.2, opCostPerHour: 0.12, opCostPerCoachHour: 0.01,
    accent: '#24315e', nose: 'flat', numberPrefix: '1',
  },
  {
    id: 'memu', name: 'MEMU Passenger', short: 'MEMU',
    blurb: 'Slow commuter EMU. Huge standing capacity, quick to accelerate, very cheap.',
    cruiseKmh: 70, accelKmhPerMin: 25, minCoaches: 8, maxCoaches: 16, defaultCoaches: 12,
    seatsPerCoach: 90, standingFactor: 2, comfort: -10, fareMult: 0.5,
    baseCost: 8, coachCost: 0.8, opCostPerHour: 0.08, opCostPerCoachHour: 0.005,
    accent: '#f2c12e', nose: 'aero', numberPrefix: '6',
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
