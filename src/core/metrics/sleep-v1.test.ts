/**
 * Golden parity test for Goose Sleep V1, mirroring the Rust hand-derived test
 * `goose_sleep_v1_computes_hand_derived_component_score` (metrics_tests.rs).
 */
import { gooseSleepV1, GOOSE_SLEEP_V1_ID, type SleepV1Input } from './sleep-v1';

function input(): SleepV1Input {
  return {
    sleep: {
      startTime: '2026-05-27T22:30:00Z',
      endTime: '2026-05-28T06:30:00Z',
      sleepDurationMinutes: 420,
      sleepNeedMinutes: 480,
      timeInBedMinutes: 480,
      midpointDeviationMinutes: 30,
      disturbanceCount: 4,
      sleepLatencyMinutes: 18,
      wakeAfterSleepOnsetMinutes: 42,
      wakeEpisodeCount: 2,
      stageMinutes: { awake: 60, core: 210, deep: 90, rem: 120 },
      heartRateDipPercent: 12.5,
      inputIds: ['hand-derived.sleep.v1'],
    },
    modelStatus: {
      sleepPermissionGranted: true,
      importedPlatformSleepNights: 10,
      trustedGooseSleepNights: 2,
      motionCoverageFraction: 0.94,
      heartRateCoverageFraction: 0.82,
    },
    priorNights: [],
    rollingSleepDebtMinutes: 90,
    bedtimeDeviationMinutes: 20,
    wakeTimeDeviationMinutes: 15,
    sleepHrAverageBpm: 61,
    sleepHrMinBpm: 54,
    preSleepAwakeHrAverageBpm: null,
    sleepHrTrendBpmPerHour: -1.2,
    napsMinutes: 25,
    priorDayStrain: 8.5,
    dataCoverageFraction: 0.92,
  };
}

describe('gooseSleepV1 (golden)', () => {
  it('reproduces the hand-derived component score', () => {
    const result = gooseSleepV1(input());
    expect(result.errors).toEqual([]);
    expect(result.algorithmId).toBe(GOOSE_SLEEP_V1_ID);
    const out = result.output!;

    expect(out.modelStatus).toBe('baseline_ready');
    expect(out.modelStatusLabel).toBe('Baseline ready');
    expect(out.score0To100).toBeCloseTo(82.01361892264234, 10);
    expect(out.sleepNeedMinutes).toBe(480);
    expect(out.rollingSleepDebtMinutes).toBe(90);
    expect(out.deepSleepMinutes).toBe(90);
    expect(out.remSleepMinutes).toBe(120);
    expect(out.coreSleepMinutes).toBe(210);
    expect(out.sleepHrRecoveryScore).toBeCloseTo(62.5, 10);
    expect(out.dataCoverageFraction).toBe(0.92);
    expect(out.sleepWindowConfidence0To1).toBeCloseTo(0.884, 10);
    expect(out.confidence0To1).toBeGreaterThan(0.75);
    expect(out.statusReport.canShowPersonalBaseline).toBe(true);

    expect(out.components.map((c) => c.name)).toEqual([
      'sleep_need_fulfillment',
      'continuity',
      'schedule_regularity',
      'sleep_architecture',
      'cardiovascular_recovery',
      'context_adjustment',
      'data_confidence',
    ]);
    expect(out.components.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 10);
  });
});
