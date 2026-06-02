/**
 * Goose Recovery v0 — weighted interpretable recovery score from HRV, RHR,
 * respiratory rate, skin temperature, sleep score, and prior-day strain.
 *
 * Ported from `goose_recovery_v0` in `docs/rust-reference/src/metrics.rs`.
 * Pinned by the golden test against `__fixtures__/synthetic/recovery_goose_v0_hand_derived.*`.
 */
import {
  clamp0100,
  componentSum,
  requireBounded,
  requireFiniteNonNegative,
  requireFinitePositive,
  scoreComponent,
  type ScoreComponent,
} from '../scoring';
import type { AlgorithmRunResult } from '../types';

export const GOOSE_RECOVERY_V0_ID = 'goose.recovery.v0';
export const GOOSE_RECOVERY_V0_VERSION = '0.1.0';

export interface RecoveryInput {
  startTime: string;
  endTime: string;
  hrvRmssdMs: number;
  hrvBaselineRmssdMs: number;
  restingHrBpm: number;
  restingHrBaselineBpm: number;
  respiratoryRateRpm: number;
  respiratoryRateBaselineRpm: number;
  skinTempDeltaC: number;
  sleepScore0To100: number;
  priorStrain0To21: number;
  inputIds: string[];
}

export interface RecoveryScoreOutput {
  algorithmId: string;
  algorithmVersion: string;
  score0To100: number;
  components: ScoreComponent[];
}

export function gooseRecoveryV0(
  input: RecoveryInput,
): AlgorithmRunResult<RecoveryScoreOutput> {
  const qualityFlags: string[] = [];
  const errors: string[] = [];

  requireFinitePositive('hrv_baseline_rmssd_ms', input.hrvBaselineRmssdMs, errors);
  requireFinitePositive('resting_hr_baseline_bpm', input.restingHrBaselineBpm, errors);
  requireFinitePositive('respiratory_rate_baseline_rpm', input.respiratoryRateBaselineRpm, errors);
  requireFiniteNonNegative('hrv_rmssd_ms', input.hrvRmssdMs, errors);
  requireFinitePositive('resting_hr_bpm', input.restingHrBpm, errors);
  requireFinitePositive('respiratory_rate_rpm', input.respiratoryRateRpm, errors);
  requireBounded('sleep_score_0_to_100', input.sleepScore0To100, 0, 100, errors);
  requireBounded('prior_strain_0_to_21', input.priorStrain0To21, 0, 21, errors);

  if (input.sleepScore0To100 < 60) {
    qualityFlags.push('low_sleep_score');
  }
  if (input.priorStrain0To21 > 14) {
    qualityFlags.push('high_prior_strain');
  }

  let output: RecoveryScoreOutput | null = null;
  if (errors.length === 0) {
    const hrvScore = clamp0100(70 + (input.hrvRmssdMs / input.hrvBaselineRmssdMs - 1) * 100);
    const rhrScore = clamp0100(70 + (input.restingHrBaselineBpm - input.restingHrBpm) * 5);
    const respiratoryScore = clamp0100(
      100 - Math.abs(input.respiratoryRateRpm - input.respiratoryRateBaselineRpm) * 20,
    );
    const temperatureScore = clamp0100(100 - Math.abs(input.skinTempDeltaC) * 50);
    const strainReadinessScore = clamp0100(100 - (input.priorStrain0To21 / 21) * 60);

    const components = [
      scoreComponent('hrv', input.hrvRmssdMs, 'ms_rmssd', hrvScore, 0.35, 100),
      scoreComponent('rhr', input.restingHrBpm, 'bpm', rhrScore, 0.2, 100),
      scoreComponent('respiratory', input.respiratoryRateRpm, 'breaths_per_minute', respiratoryScore, 0.1, 100),
      scoreComponent('temperature', input.skinTempDeltaC, 'celsius_delta', temperatureScore, 0.1, 100),
      scoreComponent('sleep', input.sleepScore0To100, 'score_0_to_100', input.sleepScore0To100, 0.15, 100),
      scoreComponent('prior_strain', input.priorStrain0To21, 'score_0_to_21', strainReadinessScore, 0.1, 100),
    ];

    output = {
      algorithmId: GOOSE_RECOVERY_V0_ID,
      algorithmVersion: GOOSE_RECOVERY_V0_VERSION,
      score0To100: componentSum(components),
      components,
    };
  }

  return {
    algorithmId: GOOSE_RECOVERY_V0_ID,
    algorithmVersion: GOOSE_RECOVERY_V0_VERSION,
    family: 'recovery',
    startTime: input.startTime,
    endTime: input.endTime,
    output,
    qualityFlags,
    errors,
    provenance: {
      input_ids: input.inputIds,
      score_policy: 'weighted_interpretable_recovery_components',
      official_labels_policy: 'not_used_unless_explicit_calibration_label',
      expected_values_policy: 'hand-derived-tests-and-versioned-goose-output',
    },
  };
}
