/**
 * Goose Strain v0 — daily strain from HR-zone load and average HR reserve.
 *
 * Ported from `goose_strain_v0` in `docs/rust-reference/src/metrics.rs`.
 * Pinned by the golden test against `__fixtures__/synthetic/strain_goose_v0_hand_derived.*`.
 */
import {
  clamp0To,
  clampFraction,
  componentSum,
  requireFinitePositive,
  scoreComponent,
  type ScoreComponent,
} from '../scoring';
import type { AlgorithmRunResult } from '../types';

export const GOOSE_STRAIN_V0_ID = 'goose.strain.v0';
export const GOOSE_STRAIN_V0_VERSION = '0.1.0';

/** Per-zone weights applied to minutes-in-zone to produce the weighted zone load. */
const ZONE_WEIGHTS = [1, 2, 3, 4, 5] as const;
const STRAIN_SCALE = 21;

export interface StrainInput {
  startTime: string;
  endTime: string;
  durationMinutes: number;
  restingHrBpm: number;
  averageHrBpm: number;
  maxHrBpm: number;
  hrZoneMinutes: number[];
  inputIds: string[];
}

export interface StrainScoreOutput {
  algorithmId: string;
  algorithmVersion: string;
  score0To21: number;
  zoneLoad: number;
  averageHrReserveFraction: number;
  components: ScoreComponent[];
}

export function gooseStrainV0(input: StrainInput): AlgorithmRunResult<StrainScoreOutput> {
  const qualityFlags: string[] = [];
  const errors: string[] = [];

  requireFinitePositive('duration_minutes', input.durationMinutes, errors);
  requireFinitePositive('resting_hr_bpm', input.restingHrBpm, errors);
  requireFinitePositive('average_hr_bpm', input.averageHrBpm, errors);
  requireFinitePositive('max_hr_bpm', input.maxHrBpm, errors);
  if (input.maxHrBpm <= input.restingHrBpm) {
    errors.push('max_hr_must_exceed_resting_hr');
  }
  if (input.hrZoneMinutes.length !== 5) {
    errors.push('five_hr_zones_required');
  }
  if (input.hrZoneMinutes.some((v) => !Number.isFinite(v) || v < 0)) {
    errors.push('zone_minutes_must_be_finite_non_negative');
  }

  const zoneMinutesSum = input.hrZoneMinutes.reduce((s, v) => s + v, 0);
  if (Math.abs(zoneMinutesSum - input.durationMinutes) > 5) {
    qualityFlags.push('zone_minutes_duration_mismatch');
  }

  let output: StrainScoreOutput | null = null;
  if (errors.length === 0) {
    const zoneLoad = input.hrZoneMinutes.reduce(
      (sum, minutes, i) => sum + minutes * ZONE_WEIGHTS[i],
      0,
    );
    const zoneScore0To21 = clamp0To(STRAIN_SCALE, zoneLoad / 20);
    const hrReserveFraction = clampFraction(
      (input.averageHrBpm - input.restingHrBpm) / (input.maxHrBpm - input.restingHrBpm),
    );
    const zoneScore0To100 = (zoneScore0To21 / STRAIN_SCALE) * 100;
    const avgHrScore0To100 = hrReserveFraction * 100;

    const components = [
      scoreComponent('zone_load', zoneLoad, 'weighted_zone_minutes', zoneScore0To100, 0.7, STRAIN_SCALE),
      scoreComponent('average_hr_reserve', hrReserveFraction, 'fraction', avgHrScore0To100, 0.3, STRAIN_SCALE),
    ];

    output = {
      algorithmId: GOOSE_STRAIN_V0_ID,
      algorithmVersion: GOOSE_STRAIN_V0_VERSION,
      score0To21: componentSum(components),
      zoneLoad,
      averageHrReserveFraction: hrReserveFraction,
      components,
    };
  }

  return {
    algorithmId: GOOSE_STRAIN_V0_ID,
    algorithmVersion: GOOSE_STRAIN_V0_VERSION,
    family: 'strain',
    startTime: input.startTime,
    endTime: input.endTime,
    output,
    qualityFlags,
    errors,
    provenance: {
      input_ids: input.inputIds,
      score_policy: 'weighted_zone_load_and_average_hr_reserve',
      zone_weights: [...ZONE_WEIGHTS],
      expected_values_policy: 'hand-derived-tests-and-versioned-goose-output',
    },
  };
}
