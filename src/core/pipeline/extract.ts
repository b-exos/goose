/**
 * Turn persisted decoded frames into the sample streams the feature/metric layer consumes.
 *
 * Pure over a list of decoded-frame rows (the repository supplies them, see
 * `decodedFramesForExtraction`). Produces heart-rate samples (`heartRateFromFrame`) and
 * motion samples (`motionFeatureFromFrame`). RR-interval / step extraction depends on optical
 * (R17) and step-counter packet decoding and is added as those frames are decoded on-device.
 */
import { heartRateFromFrame } from '../features/heart-rate';
import { motionFeatureFromFrame } from '../features/motion';
import type { HeartRateSample, MotionSample } from '../features/resting-hr';
import type { ParsedFrame, ParsedPayload } from '../protocol';

/** A decoded-frame row with just the fields the extractors need. */
export interface DecodedFrameForExtraction {
  frameId: string;
  packetType: number | null;
  packetTypeName: string | null;
  payloadHex: string;
  parsedPayloadJson: string;
  capturedAtMs: number;
}

/** Reconstruct the minimal `ParsedFrame` shape the feature extractors read. */
function toFrame(row: DecodedFrameForExtraction): ParsedFrame {
  const parsedPayload = JSON.parse(row.parsedPayloadJson || 'null') as ParsedPayload | null;
  return {
    packetType: row.packetType,
    packetTypeName: row.packetTypeName,
    payloadHex: row.payloadHex,
    parsedPayload,
  } as ParsedFrame;
}

/** Heart-rate samples from frames that carry HR, timestamped by capture time. */
export function extractHeartRateSamples(rows: DecodedFrameForExtraction[]): HeartRateSample[] {
  const samples: HeartRateSample[] = [];
  for (const row of rows) {
    const bpm = heartRateFromFrame(toFrame(row));
    if (bpm !== null) {
      samples.push({ id: row.frameId, timeUnixMs: row.capturedAtMs, heartRateBpm: bpm, frameId: row.frameId });
    }
  }
  return samples;
}

/** Motion-intensity samples from raw-motion (K10/K21) frames. */
export function extractMotionSamples(rows: DecodedFrameForExtraction[]): MotionSample[] {
  const samples: MotionSample[] = [];
  for (const row of rows) {
    const feature = motionFeatureFromFrame(toFrame(row));
    if (feature) {
      samples.push({
        timeUnixMs: row.capturedAtMs,
        motionIntensity0To1: feature.motionIntensity0To1,
        frameId: row.frameId,
      });
    }
  }
  return samples;
}
