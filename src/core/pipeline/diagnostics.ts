/**
 * On-device diagnostics for the recovery pipeline.
 *
 * Recovery needs RR intervals decoded from R17 optical frames, which is the most uncertain
 * link (the band may not stream R17, and its i16 samples are an unvalidated RR candidate).
 * This reports, for a day's captured frames: what packet families arrived, how many R17
 * frames there were, the raw i16 sample values they carry, and how many fall in the plausible
 * RR range — so a failure can be localized (no R17 vs. R17 with out-of-range samples).
 */
import { heartRateFromFrame } from '../features/heart-rate';
import { detectRrIntervalsMs } from '../features/ppg-pulse';
import { extractK20Channels, PPG_SAMPLE_RATE_HZ, selectBestChannel, stitchK20Channels, type K20Channels } from '../features/ppg';
import { decodeHexWithWhitespace, readI16Le, type ParsedFrame, type ParsedPayload } from '../protocol';
import { decodedFramesForExtraction } from '../store/capture-repository';
import type { GooseDatabase } from '../store/db';

const RR_MIN_MS = 300;
const RR_MAX_MS = 2000;
const SAMPLE_PREVIEW_LIMIT = 16;

export interface RecoveryDiagnostics {
  totalFrames: number;
  /** Counts keyed by data-packet domain (e.g. `k17` optical) or payload kind. */
  byFamily: Record<string, number>;
  r17FrameCount: number;
  /** First raw i16 sample values seen across R17 frames (to judge whether they look like RR ms). */
  r17SamplePreview: number[];
  /** RR intervals that passed the 300–2000 ms plausibility filter. */
  rrIntervalsInRange: number;
  /** First full payload hex seen per family — raw material for reverse-engineering layouts. */
  examplePayloads: Record<string, string>;
  /** HR-sample stats (to spot bogus high readings inflating strain), keyed by source family. */
  hrStats: { count: number; min: number; max: number; mean: number };
  /** Max HR seen per family — pinpoints which frame type emits suspicious values. */
  hrMaxByFamily: Record<string, number>;
}

function familyOf(payload: ParsedPayload | null): string {
  if (!payload) return 'unparsed';
  if (payload.kind === 'data_packet') {
    return payload.domain ?? (payload.packetK !== null ? `k${payload.packetK}` : 'data_packet');
  }
  return payload.kind;
}

/** Inspect a day's frames for the recovery (RR/HRV) path. */
export async function recoveryDiagnostics(
  db: GooseDatabase,
  startIso: string,
  endIso: string,
): Promise<RecoveryDiagnostics> {
  const rows = await decodedFramesForExtraction(db, startIso, endIso);
  const byFamily: Record<string, number> = {};
  const examplePayloads: Record<string, string> = {};
  const hrMaxByFamily: Record<string, number> = {};
  const r17SamplePreview: number[] = [];
  let r17FrameCount = 0;
  let rrIntervalsInRange = 0;
  let hrCount = 0;
  let hrMin = Infinity;
  let hrMax = 0;
  let hrSum = 0;

  for (const row of rows) {
    const payload = JSON.parse(row.parsedPayloadJson || 'null') as ParsedPayload | null;
    const family = familyOf(payload);
    byFamily[family] = (byFamily[family] ?? 0) + 1;
    if (!(family in examplePayloads)) examplePayloads[family] = row.payloadHex;

    const bpm = heartRateFromFrame({
      packetType: row.packetType,
      packetTypeName: row.packetTypeName,
      payloadHex: row.payloadHex,
      parsedPayload: payload,
    } as ParsedFrame);
    if (bpm !== null) {
      hrCount += 1;
      hrMin = Math.min(hrMin, bpm);
      hrMax = Math.max(hrMax, bpm);
      hrSum += bpm;
      hrMaxByFamily[family] = Math.max(hrMaxByFamily[family] ?? 0, bpm);
    }

    if (payload?.kind !== 'data_packet') continue;
    const body = payload.bodySummary;
    if (body?.kind !== 'r17_optical_or_labrador_filtered' || !body.samples) continue;

    r17FrameCount += 1;
    const bytes = decodeHexWithWhitespace(row.payloadHex);
    const { offset, parsedCount } = body.samples;
    for (let i = 0; i < parsedCount; i++) {
      const value = readI16Le(bytes, offset + i * 2);
      if (value === null) continue;
      if (r17SamplePreview.length < SAMPLE_PREVIEW_LIMIT) r17SamplePreview.push(value);
      if (value >= RR_MIN_MS && value <= RR_MAX_MS) rrIntervalsInRange += 1;
    }
  }

  return {
    totalFrames: rows.length,
    byFamily,
    r17FrameCount,
    r17SamplePreview,
    rrIntervalsInRange,
    examplePayloads,
    hrStats: { count: hrCount, min: hrCount ? hrMin : 0, max: hrMax, mean: hrCount ? hrSum / hrCount : 0 },
    hrMaxByFamily,
  };
}

