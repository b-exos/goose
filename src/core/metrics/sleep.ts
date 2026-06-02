/**
 * Goose Sleep v0 — weighted sleep score from duration, efficiency, consistency,
 * and disturbances, with unweighted sleep-architecture diagnostics.
 *
 * Ported from `goose_sleep_v0` in `docs/rust-reference/src/metrics.rs`.
 * Pinned by the golden test against `__fixtures__/synthetic/sleep_goose_v0_hand_derived.*`.
 */
import {
  clamp0100,
  clampFraction,
  componentSum,
  requireFiniteNonNegative,
  requireFinitePositive,
  scoreComponent,
  type ScoreComponent,
} from '../scoring';
import type { AlgorithmRunResult } from '../types';

export const GOOSE_SLEEP_V0_ID = 'goose.sleep.v0';
export const GOOSE_SLEEP_V0_VERSION = '0.1.0';

export interface SleepInput {
  startTime: string;
  endTime: string;
  sleepDurationMinutes: number;
  sleepNeedMinutes: number;
  timeInBedMinutes: number;
  midpointDeviationMinutes: number;
  disturbanceCount: number;
  sleepLatencyMinutes: number;
  wakeAfterSleepOnsetMinutes: number;
  wakeEpisodeCount: number;
  stageMinutes: Record<string, number>;
  heartRateDipPercent: number | null;
  inputIds: string[];
}

export interface SleepScoreOutput {
  algorithmId: string;
  algorithmVersion: string;
  score0To100: number;
  sleepPerformanceFraction: number;
  sleepDebtMinutes: number;
  efficiencyFraction: number;
  awakeMinutes: number;
  restorativeSleepMinutes: number;
  restorativeSleepFraction: number;
  sleepLatencyMinutes: number;
  wakeAfterSleepOnsetMinutes: number;
  wakeEpisodeCount: number;
  heartRateDipPercent: number | null;
  components: ScoreComponent[];
}

/** Read a non-negative finite stage value from the stage map, else undefined. */
function stageMinutesOf(map: Record<string, number>, stage: string): number | undefined {
  const v = map[stage];
  return v !== undefined && Number.isFinite(v) && v >= 0 ? v : undefined;
}

