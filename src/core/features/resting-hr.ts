/**
 * Resting heart-rate feature extraction.
 *
 * Ported from `resting_heart_rate_feature`, `resting_heart_rate_candidate_selection`,
 * `low_quartile_mean_hr`, `nearest_resting_motion_feature` (metric_features.rs) and
 * `resting_heart_rate_confidence` (recovery_rollup.rs).
 *
 * Decoupled from the store/frame-plan layer: callers pass HR samples and (optionally)
 * motion samples. Resting HR = mean of the lowest quartile of low-motion HR samples.
 */

export const RESTING_HR_LOW_MOTION_INTENSITY_MAX = 0.08;
export const RESTING_HR_MOTION_MATCH_WINDOW_MS = 10 * 60 * 1000;

export interface HeartRateSample {
  id: string;
  timeUnixMs: number;
  heartRateBpm: number;
  frameId?: string | null;
  trusted?: boolean;
}

export interface MotionSample {
  timeUnixMs: number;
  motionIntensity0To1: number;
  frameId?: string | null;
}

export interface RestingHeartRateResult {
  restingHrBpm: number;
  method: string;
  sampleCount: number;
  trustedMetricInput: boolean;
  qualityFlags: string[];
  lowMotionSampleCount: number;
  highMotionSampleCount: number;
  unmatchedSampleCount: number;
}

/** Mean of the lowest quartile (ceil(n/4), min 1) of HR values. */
export function lowQuartileMeanHr(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const takeCount = Math.max(Math.ceil(sorted.length * 0.25), 1);
  let sum = 0;
  for (let i = 0; i < takeCount; i++) sum += sorted[i];
  return sum / takeCount;
}

/** Resting-HR confidence in [0.40, 0.88] from sample count, trust, and source diversity. */
export function restingHeartRateConfidence(
  sampleCount: number,
  minSampleCount: number,
  trustedMetricInput: boolean,
  sourceSignalCount: number,
): number {
  const targetSamples = Math.max(minSampleCount, 1) * 6;
  const sampleScore = Math.min(Math.max(sampleCount / targetSamples, 0), 1);
  const trustAdjustment = trustedMetricInput ? 0.08 : -0.08;
  const sourceAdjustment = sourceSignalCount > 1 ? -0.03 : 0;
  return Math.min(Math.max(0.6 + sampleScore * 0.2 + trustAdjustment + sourceAdjustment, 0.4), 0.88);
}

/** Nearest motion sample to an HR sample: same frame first, else closest within the window. */
function nearestMotion(hr: HeartRateSample, motion: MotionSample[]): MotionSample | null {
  if (hr.frameId != null) {
    const sameFrame = motion.find((m) => m.frameId != null && m.frameId === hr.frameId);
    if (sameFrame) return sameFrame;
  }
  let best: MotionSample | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const m of motion) {
    const distance = Math.abs(m.timeUnixMs - hr.timeUnixMs);
    if (distance <= RESTING_HR_MOTION_MATCH_WINDOW_MS && distance < bestDistance) {
      best = m;
      bestDistance = distance;
    }
  }
  return best;
}

const LOWEST_QUARTILE_METHOD = 'low_motion_filtered_lowest_quartile_mean_heart_rate_features';

/**
 * Estimate resting HR from HR samples, using motion context to keep only low-motion
 * samples when available (with the same fallbacks as the Rust selection).
 * Returns null if there are no usable HR samples.
 */
export function estimateRestingHeartRate(
  heartRate: HeartRateSample[],
  motion: MotionSample[] = [],
  minSampleCount = 1,
): RestingHeartRateResult | null {
  const flags = new Set<string>(['preliminary_resting_hr_from_heart_rate_features']);
  if (heartRate.length === 0) return null;

  let selected: HeartRateSample[];
  let method: string;
  let lowMotionSampleCount = 0;
  let highMotionSampleCount = 0;
  let unmatchedSampleCount = 0;

  if (motion.length === 0) {
    flags.add('resting_hr_motion_context_unavailable');
    selected = heartRate;
    method = 'lowest_quartile_mean_heart_rate_features';
    unmatchedSampleCount = heartRate.length;
  } else {
    const lowMotion: HeartRateSample[] = [];
    const unmatched: HeartRateSample[] = [];
    for (const hr of heartRate) {
      const m = nearestMotion(hr, motion);
      if (m === null) {
        unmatched.push(hr);
      } else if (m.motionIntensity0To1 <= RESTING_HR_LOW_MOTION_INTENSITY_MAX) {
        lowMotion.push(hr);
      } else {
        highMotionSampleCount += 1;
      }
    }
    unmatchedSampleCount = unmatched.length;
    lowMotionSampleCount = lowMotion.length;
    if (unmatchedSampleCount > 0) flags.add('resting_hr_motion_context_partial');
    if (highMotionSampleCount > 0) flags.add('resting_hr_high_motion_samples_excluded');

    if (lowMotion.length === 0) {
      flags.add('resting_hr_no_low_motion_hr_samples');
      if (unmatched.length === 0) {
        selected = [];
        method = LOWEST_QUARTILE_METHOD;
      } else {
        selected = unmatched;
        method = 'motion_unmatched_lowest_quartile_mean_heart_rate_features';
      }
    } else {
      flags.add('resting_hr_low_motion_filter_applied');
      if (unmatchedSampleCount > 0) flags.add('resting_hr_unmatched_samples_excluded');
      selected = lowMotion;
      method = LOWEST_QUARTILE_METHOD;
    }
  }

  void minSampleCount; // gating is the caller's concern (see rollup)
  if (selected.length === 0) return null;

  return {
    restingHrBpm: lowQuartileMeanHr(selected.map((s) => s.heartRateBpm)),
    method,
    sampleCount: selected.length,
    trustedMetricInput: selected.every((s) => s.trusted !== false),
    qualityFlags: [...flags].sort(),
    lowMotionSampleCount,
    highMotionSampleCount,
    unmatchedSampleCount,
  };
}
