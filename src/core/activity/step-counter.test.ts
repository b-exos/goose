/** Tests for device step-counter aggregation and the daily rollup. */
import {
  rollupStepCounterDay,
  stepCounterConfidence,
  summarizeStepCounterSegments,
  type StepCounterSample,
} from './step-counter';

const sample = (t: number, v: number, extra: Partial<StepCounterSample> = {}): StepCounterSample => ({
  sampleId: `s-${t}`,
  sampleTimeUnixMs: t,
  counterValue: v,
  ...extra,
});

describe('step-counter aggregation', () => {
  it('sums positive counter deltas into steps', () => {
    const summary = summarizeStepCounterSegments([
      sample(0, 100),
      sample(1000, 150),
      sample(2000, 230),
    ]);
    expect(summary.steps).toBe(130);
    expect(summary.usableSegmentCount).toBe(2);
    expect(summary.resetCount).toBe(0);
    expect(summary.qualityFlags).toEqual([]);
  });

  it('detects a counter reset and excludes the negative delta', () => {
    const summary = summarizeStepCounterSegments([
      sample(0, 1000),
      sample(1000, 1050),
      sample(2000, 20), // device reboot -> counter reset
      sample(3000, 70),
    ]);
    expect(summary.steps).toBe(100); // 50 + 50; reset segment excluded
    expect(summary.resetCount).toBe(1);
    expect(summary.qualityFlags).toContain('counter_reset_detected');
  });

  it('flags duplicates and same-timestamp conflicts', () => {
    const summary = summarizeStepCounterSegments([
      sample(0, 100),
      sample(0, 100), // duplicate
      sample(0, 120), // same timestamp, different value -> conflict
      sample(1000, 140),
    ]);
    expect(summary.duplicateSampleCount).toBe(1);
    expect(summary.sameTimestampConflictCount).toBe(1);
    expect(summary.qualityFlags).toEqual(
      ['duplicate_sample', 'same_timestamp_counter_conflict'],
    );
  });

  it('penalizes confidence for resets and conflicts', () => {
    expect(
      stepCounterConfidence({
        steps: 0, usableSegmentCount: 0, resetCount: 0,
        duplicateSampleCount: 0, sameTimestampConflictCount: 0,
        firstCounterValue: null, lastCounterValue: null, qualityFlags: [],
      }),
    ).toBeCloseTo(0.95, 10);
    expect(
      stepCounterConfidence({
        steps: 0, usableSegmentCount: 0, resetCount: 2,
        duplicateSampleCount: 0, sameTimestampConflictCount: 0,
        firstCounterValue: null, lastCounterValue: null, qualityFlags: [],
      }),
    ).toBeCloseTo(0.75, 10); // 0.95 - 0.20
  });

  it('rolls up a day with cadence and passes when enough samples', () => {
    const report = rollupStepCounterDay(
      [
        sample(0, 0, { cadenceSpm: 100 }),
        sample(60_000, 100, { cadenceSpm: 110 }),
        sample(120_000, 250, { cadenceSpm: 120 }),
      ],
      { dateKey: '2026-05-28', timezone: 'America/Phoenix', minSampleCount: 2 },
    );
    expect(report.pass).toBe(true);
    expect(report.steps).toBe(250);
    expect(report.averageCadenceSpm).toBeCloseTo(110, 10);
    expect(report.qualityFlags).toContain('counter_delta');
    expect(report.confidence).toBeCloseTo(0.95, 10);
  });

  it('fails the rollup with too few samples', () => {
    const report = rollupStepCounterDay([sample(0, 0)], {
      dateKey: '2026-05-28',
      timezone: 'America/Phoenix',
      minSampleCount: 2,
    });
    expect(report.pass).toBe(false);
    expect(report.steps).toBeNull();
    expect(report.issues).toContain('insufficient_step_counter_samples');
  });
});
