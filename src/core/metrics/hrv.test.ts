/**
 * Golden parity test for Goose HRV v0.
 *
 * Loads the hand-derived input and the expected output the Rust engine produced
 * (preserved in `__fixtures__/synthetic/`) and asserts the TS port reproduces it.
 */
import { gooseHrvV0, type HrvInput } from './hrv';
import { loadFixture, loadJson } from '../testing/fixtures';

interface HrvInputJson {
  start_time: string;
  end_time: string;
  rr_intervals_ms: number[];
  input_ids: string[];
}

interface HrvExpected {
  algorithm_id: string;
  version: string;
  mean_nn_ms: number;
  rmssd_ms: number;
  sdnn_ms: number;
  pnn50_fraction: number;
}

describe('gooseHrvV0 (golden)', () => {
  it('matches the hand-derived Rust fixture', () => {
    const raw = loadJson<HrvInputJson>('synthetic/hrv_goose_v0_hand_derived.json');
    const { expected } = loadFixture<HrvExpected>(
      'synthetic/hrv_goose_v0_hand_derived.fixture.json',
    );

    const input: HrvInput = {
      startTime: raw.start_time,
      endTime: raw.end_time,
      rrIntervalsMs: raw.rr_intervals_ms,
      inputIds: raw.input_ids,
    };

    const result = gooseHrvV0(input);
    expect(result.errors).toEqual([]);
    expect(result.output).not.toBeNull();
    const out = result.output!;

    expect(out.algorithmId).toBe(expected.algorithm_id);
    expect(out.algorithmVersion).toBe(expected.version);
    expect(out.meanNnMs).toBeCloseTo(expected.mean_nn_ms, 12);
    expect(out.rmssdMs).toBeCloseTo(expected.rmssd_ms, 12);
    expect(out.sdnnMs).toBeCloseTo(expected.sdnn_ms, 12);
    expect(out.pnn50Fraction).toBeCloseTo(expected.pnn50_fraction, 12);
  });
});
