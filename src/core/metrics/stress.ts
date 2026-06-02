/**
 * Goose Stress v0 — instantaneous stress from HR elevation and HRV suppression,
 * discounted by motion context.
 *
 * Ported from `goose_stress_v0` in `docs/rust-reference/src/metrics.rs`.
 * Pinned by the golden test against `__fixtures__/synthetic/stress_goose_v0_hand_derived.*`.
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

export const GOOSE_STRESS_V0_ID = 'goose.stress.v0';
export const GOOSE_STRESS_V0_VERSION = '0.1.0';

/** HR elevation (bpm above resting) that maps to a full 100 elevation score. */
const HR_ELEVATION_FULL_SCALE_BPM = 60;

export interface StressInput {
  startTime: string;
  endTime: string;
  heartRateBpm: number;
  restingHrBpm: number;
  hrvRmssdMs: number;
  hrvBaselineRmssdMs: number;
  motionIntensity0To1: number;
  inputIds: string[];
}

export interface StressScoreOutput {
  algorithmId: string;
  algorithmVersion: string;
  score0To100: number;
  heartRateElevationScore: number;
  hrvSuppressionScore: number;
  motionAdjustedHrScore: number;
  components: ScoreComponent[];
}

export function gooseStressV0(input: StressInput): AlgorithmRunResult<StressScoreOutput> {
  const qualityFlags: string[] = [];
  const errors: string[] = [];

  requireFinitePositive('heart_rate_bpm', input.heartRateBpm, errors);
  requireFinitePositive('resting_hr_bpm', input.restingHrBpm, errors);
  requireFiniteNonNegative('hrv_rmssd_ms', input.hrvRmssdMs, errors);
  requireFinitePositive('hrv_baseline_rmssd_ms', input.hrvBaselineRmssdMs, errors);

  if (input.heartRateBpm < input.restingHrBpm) {
    qualityFlags.push('heart_rate_below_resting');
  }
  if (input.motionIntensity0To1 > 0.7) {
    qualityFlags.push('high_motion_context');
  }
  if (input.motionIntensity0To1 < 0 || input.motionIntensity0To1 > 1) {
    qualityFlags.push('motion_intensity_clamped');
  }

  let output: StressScoreOutput | null = null;
  if (errors.length === 0) {
    const motion = clampFraction(input.motionIntensity0To1);
    const heartRateElevationScore = clamp0100(
      (Math.max(input.heartRateBpm - input.restingHrBpm, 0) / HR_ELEVATION_FULL_SCALE_BPM) * 100,
    );
    const hrvSuppressionScore = clamp0100(
      (1 - input.hrvRmssdMs / input.hrvBaselineRmssdMs) * 100,
    );
    const motionAdjustedHrScore = heartRateElevationScore * (1 - motion * 0.5);

    const components = [
      scoreComponent('motion_adjusted_hr', motionAdjustedHrScore, 'score_0_to_100', motionAdjustedHrScore, 0.6, 100),
      scoreComponent('hrv_suppression', input.hrvRmssdMs, 'ms_rmssd', hrvSuppressionScore, 0.4, 100),
    ];

    output = {
      algorithmId: GOOSE_STRESS_V0_ID,
      algorithmVersion: GOOSE_STRESS_V0_VERSION,
      score0To100: componentSum(components),
      heartRateElevationScore,
      hrvSuppressionScore,
      motionAdjustedHrScore,
      components,
    };
  }

  return {
    algorithmId: GOOSE_STRESS_V0_ID,
    algorithmVersion: GOOSE_STRESS_V0_VERSION,
    family: 'stress',
    startTime: input.startTime,
    endTime: input.endTime,
    output,
    qualityFlags,
    errors,
    provenance: {
      input_ids: input.inputIds,
      score_policy: 'hr_elevation_and_hrv_suppression_with_motion_context',
      expected_values_policy: 'hand-derived-tests-and-versioned-goose-output',
    },
  };
}
