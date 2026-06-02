/**
 * Energy (calorie) estimation and rollup confidence.
 *
 * Ported from `resting_kcal`, `active_kcal`, and `energy_confidence`
 * (docs/rust-reference/src/energy_rollup.rs). Active energy is the max of three
 * independent MET-minute estimates (HR-zone, HR-reserve, motion), scaled to kcal.
 */

/** Resting kcal over `minutes`, from a body-weight RMR of ~22 kcal/kg/day. */
export function restingKcal(weightKg: number, minutes: number): number {
  const rmrKcalPerDay = weightKg * 22;
  return (rmrKcalPerDay * Math.max(minutes, 0)) / 1440;
}

export interface ActiveKcalInput {
  weightKg: number;
  coveredMinutes: number;
  hrZoneMinutes: number[];
  averageHrBpm: number | null;
  restingHrBpm: number | null;
  maxHrBpm: number | null;
  averageMotionIntensity0To1: number | null;
}

/** Active kcal: max of HR-zone, HR-reserve, and motion MET-minute estimates × kcal/MET-min. */
export function activeKcal(input: ActiveKcalInput): number {
  const kcalPerMetMinute = (3.5 * input.weightKg) / 200;

  let zoneActiveMetMinutes = 0;
  if (input.hrZoneMinutes.length === 5) {
    const activeMetByZone = [0, 1, 2.5, 5, 8];
    zoneActiveMetMinutes = input.hrZoneMinutes.reduce(
      (sum, minutes, i) => sum + Math.max(minutes, 0) * activeMetByZone[i],
      0,
    );
  }

  let reserveActiveMetMinutes = 0;
  const { averageHrBpm, restingHrBpm, maxHrBpm } = input;
  if (
    averageHrBpm != null &&
    restingHrBpm != null &&
    maxHrBpm != null &&
    maxHrBpm > restingHrBpm
  ) {
    const reserveFraction = Math.min(
      Math.max((averageHrBpm - restingHrBpm) / (maxHrBpm - restingHrBpm), 0),
      1,
    );
    const activeMet = 7 * reserveFraction ** 1.35;
    reserveActiveMetMinutes = activeMet * Math.max(input.coveredMinutes, 0);
  }

  const motionActiveMetMinutes =
    input.averageMotionIntensity0To1 != null
      ? Math.min(Math.max(input.averageMotionIntensity0To1, 0), 1) * 2 * Math.max(input.coveredMinutes, 0)
      : 0;

  const metMinutes = Math.max(zoneActiveMetMinutes, reserveActiveMetMinutes, motionActiveMetMinutes);
  return metMinutes * kcalPerMetMinute;
}

export interface EnergyConfidenceInput {
  hasWeight: boolean;
  hasAge: boolean;
  hasSex: boolean;
  heartRateSampleCount: number;
  minHeartRateSamples: number;
  motionSampleCount: number;
  hasDeviceStepCadenceSupport: boolean;
  coveredMinutes: number;
  requestedMinutes: number;
}

/** Energy rollup confidence in [0.20, 0.90] from profile completeness and coverage. */
export function energyConfidence(input: EnergyConfidenceInput): number {
  const profileScore =
    (input.hasWeight ? 0.2 : 0.04) + (input.hasAge ? 0.04 : 0) + (input.hasSex ? 0.04 : 0);
  const hrScore =
    Math.min(Math.max(input.heartRateSampleCount / (Math.max(input.minHeartRateSamples, 1) * 6), 0), 1) * 0.28;
  const motionScore = input.motionSampleCount > 0 ? 0.12 : 0;
  const stepCadenceScore = input.hasDeviceStepCadenceSupport ? 0.04 : 0;
  const coverageScore =
    input.requestedMinutes > 0
      ? Math.min(Math.max(input.coveredMinutes / input.requestedMinutes, 0), 1) * 0.18
      : 0;
  return Math.min(
    Math.max(0.18 + profileScore + hrScore + motionScore + stepCadenceScore + coverageScore, 0.2),
    0.9,
  );
}

export interface DailyEnergyEstimate {
  activeKcal: number;
  restingKcal: number;
  totalKcal: number;
  confidence: number;
}

/** Combine resting + active kcal into a daily total with confidence. */
export function estimateDailyEnergy(
  active: ActiveKcalInput,
  restingMinutes: number,
  confidence: EnergyConfidenceInput,
): DailyEnergyEstimate {
  const activeKcalValue = activeKcal(active);
  const restingKcalValue = restingKcal(active.weightKg, restingMinutes);
  return {
    activeKcal: activeKcalValue,
    restingKcal: restingKcalValue,
    totalKcal: activeKcalValue + restingKcalValue,
    confidence: energyConfidence(confidence),
  };
}
