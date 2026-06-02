/** Golden parity test for Goose Sleep v0 against the hand-derived Rust fixture. */
import { gooseSleepV0, type SleepInput } from './sleep';
import { loadFixture, loadJson } from '../testing/fixtures';

interface SleepInputJson {
  start_time: string;
  end_time: string;
  sleep_duration_minutes: number;
  sleep_need_minutes: number;
  time_in_bed_minutes: number;
  midpoint_deviation_minutes: number;
  disturbance_count: number;
  input_ids: string[];
}

interface SleepExpected {
  algorithm_id: string;
  version: string;
  score_0_to_100: number;
  sleep_debt_minutes: number;
  efficiency_fraction: number;
}

describe('gooseSleepV0 (golden)', () => {
  it('matches the hand-derived Rust fixture', () => {
    const raw = loadJson<SleepInputJson>('synthetic/sleep_goose_v0_hand_derived.json');
    const { expected } = loadFixture<SleepExpected>(
      'synthetic/sleep_goose_v0_hand_derived.fixture.json',
    );

    // The fixture omits the #[serde(default)] fields — apply the same defaults.
    const input: SleepInput = {
      startTime: raw.start_time,
      endTime: raw.end_time,
      sleepDurationMinutes: raw.sleep_duration_minutes,
      sleepNeedMinutes: raw.sleep_need_minutes,
      timeInBedMinutes: raw.time_in_bed_minutes,
      midpointDeviationMinutes: raw.midpoint_deviation_minutes,
      disturbanceCount: raw.disturbance_count,
      sleepLatencyMinutes: 0,
      wakeAfterSleepOnsetMinutes: 0,
      wakeEpisodeCount: 0,
      stageMinutes: {},
      heartRateDipPercent: null,
      inputIds: raw.input_ids,
    };

    const out = gooseSleepV0(input).output!;
    expect(out.algorithmId).toBe(expected.algorithm_id);
    expect(out.algorithmVersion).toBe(expected.version);
    expect(out.score0To100).toBeCloseTo(expected.score_0_to_100, 12);
    expect(out.sleepDebtMinutes).toBeCloseTo(expected.sleep_debt_minutes, 12);
    expect(out.efficiencyFraction).toBeCloseTo(expected.efficiency_fraction, 12);
  });
});
