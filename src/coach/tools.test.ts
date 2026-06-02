/** Tests that coach tools invoke the ported (golden) metric algorithms. */
import { executeCoachTool } from './tools';

describe('executeCoachTool', () => {
  it('compute_hrv returns RMSSD from RR intervals', () => {
    const out = executeCoachTool('compute_hrv', { rrIntervalsMs: [800, 810, 790, 800] }) as { rmssdMs: number };
    expect(out.rmssdMs).toBeCloseTo(14.142135623730951, 9);
  });

  it('compute_recovery matches the golden recovery score', () => {
    const out = executeCoachTool('compute_recovery', {
      hrvRmssdMs: 50,
      hrvBaselineRmssdMs: 50,
      restingHrBpm: 60,
      restingHrBaselineBpm: 60,
      respiratoryRateRpm: 14,
      respiratoryRateBaselineRpm: 14,
      skinTempDeltaC: 0,
      sleepScore0To100: 80,
      priorStrain0To21: 10.5,
    }) as { score0To100: number };
    expect(out.score0To100).toBeCloseTo(77.5, 9);
  });

  it('compute_strain matches the golden strain score', () => {
    const out = executeCoachTool('compute_strain', {
      durationMinutes: 60,
      restingHrBpm: 60,
      averageHrBpm: 120,
      maxHrBpm: 180,
      hrZoneMinutes: [10, 20, 30, 0, 0],
    }) as { score0To21: number };
    expect(out.score0To21).toBeCloseTo(8.05, 9);
  });

  it('throws for an unknown tool', () => {
    expect(() => executeCoachTool('nope', {})).toThrow(/unknown coach tool/);
  });
});
