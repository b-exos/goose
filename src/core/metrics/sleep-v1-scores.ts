/**
 * Sleep V1 component sub-scores (0–100 each), combined by `gooseSleepV1`.
 *
 * Ported from the `sleep_*_score` helpers in `docs/rust-reference/src/metrics.rs`.
 *
 * Scope note: prior-night *baseline personalization* is deferred — `baseline` is treated
 * as null, so the architecture/cardiovascular sub-scores use their population (no-baseline)
 * branches. This matches the Rust output whenever `prior_nights` is empty. The golden test
 * (`sleep-v1.test.ts`) covers exactly that path.
 */
import { clamp0100 } from '../scoring';

/** Sleep-need fulfillment, pressured by rolling debt and discounted by naps. */
export function sleepNeedFulfillmentScore(
  sleepDurationMinutes: number,
  sleepNeedMinutes: number,
  rollingSleepDebtMinutes: number,
  napsMinutes: number,
): number {
  const debtPressure = Math.min(rollingSleepDebtMinutes * 0.2, 120);
  const effectiveNeed = Math.max(
    sleepNeedMinutes + debtPressure - napsMinutes * 0.5,
    sleepNeedMinutes * 0.75,
  );
  return clamp0100((sleepDurationMinutes / effectiveNeed) * 100);
}

/** Continuity from efficiency, latency, wake-after-sleep-onset, and wake episodes. */
export function sleepContinuityScore(
  efficiencyFraction: number,
  sleepLatencyMinutes: number,
  wakeAfterSleepOnsetMinutes: number,
  wakeEpisodeCount: number,
): number {
  const efficiency = clamp0100(((efficiencyFraction - 0.7) / 0.25) * 100);
  const latency = clamp0100(100 - (sleepLatencyMinutes / 60) * 100);
  const waso = clamp0100(100 - (wakeAfterSleepOnsetMinutes / 120) * 100);
  const episodes = clamp0100(100 - (wakeEpisodeCount / 8) * 100);
  return efficiency * 0.4 + latency * 0.2 + waso * 0.25 + episodes * 0.15;
}

/** Schedule regularity from bedtime/wake/midpoint deviations. */
export function sleepScheduleScore(
  bedtimeDeviationMinutes: number,
  wakeTimeDeviationMinutes: number,
  midpointDeviationMinutes: number,
): number {
  const avgDeviation =
    bedtimeDeviationMinutes * 0.35 + wakeTimeDeviationMinutes * 0.35 + midpointDeviationMinutes * 0.3;
  return clamp0100(100 - (avgDeviation / 120) * 100);
}

/** Population (no-baseline) sleep-architecture score from stage minutes. */
export function sleepArchitectureScore(
  stageMinutes: Record<string, number>,
  sleepDurationMinutes: number,
): number {
  if (Object.keys(stageMinutes).length === 0) return 55;
  const deep = stageMinutes.deep ?? 0;
  const rem = stageMinutes.rem ?? 0;
  const core = stageMinutes.core ?? 0;
  const denom = Math.max(sleepDurationMinutes, 1);
  const restorativeFraction = (deep + rem) / denom;
  const coreFraction = core / denom;
  const restorativeScore = clamp0100((restorativeFraction / 0.38) * 100);
  const coreBalanceScore = clamp0100(100 - (Math.abs(coreFraction - 0.55) / 0.35) * 100);
  return restorativeScore * 0.7 + coreBalanceScore * 0.3;
}

function preSleepAwakeHrScore(
  preSleepAwakeHrBpm: number | null | undefined,
  sleepHrBpm: number | null | undefined,
): number | null {
  if (preSleepAwakeHrBpm == null || sleepHrBpm == null) return null;
  const drop = preSleepAwakeHrBpm - sleepHrBpm;
  return clamp0100(
    drop >= 0 ? 70 + (Math.min(drop, 10) / 10) * 30 : 70 + (Math.max(drop, -8) / 8) * 45,
  );
}

function sleepHrTrendScore(
  currentBpmPerHour: number | null | undefined,
  baselineBpmPerHour: number | null,
): number | null {
  if (currentBpmPerHour == null) return null;
  const expected = baselineBpmPerHour ?? 0;
  const excessRise = Math.max(currentBpmPerHour - expected, 0);
  const recoveryDrop = Math.max(expected - currentBpmPerHour, 0);
  return clamp0100(82 - (excessRise / 3) * 62 + (Math.min(recoveryDrop, 2) / 2) * 18);
}

/** Population (no-baseline) cardiovascular-recovery score. */
export function sleepCardiovascularScore(input: {
  heartRateDipPercent: number | null;
  preSleepAwakeHrAverageBpm: number | null;
  sleepHrAverageBpm: number | null;
  sleepHrTrendBpmPerHour: number | null;
}): number {
  const dipScore =
    input.heartRateDipPercent == null ? 60 : clamp0100((input.heartRateDipPercent / 18) * 100);
  const preSleep = preSleepAwakeHrScore(input.preSleepAwakeHrAverageBpm, input.sleepHrAverageBpm);
  const trend = sleepHrTrendScore(input.sleepHrTrendBpmPerHour, null);
  if (trend !== null && preSleep !== null) return dipScore * 0.55 + trend * 0.25 + preSleep * 0.2;
  if (trend !== null && preSleep === null) return dipScore * 0.75 + trend * 0.25;
  if (trend === null && preSleep !== null) return dipScore * 0.7 + preSleep * 0.3;
  return dipScore;
}

/** Context adjustment penalizing high prior-day strain and long naps. */
export function sleepContextScore(
  priorDayStrain: number | null,
  napsMinutes: number,
): number {
  const strainPenalty =
    priorDayStrain == null ? 5 : (Math.max(priorDayStrain - 12, 0) / 9) * 20;
  const napPenalty = (Math.max(napsMinutes - 45, 0) / 90) * 20;
  return clamp0100(100 - strainPenalty - napPenalty);
}