export function gooseSleepV0(input: SleepInput): AlgorithmRunResult<SleepScoreOutput> {
  const qualityFlags: string[] = [];
  const errors: string[] = [];

  requireFinitePositive('sleep_need_minutes', input.sleepNeedMinutes, errors);
  requireFinitePositive('time_in_bed_minutes', input.timeInBedMinutes, errors);
  requireFiniteNonNegative('sleep_duration_minutes', input.sleepDurationMinutes, errors);
  requireFiniteNonNegative('midpoint_deviation_minutes', input.midpointDeviationMinutes, errors);
  requireFiniteNonNegative('sleep_latency_minutes', input.sleepLatencyMinutes, errors);
  requireFiniteNonNegative('wake_after_sleep_onset_minutes', input.wakeAfterSleepOnsetMinutes, errors);
  if (input.heartRateDipPercent !== null) {
    requireFiniteNonNegative('heart_rate_dip_percent', input.heartRateDipPercent, errors);
  }
  for (const [stage, minutes] of Object.entries(input.stageMinutes)) {
    if (!Number.isFinite(minutes) || minutes < 0) {
      errors.push(`stage_minutes_${stage}_must_be_finite_non_negative`);
    }
  }

  if (input.sleepDurationMinutes < 180) {
    qualityFlags.push('short_sleep_window');
  }
  if (input.sleepDurationMinutes > input.timeInBedMinutes) {
    qualityFlags.push('duration_exceeds_time_in_bed');
  }
  if (input.sleepLatencyMinutes >= 45) {
    qualityFlags.push('long_sleep_latency');
  }
  if (input.wakeAfterSleepOnsetMinutes >= 45) {
    qualityFlags.push('elevated_wake_after_sleep_onset');
  }
  if (input.wakeEpisodeCount >= 4) {
    qualityFlags.push('fragmented_sleep');
  }
  if (Object.keys(input.stageMinutes).length === 0) {
    qualityFlags.push('sleep_architecture_unavailable');
  }
  if (input.heartRateDipPercent !== null && input.heartRateDipPercent < 8) {
    qualityFlags.push('low_sleep_heart_rate_dip');
  }

  let output: SleepScoreOutput | null = null;
  if (errors.length === 0) {
    const sleepPerformanceFraction = clampFraction(input.sleepDurationMinutes / input.sleepNeedMinutes);
    const durationScore = clamp0100((input.sleepDurationMinutes / input.sleepNeedMinutes) * 100);
    const efficiencyFraction = clampFraction(input.sleepDurationMinutes / input.timeInBedMinutes);
    const efficiencyScore = efficiencyFraction * 100;
    const consistencyScore = clamp0100(100 - (input.midpointDeviationMinutes / 120) * 100);
    const disturbanceScore = clamp0100(100 - input.disturbanceCount * 5);
    const sleepDebtMinutes = Math.max(input.sleepNeedMinutes - input.sleepDurationMinutes, 0);
    const awakeMinutes =
      stageMinutesOf(input.stageMinutes, 'awake') ??
      Math.max(input.timeInBedMinutes - input.sleepDurationMinutes, 0);
    const deepSleepMinutes = stageMinutesOf(input.stageMinutes, 'deep') ?? 0;
    const remSleepMinutes = stageMinutesOf(input.stageMinutes, 'rem') ?? 0;
    const restorativeSleepMinutes = deepSleepMinutes + remSleepMinutes;
    const restorativeSleepFraction = clampFraction(
      restorativeSleepMinutes / Math.max(input.sleepDurationMinutes, 1),
    );
    const stageTotalMinutes = Object.values(input.stageMinutes).reduce((s, v) => s + v, 0);
    if (
      Object.keys(input.stageMinutes).length > 0 &&
      Math.abs(stageTotalMinutes - input.timeInBedMinutes) > 5
    ) {
      qualityFlags.push('stage_minutes_do_not_match_time_in_bed');
    }

    const components = [
      scoreComponent('duration', input.sleepDurationMinutes, 'minutes', durationScore, 0.45, 100),
      scoreComponent('efficiency', efficiencyFraction, 'fraction', efficiencyScore, 0.3, 100),
      scoreComponent('consistency', input.midpointDeviationMinutes, 'minutes_deviation', consistencyScore, 0.15, 100),
      scoreComponent('disturbances', input.disturbanceCount, 'count', disturbanceScore, 0.1, 100),
      scoreComponent('sleep_latency', input.sleepLatencyMinutes, 'minutes', clamp0100(100 - (input.sleepLatencyMinutes / 60) * 100), 0, 100),
      scoreComponent('wake_after_sleep_onset', input.wakeAfterSleepOnsetMinutes, 'minutes', clamp0100(100 - (input.wakeAfterSleepOnsetMinutes / 90) * 100), 0, 100),
      scoreComponent('restorative_sleep', restorativeSleepFraction, 'fraction', restorativeSleepFraction * 100, 0, 100),
    ];

    output = {
      algorithmId: GOOSE_SLEEP_V0_ID,
      algorithmVersion: GOOSE_SLEEP_V0_VERSION,
      score0To100: componentSum(components),
      sleepPerformanceFraction,
      sleepDebtMinutes,
      efficiencyFraction,
      awakeMinutes,
      restorativeSleepMinutes,
      restorativeSleepFraction,
      sleepLatencyMinutes: input.sleepLatencyMinutes,
      wakeAfterSleepOnsetMinutes: input.wakeAfterSleepOnsetMinutes,
      wakeEpisodeCount: input.wakeEpisodeCount,
      heartRateDipPercent: input.heartRateDipPercent,
      components,
    };
  }

  return {
    algorithmId: GOOSE_SLEEP_V0_ID,
    algorithmVersion: GOOSE_SLEEP_V0_VERSION,
    family: 'sleep',
    startTime: input.startTime,
    endTime: input.endTime,
    output,
    qualityFlags,
    errors,
    provenance: {
      input_ids: input.inputIds,
      score_policy:
        'weighted_duration_efficiency_consistency_disturbances_with_unweighted_sleep_architecture_diagnostics',
      expected_values_policy: 'hand-derived-tests-and-versioned-goose-output',
    },
  };
}
