/**
 * Motion feature extraction: a 0–1 motion-intensity signal from a raw-motion frame.
 *
 * Ported from `motion_feature_from_plan` + `accumulate_axis` (metric_features.rs).
 * Intensity = mean absolute signed-i16 amplitude across all axis samples / 32767.
 * Operates on a parsed K10/K21 frame (re-reading the i16 series from its payload).
 */
import { decodeHexWithWhitespace, readI16Le, type ParsedFrame } from '../protocol';

const I16_FULL_SCALE = 32767;

export interface MotionFeature {
  frameId: string | null;
  motionIntensity0To1: number;
  rawMeanAbs: number;
  rawPeakAbs: number;
  parsedSampleCount: number;
  axisCount: number;
  heartRateBpm: number | null;
}

interface AxisLayout {
  offset: number;
  parsedCount: number;
}

/** Accumulate mean/peak absolute amplitude over the given i16 axis series in `payload`. */
export function motionIntensityFromAxes(
  payload: Uint8Array,
  axes: AxisLayout[],
): { motionIntensity0To1: number; rawMeanAbs: number; rawPeakAbs: number; sampleCount: number; axisCount: number } {
  let absSum = 0;
  let peakAbs = 0;
  let sampleCount = 0;
  let axisCount = 0;
  for (const axis of axes) {
    let axisSamples = 0;
    for (let i = 0; i < axis.parsedCount; i++) {
      const value = readI16Le(payload, axis.offset + i * 2);
      if (value === null) break;
      const abs = Math.abs(value);
      absSum += abs;
      if (abs > peakAbs) peakAbs = abs;
      axisSamples += 1;
    }
    if (axisSamples > 0) {
      axisCount += 1;
      sampleCount += axisSamples;
    }
  }
  const rawMeanAbs = sampleCount > 0 ? absSum / sampleCount : 0;
  const motionIntensity0To1 = Math.min(Math.max(rawMeanAbs / I16_FULL_SCALE, 0), 1);
  return { motionIntensity0To1, rawMeanAbs, rawPeakAbs: peakAbs, sampleCount, axisCount };
}

/**
 * Compute a motion feature from a parsed K10/K21 raw-motion frame, or null if the frame
 * carries no raw-motion body summary or no samples.
 */
export function motionFeatureFromFrame(frame: ParsedFrame): MotionFeature | null {
  const body = frame.parsedPayload?.kind === 'data_packet' ? frame.parsedPayload.bodySummary : null;
  if (!body || (body.kind !== 'raw_motion_k10' && body.kind !== 'raw_motion_k21')) return null;

  const payload = decodeHexWithWhitespace(frame.payloadHex);
  const axes: AxisLayout[] = body.axes.map((a) => ({ offset: a.offset, parsedCount: a.parsedCount }));
  const acc = motionIntensityFromAxes(payload, axes);
  if (acc.sampleCount === 0) return null;

  const heartRateBpm = body.kind === 'raw_motion_k10' && body.heartRate != null && body.heartRate > 0
    ? body.heartRate
    : null;

  return {
    frameId: null,
    motionIntensity0To1: acc.motionIntensity0To1,
    rawMeanAbs: acc.rawMeanAbs,
    rawPeakAbs: acc.rawPeakAbs,
    parsedSampleCount: acc.sampleCount,
    axisCount: acc.axisCount,
    heartRateBpm,
  };
}
