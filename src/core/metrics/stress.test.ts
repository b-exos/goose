/** Golden parity test for Goose Stress v0 against the hand-derived Rust fixture. */
import { gooseStressV0, type StressInput } from './stress';
import { loadFixture, loadJson } from '../testing/fixtures';

interface StressInputJson {
  start_time: string;
  end_time: string;
  heart_rate_bpm: number;
  resting_hr_bpm: number;
  hrv_rmssd_ms: number;
  hrv_baseline_rmssd_ms: number;
  motion_intensity_0_to_1: number;
  input_ids: string[];
}

interface StressExpected {
  algorithm_id: string;
  version: string;
  score_0_to_100: number;
  heart_rate_elevation_score: number;
  hrv_suppression_score: number;
}

describe('gooseStressV0 (golden)', () => {
  it('matches the hand-derived Rust fixture', () => {
    const raw = loadJson<StressInputJson>('synthetic/stress_goose_v0_hand_derived.json');
    const { expected } = loadFixture<StressExpected>(
      'synthetic/stress_goose_v0_hand_derived.fixture.json',
    );

    const input: StressInput = {
      startTime: raw.start_time,
      endTime: raw.end_time,
      heartRateBpm: raw.heart_rate_bpm,
      restingHrBpm: raw.resting_hr_bpm,
      hrvRmssdMs: raw.hrv_rmssd_ms,
      hrvBaselineRmssdMs: raw.hrv_baseline_rmssd_ms,
      motionIntensity0To1: raw.motion_intensity_0_to_1,
      inputIds: raw.input_ids,
    };

    const out = gooseStressV0(input).output!;
    expect(out.algorithmId).toBe(expected.algorithm_id);
    expect(out.algorithmVersion).toBe(expected.version);
    expect(out.score0To100).toBeCloseTo(expected.score_0_to_100, 12);
    expect(out.heartRateElevationScore).toBeCloseTo(expected.heart_rate_elevation_score, 12);
    expect(out.hrvSuppressionScore).toBeCloseTo(expected.hrv_suppression_score, 12);
  });
});
