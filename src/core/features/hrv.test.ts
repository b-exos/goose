/** Tests for HRV feature aggregation, daily RMSSD, and the median baseline. */
import { aggregateHrv, dailyHrvFeatures, hrvBaseline, type HrvFeatureSample } from './hrv';

const sample = (id: string, capturedAt: string, rr: number[]): HrvFeatureSample => ({
  metricInputId: id,
  capturedAt,
  rrIntervalsMs: rr,
});

describe('hrv features', () => {
  it('aggregates RR intervals and runs HRV v0', () => {
    const result = aggregateHrv(
      [sample('a', '2026-05-27T00:00:00Z', [800, 810]), sample('b', '2026-05-27T00:01:00Z', [790, 800])],
      '2026-05-27T00:00:00Z',
      '2026-05-27T00:02:00Z',
      4,
    );
    expect(result).not.toBeNull();
    // same four intervals as the HRV golden fixture -> rmssd sqrt(200)
    expect(result!.output!.rmssdMs).toBeCloseTo(14.142135623730951, 10);
  });

  it('returns null below the RR threshold', () => {
    expect(aggregateHrv([sample('a', '2026-05-27T00:00:00Z', [800, 810])], 's', 'e', 4)).toBeNull();
  });

  it('computes one daily feature per date', () => {
    const days = dailyHrvFeatures(
      [
        sample('a', '2026-05-27T22:00:00Z', [800, 810, 790, 800]),
        sample('b', '2026-05-28T22:00:00Z', [900, 910, 890, 900]),
      ],
      4,
    );
    expect(days.map((d) => d.date)).toEqual(['2026-05-27', '2026-05-28']);
    expect(days[0].rmssdMs).toBeCloseTo(14.142135623730951, 10);
  });

  it('derives a median-RMSSD baseline once enough days exist', () => {
    const daily = [
      { date: '2026-05-25', rmssdMs: 40, rrIntervalCount: 10, trustedMetricInput: true, inputIds: [] },
      { date: '2026-05-26', rmssdMs: 50, rrIntervalCount: 10, trustedMetricInput: true, inputIds: [] },
      { date: '2026-05-27', rmssdMs: 60, rrIntervalCount: 10, trustedMetricInput: true, inputIds: [] },
    ];
    expect(hrvBaseline(daily, 3)?.hrvBaselineRmssdMs).toBe(50);
    expect(hrvBaseline(daily, 5)).toBeNull();
  });
});
