/** Golden parity test for Goose Strain v0 against the hand-derived Rust fixture. */
import { gooseStrainV0, type StrainInput } from './strain';
import { loadFixture, loadJson } from '../testing/fixtures';

interface StrainInputJson {
  start_time: string;
  end_time: string;
  duration_minutes: number;
  resting_hr_bpm: number;
  average_hr_bpm: number;
  max_hr_bpm: number;
  hr_zone_minutes: number[];
  input_ids: string[];
}

interface StrainExpected {
  algorithm_id: string;
  version: string;
  score_0_to_21: number;
  zone_load: number;
  average_hr_reserve_fraction: number;
}

describe('gooseStrainV0 (golden)', () => {
  it('matches the hand-derived Rust fixture', () => {
    const raw = loadJson<StrainInputJson>('synthetic/strain_goose_v0_hand_derived.json');
    const { expected } = loadFixture<StrainExpected>(
      'synthetic/strain_goose_v0_hand_derived.fixture.json',
    );

    const input: StrainInput = {
      startTime: raw.start_time,
      endTime: raw.end_time,
      durationMinutes: raw.duration_minutes,
      restingHrBpm: raw.resting_hr_bpm,
      averageHrBpm: raw.average_hr_bpm,
      maxHrBpm: raw.max_hr_bpm,
      hrZoneMinutes: raw.hr_zone_minutes,
      inputIds: raw.input_ids,
    };

    const out = gooseStrainV0(input).output!;
    expect(out.algorithmId).toBe(expected.algorithm_id);
    expect(out.algorithmVersion).toBe(expected.version);
    expect(out.score0To21).toBeCloseTo(expected.score_0_to_21, 12);
    expect(out.zoneLoad).toBeCloseTo(expected.zone_load, 12);
    expect(out.averageHrReserveFraction).toBeCloseTo(expected.average_hr_reserve_fraction, 12);
  });
});
