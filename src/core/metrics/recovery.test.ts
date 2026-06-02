/** Golden parity test for Goose Recovery v0 against the hand-derived Rust fixture. */
import { gooseRecoveryV0, type RecoveryInput } from './recovery';
import { loadFixture, loadJson } from '../testing/fixtures';

interface RecoveryInputJson {
  start_time: string;
  end_time: string;
  hrv_rmssd_ms: number;
  hrv_baseline_rmssd_ms: number;
  resting_hr_bpm: number;
  resting_hr_baseline_bpm: number;
  respiratory_rate_rpm: number;
  respiratory_rate_baseline_rpm: number;
  skin_temp_delta_c: number;
  sleep_score_0_to_100: number;
  prior_strain_0_to_21: number;
  input_ids: string[];
}

interface RecoveryExpected {
  algorithm_id: string;
  version: string;
  score_0_to_100: number;
  component_count: number;
}

describe('gooseRecoveryV0 (golden)', () => {
  it('matches the hand-derived Rust fixture', () => {
    const raw = loadJson<RecoveryInputJson>('synthetic/recovery_goose_v0_hand_derived.json');
    const { expected } = loadFixture<RecoveryExpected>(
      'synthetic/recovery_goose_v0_hand_derived.fixture.json',
    );

    const input: RecoveryInput = {
      startTime: raw.start_time,
      endTime: raw.end_time,
      hrvRmssdMs: raw.hrv_rmssd_ms,
      hrvBaselineRmssdMs: raw.hrv_baseline_rmssd_ms,
      restingHrBpm: raw.resting_hr_bpm,
      restingHrBaselineBpm: raw.resting_hr_baseline_bpm,
      respiratoryRateRpm: raw.respiratory_rate_rpm,
      respiratoryRateBaselineRpm: raw.respiratory_rate_baseline_rpm,
      skinTempDeltaC: raw.skin_temp_delta_c,
      sleepScore0To100: raw.sleep_score_0_to_100,
      priorStrain0To21: raw.prior_strain_0_to_21,
      inputIds: raw.input_ids,
    };

    const out = gooseRecoveryV0(input).output!;
    expect(out.algorithmId).toBe(expected.algorithm_id);
    expect(out.algorithmVersion).toBe(expected.version);
    expect(out.score0To100).toBeCloseTo(expected.score_0_to_100, 12);
    expect(out.components).toHaveLength(expected.component_count);
  });
});
