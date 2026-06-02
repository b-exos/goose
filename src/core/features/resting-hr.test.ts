/** Tests for resting-HR feature extraction (lowest-quartile, motion filtering, confidence). */
import {
  estimateRestingHeartRate,
  lowQuartileMeanHr,
  restingHeartRateConfidence,
  type HeartRateSample,
  type MotionSample,
} from './resting-hr';

const hr = (id: string, t: number, bpm: number, frameId?: string): HeartRateSample => ({
  id,
  timeUnixMs: t,
  heartRateBpm: bpm,
  frameId,
});

describe('resting-hr', () => {
  it('averages the lowest quartile', () => {
    // 8 values -> ceil(8*0.25)=2 lowest: 50, 52 -> 51
    expect(lowQuartileMeanHr([70, 65, 50, 80, 52, 75, 90, 60])).toBeCloseTo(51, 10);
    // single value -> itself
    expect(lowQuartileMeanHr([62])).toBe(62);
  });

  it('estimates resting HR with no motion context', () => {
    const result = estimateRestingHeartRate([hr('a', 0, 60), hr('b', 1000, 80), hr('c', 2000, 50), hr('d', 3000, 90)]);
    expect(result).not.toBeNull();
    // ceil(4*0.25)=1 lowest -> 50
    expect(result!.restingHrBpm).toBe(50);
    expect(result!.qualityFlags).toContain('resting_hr_motion_context_unavailable');
    expect(result!.method).toBe('lowest_quartile_mean_heart_rate_features');
  });

  it('keeps only low-motion samples when motion is available', () => {
    const heartRate = [hr('a', 0, 55, 'f0'), hr('b', 1000, 120, 'f1'), hr('c', 2000, 58, 'f2')];
    const motion: MotionSample[] = [
      { frameId: 'f0', timeUnixMs: 0, motionIntensity0To1: 0.02 }, // low
      { frameId: 'f1', timeUnixMs: 1000, motionIntensity0To1: 0.6 }, // high -> excluded
      { frameId: 'f2', timeUnixMs: 2000, motionIntensity0To1: 0.05 }, // low
    ];
    const result = estimateRestingHeartRate(heartRate, motion)!;
    // low-motion samples: 55, 58 -> ceil(2*0.25)=1 lowest -> 55
    expect(result.restingHrBpm).toBe(55);
    expect(result.lowMotionSampleCount).toBe(2);
    expect(result.highMotionSampleCount).toBe(1);
    expect(result.qualityFlags).toContain('resting_hr_low_motion_filter_applied');
    expect(result.qualityFlags).toContain('resting_hr_high_motion_samples_excluded');
  });

  it('returns null when there are no HR samples', () => {
    expect(estimateRestingHeartRate([])).toBeNull();
  });

  it('scores confidence by sample sufficiency and trust', () => {
    // min 1 -> target 6 samples; 6 trusted single-source -> 0.6 + 0.2 + 0.08 = 0.88 (cap)
    expect(restingHeartRateConfidence(6, 1, true, 1)).toBeCloseTo(0.88, 10);
    // 3 samples (score 0.5), untrusted, two sources -> 0.6 + 0.1 - 0.08 - 0.03 = 0.59
    expect(restingHeartRateConfidence(3, 1, false, 2)).toBeCloseTo(0.59, 10);
    // 0 samples, untrusted, two sources -> 0.6 - 0.08 - 0.03 = 0.49 (above the 0.40 floor)
    expect(restingHeartRateConfidence(0, 1, false, 2)).toBeCloseTo(0.49, 10);
    // floor actually engaged: many penalties can't drop below 0.40
    expect(restingHeartRateConfidence(0, 100, false, 2)).toBeCloseTo(0.49, 10);
  });
});
