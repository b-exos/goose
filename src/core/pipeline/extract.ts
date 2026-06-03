/**
 * Turn persisted decoded frames into the sample streams the feature/metric layer consumes.
 *
 * Pure over a list of decoded-frame rows (the repository supplies them, see
 * `decodedFramesForExtraction`). Produces heart-rate samples (`heartRateFromFrame`),
 * motion samples (`motionFeatureFromFrame`), and RR-interval samples from optical (R17)
 * frames (`extractRrIntervals`, the source for HRV → recovery).
 */
import type { HrvFeatureSample } from '../features/hrv';
import { heartRateFromFrame } from '../features/heart-rate';
import { motionFeatureFromFrame } from '../features/motion';
import { detectRrIntervalsMs } from '../features/ppg-pulse';
import { extractK20Channels, PPG_SAMPLE_RATE_HZ, selectBestChannel, stitchK20Channels } from '../features/ppg';
import type { HeartRateSample, MotionSample } from '../features/resting-hr';
import { decodeHexWithWhitespace, readI16Le, type ParsedFrame, type ParsedPayload } from '../protocol';

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

/** Plausible RR-interval range (ms): ~30–200 bpm. Matches the reference extractor. */
const RR_MIN_MS = 300;
const RR_MAX_MS = 2000;

/**
 * RR-interval samples (one per R17 optical frame) for HRV/recovery.
 *
 * Ported from `hrv_feature_from_plan` (metric_features.rs): for each `data_packet` whose body
 * summary is `r17_optical_or_labrador_filtered`, read the `samples` i16 LE series and keep
 * values in the plausible RR range. Scale is preliminary (unvalidated) — same caveat as Rust.
 */
export function extractRrIntervals(rows: DecodedFrameForExtraction[]): HrvFeatureSample[] {
  const samples: HrvFeatureSample[] = [];
  for (const row of rows) {
    const parsed = JSON.parse(row.parsedPayloadJson || 'null') as ParsedPayload | null;
    if (parsed?.kind !== 'data_packet') continue;
    const body = parsed.bodySummary;
    if (body?.kind !== 'r17_optical_or_labrador_filtered' || !body.samples) continue;

    const payload = decodeHexWithWhitespace(row.payloadHex);
    const { offset, parsedCount } = body.samples;
    const rrIntervalsMs: number[] = [];
    for (let i = 0; i < parsedCount; i++) {
      const value = readI16Le(payload, offset + i * 2);
      if (value !== null && value >= RR_MIN_MS && value <= RR_MAX_MS) rrIntervalsMs.push(value);
    }
    if (rrIntervalsMs.length === 0) continue;
    samples.push({
      metricInputId: `${row.frameId}.rr_intervals`,
      capturedAt: new Date(row.capturedAtMs).toISOString(),
      rrIntervalsMs,
    });
  }
  return samples;
}

/**
 * RR intervals derived from the raw optical (k20) PPG, the live source of HRV/recovery (R17
 * filtered packets never stream). Stitches k20 channels across the window, picks the most
 * pulsatile channel, and runs peak detection. Returns a single aggregate HRV sample (or empty).
 *
 * `window` scopes extraction to a time range (device timestamp) — recovery HRV should come from
 * the **sleep** window, where HR/motion are quiescent, not noisy daytime activity.
 */
export function extractPpgRrIntervals(
  rows: DecodedFrameForExtraction[],
  window?: { startMs: number; endMs: number },
): HrvFeatureSample[] {
  let frames = rows.map((r) => extractK20Channels(r.payloadHex)).filter((f) => f !== null);
  if (window) {
    frames = frames.filter((f) => {
      const ms = f!.timestampSeconds * 1000;
      return ms >= window.startMs && ms < window.endMs;
    });
  }
  if (frames.length === 0) return [];
  const channel = selectBestChannel(stitchK20Channels(frames));
  const { rrIntervalsMs } = detectRrIntervalsMs(channel, PPG_SAMPLE_RATE_HZ);
  if (rrIntervalsMs.length === 0) return [];
  const lastTs = frames[frames.length - 1]!.timestampSeconds;
  return [
    {
      metricInputId: 'ppg.k20.rr_intervals',
      capturedAt: new Date(lastTs * 1000).toISOString(),
      rrIntervalsMs,
    },
  ];
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
