/**
 * Goose HRV v0 — heart-rate-variability metrics from RR intervals.
 *
 * Ported from `goose_hrv_v0` in `docs/rust-reference/src/metrics.rs`. Behaviour is
 * pinned by the golden test in `hrv.test.ts` against the preserved fixture
 * `__fixtures__/synthetic/hrv_goose_v0_hand_derived.*`.
 */
import { mean, pnn50, rmssd, sampleSd } from '../math';
import type { AlgorithmRunResult, MetricComponent } from '../types';

export const GOOSE_HRV_V0_ID = 'goose.hrv.v0';
export const GOOSE_HRV_V0_VERSION = '0.1.0';

/** Valid physiological RR-interval range, in milliseconds (inclusive). */
const VALID_RR_RANGE_MS: readonly [number, number] = [300, 2000];

export interface HrvInput {
  startTime: string;
  endTime: string;
  rrIntervalsMs: number[];
  inputIds: string[];
}

export interface HrvOutput {
  algorithmId: string;
  algorithmVersion: string;
  intervalCount: number;
  validIntervalCount: number;
  invalidIntervalCount: number;
  meanNnMs: number;
  rmssdMs: number;
  sdnnMs: number;
  pnn50Fraction: number;
  components: MetricComponent[];
}

export function gooseHrvV0(input: HrvInput): AlgorithmRunResult<HrvOutput> {
  const qualityFlags: string[] = [];
  const errors: string[] = [];
  const valid: number[] = [];
  let invalidIntervalCount = 0;

  for (const interval of input.rrIntervalsMs) {
    if (
      Number.isFinite(interval) &&
      interval >= VALID_RR_RANGE_MS[0] &&
      interval <= VALID_RR_RANGE_MS[1]
    ) {
      valid.push(interval);
    } else {
      invalidIntervalCount += 1;
    }
  }

  if (invalidIntervalCount > 0) {
    qualityFlags.push('invalid_rr_interval_dropped');
  }
  if (valid.length < 30) {
    qualityFlags.push('low_interval_count');
  }
  if (valid.length < 2) {
    errors.push('not_enough_valid_rr_intervals');
  }

  let output: HrvOutput | null = null;
  if (errors.length === 0) {
    const meanNnMs = mean(valid);
    const rmssdMs = rmssd(valid);
    const sdnnMs = sampleSd(valid, meanNnMs);
    const pnn50Fraction = pnn50(valid);
    output = {
      algorithmId: GOOSE_HRV_V0_ID,
      algorithmVersion: GOOSE_HRV_V0_VERSION,
      intervalCount: input.rrIntervalsMs.length,
      validIntervalCount: valid.length,
      invalidIntervalCount,
      meanNnMs,
      rmssdMs,
      sdnnMs,
      pnn50Fraction,
      components: [
        { name: 'mean_nn', value: meanNnMs, unit: 'ms' },
        { name: 'rmssd', value: rmssdMs, unit: 'ms' },
        { name: 'sdnn', value: sdnnMs, unit: 'ms' },
        { name: 'pnn50', value: pnn50Fraction, unit: 'fraction' },
      ],
    };
  }

  return {
    algorithmId: GOOSE_HRV_V0_ID,
    algorithmVersion: GOOSE_HRV_V0_VERSION,
    family: 'hrv',
    startTime: input.startTime,
    endTime: input.endTime,
    output,
    qualityFlags,
    errors,
    provenance: {
      input_ids: input.inputIds,
      input_interval_count: input.rrIntervalsMs.length,
      valid_rr_range_ms: [VALID_RR_RANGE_MS[0], VALID_RR_RANGE_MS[1]],
      expected_values_policy: 'hand-derived-tests-and-versioned-goose-output',
    },
  };
}