export interface PpgWaveformDiagnostics {
  k20FrameCount: number;
  channelCount: number;
  totalSamplesPerChannel: number;
  /** Estimated sample rate (Hz) from samples-per-channel over the device-time span. */
  sampleRateHz: number | null;
  /** Index of the channel with the strongest pulsatile component (highest AC/DC ratio). */
  bestChannel: number;
  /** A recent window of the best channel's samples, for offline pulse-detection design. */
  bestChannelPreview: number[];
  /** HR derived from PPG peak detection — validate against the band's reported HR. */
  derivedHrBpm: number | null;
  /** RR-interval count detected across the window (feeds HRV/recovery). */
  rrCount: number;
}

/**
 * Inspect the raw optical (k20) PPG for a day's frames: how many channels, the estimated
 * sample rate, and a window of the cleanest channel — the inputs needed to design/validate the
 * pulse-detection → RR-interval pipeline (HRV/recovery).
 */
export async function ppgWaveformDiagnostics(
  db: GooseDatabase,
  startIso: string,
  endIso: string,
): Promise<PpgWaveformDiagnostics> {
  const rows = await decodedFramesForExtraction(db, startIso, endIso);
  const frames: K20Channels[] = [];
  for (const row of rows) {
    const k20 = extractK20Channels(row.payloadHex);
    if (k20) frames.push(k20);
  }
  const stitched = stitchK20Channels(frames);
  const channelCount = stitched.length;
  const totalSamplesPerChannel = stitched[0]?.length ?? 0;

  // Sample rate from the device-time span across k20 packets.
  const stamps = frames.map((f) => f.timestampSeconds).filter((s) => s > 1_577_836_800);
  const spanSec = stamps.length >= 2 ? Math.max(...stamps) - Math.min(...stamps) : 0;
  const sampleRateHz = spanSec > 0 ? totalSamplesPerChannel / spanSec : null;

  // Pick the channel with the highest coefficient of variation (pulsatile AC relative to DC).
  let bestChannel = 0;
  let bestCv = -1;
  stitched.forEach((samples, index) => {
    if (samples.length < 10) return;
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
    const variance = samples.reduce((s, v) => s + (v - mean) ** 2, 0) / samples.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
    if (cv > bestCv) {
      bestCv = cv;
      bestChannel = index;
    }
  });

  const best = stitched[bestChannel] ?? [];
  const bestChannelPreview = best.slice(Math.max(0, best.length - 120));
  const pulse = detectRrIntervalsMs(selectBestChannel(stitched), PPG_SAMPLE_RATE_HZ);

  return {
    k20FrameCount: frames.length,
    channelCount,
    totalSamplesPerChannel,
    sampleRateHz,
    bestChannel,
    bestChannelPreview,
    derivedHrBpm: pulse.hrBpm,
    rrCount: pulse.rrIntervalsMs.length,
  };
}
