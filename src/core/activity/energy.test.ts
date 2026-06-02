/** Tests for energy (kcal) estimation and rollup confidence. */
import { activeKcal, energyConfidence, estimateDailyEnergy, restingKcal } from './energy';

describe('energy estimation', () => {
  it('prorates resting kcal from body-weight RMR', () => {
    // 70kg -> 1540 kcal/day; over 1440 min = full day
    expect(restingKcal(70, 1440)).toBeCloseTo(1540, 9);
    expect(restingKcal(70, 60)).toBeCloseTo(1540 / 24, 9);
  });

  it('estimates active kcal from HR reserve when zones are absent', () => {
    const kcal = activeKcal({
      weightKg: 70,
      coveredMinutes: 60,
      hrZoneMinutes: [],
      averageHrBpm: 140,
      restingHrBpm: 60,
      maxHrBpm: 180,
      averageMotionIntensity0To1: null,
    });
    // reserve fraction 0.6667; met = 7 * 0.6667^1.35; * 60 min * (3.5*70/200)
    const reserveFraction = (140 - 60) / (180 - 60);
    const expected = 7 * reserveFraction ** 1.35 * 60 * ((3.5 * 70) / 200);
    expect(kcal).toBeCloseTo(expected, 6);
  });

  it('takes the max of zone / reserve / motion estimates', () => {
    const kcal = activeKcal({
      weightKg: 70,
      coveredMinutes: 60,
      hrZoneMinutes: [10, 20, 30, 0, 0], // zone-based dominates here
      averageHrBpm: 70,
      restingHrBpm: 60,
      maxHrBpm: 180,
      averageMotionIntensity0To1: 0.0,
    });
    const kcalPerMet = (3.5 * 70) / 200;
    const zoneMet = 10 * 0 + 20 * 1 + 30 * 2.5 + 0 + 0; // = 95
    expect(kcal).toBeCloseTo(zoneMet * kcalPerMet, 6);
  });

  it('scores confidence by profile completeness and coverage', () => {
    const full = energyConfidence({
      hasWeight: true, hasAge: true, hasSex: true,
      heartRateSampleCount: 600, minHeartRateSamples: 10,
      motionSampleCount: 100, hasDeviceStepCadenceSupport: true,
      coveredMinutes: 1440, requestedMinutes: 1440,
    });
    expect(full).toBeCloseTo(0.9, 9); // hits the cap
    const sparse = energyConfidence({
      hasWeight: false, hasAge: false, hasSex: false,
      heartRateSampleCount: 0, minHeartRateSamples: 10,
      motionSampleCount: 0, hasDeviceStepCadenceSupport: false,
      coveredMinutes: 0, requestedMinutes: 1440,
    });
    expect(sparse).toBeCloseTo(0.22, 9); // 0.18 + 0.04 floor profile
  });

  it('combines resting + active into a daily total', () => {
    const estimate = estimateDailyEnergy(
      { weightKg: 70, coveredMinutes: 60, hrZoneMinutes: [], averageHrBpm: 140, restingHrBpm: 60, maxHrBpm: 180, averageMotionIntensity0To1: null },
      1440,
      { hasWeight: true, hasAge: true, hasSex: true, heartRateSampleCount: 600, minHeartRateSamples: 10, motionSampleCount: 100, hasDeviceStepCadenceSupport: true, coveredMinutes: 1440, requestedMinutes: 1440 },
    );
    expect(estimate.totalKcal).toBeCloseTo(estimate.activeKcal + estimate.restingKcal, 9);
    expect(estimate.restingKcal).toBeCloseTo(1540, 6);
  });
});
