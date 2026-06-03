/**
 * Raw optical (R20 / k20 "raw_or_research_counted") PPG extraction.
 *
 * The WHOOP 5.0 streams raw optical AFE data in k20 data packets: several channels (different
 * LED/photodiode gains), each a fixed slot of u32 LE ADC samples, zero-padded. This module
 * recovers the per-channel sample blocks from a frame, and stitches consecutive frames (ordered
 * by device counter/timestamp) into continuous per-channel waveforms for pulse detection.
 *
 * The band gives RAW optical, not RR intervals (R17 never streams live) — so HRV/recovery must
 * be derived downstream from these waveforms (see `ppg-pulse.ts`). Layout was reverse-engineered
 * from on-device captures; sample values land in a wide ADC range with smooth pulsatile drift.
 */
import { decodeHexWithWhitespace, readU32Le } from '../protocol';

/** Plausible raw-optical ADC sample range (counts). Filters header/padding from real samples. */
const SAMPLE_MIN = 50_000;
const SAMPLE_MAX = 8_000_000;
/** Minimum consecutive in-range u32s to count as a channel block (real blocks are ~25). */
const MIN_BLOCK_SAMPLES = 8;
/** k20 data-packet body starts after the 13-byte data-packet header. */
const BODY_OFFSET = 13;

/** Nominal raw-optical sample rate (Hz), validated on-device (samples-per-second per channel). */
export const PPG_SAMPLE_RATE_HZ = 25;

export interface K20Block {
  /** Byte offset of the block within the packet payload — the stable per-channel slot id. */
  offset: number;
  samples: number[];
}

export interface K20Channels {
  /** Device counter (sample-sequence) from the packet header, for ordering across packets. */
  counter: number;
  /** Device timestamp (seconds) from the packet header. */
  timestampSeconds: number;
  /** Detected optical sample blocks, each tagged with its slot offset. */
  blocks: K20Block[];
}

/**
 * Extract the per-channel u32 sample blocks from one k20 frame payload (hex of the packet,
 * starting at the packet-type byte). Returns null if it isn't a k20 raw-optical packet.
 */
export function extractK20Channels(payloadHex: string): K20Channels | null {
  const b = decodeHexWithWhitespace(payloadHex);
  if (b.length < BODY_OFFSET + 4) return null;
  // payload[0]=packet type (REALTIME_RAW_DATA 43 / HISTORICAL 47), payload[1]=packet_k.
  if (b[1] !== 20) return null;

  const counter = readU32Le(b, 3) ?? 0;
  const timestampSeconds = readU32Le(b, 7) ?? 0;

  const blocks: K20Block[] = [];
  let offset = BODY_OFFSET;
  while (offset + 4 <= b.length) {
    const value = readU32Le(b, offset);
    if (value !== null && value >= SAMPLE_MIN && value <= SAMPLE_MAX) {
      const start = offset;
      const samples: number[] = [];
      while (offset + 4 <= b.length) {
        const v = readU32Le(b, offset);
        if (v === null || v < SAMPLE_MIN || v > SAMPLE_MAX) break;
        samples.push(v);
        offset += 4;
      }
      if (samples.length >= MIN_BLOCK_SAMPLES) blocks.push({ offset: start, samples });
    } else {
      offset += 1;
    }
  }
  return blocks.length > 0 ? { counter, timestampSeconds, blocks } : null;
}

/** Slot offsets within this tolerance (bytes) are treated as the same channel across packets. */
const SLOT_OFFSET_TOLERANCE = 8;

/**
 * Stitch k20 frames into continuous per-channel waveforms, grouping blocks by their **slot
 * offset** within the packet (each physical optical channel occupies a stable byte offset). DC
 * level drifts over time so it can't key the channel; the slot position is stable. Frames are
 * processed in device-counter order so each channel's samples stay time-ordered.
 */
export function stitchK20Channels(frames: K20Channels[]): number[][] {
  const sorted = [...frames].sort((a, b) => a.counter - b.counter);
  const groups: { offset: number; samples: number[] }[] = [];
  for (const frame of sorted) {
    for (const block of frame.blocks) {
      const group = groups.find((g) => Math.abs(block.offset - g.offset) <= SLOT_OFFSET_TOLERANCE);
      if (group) {
        group.samples.push(...block.samples);
      } else {
        groups.push({ offset: block.offset, samples: [...block.samples] });
      }
    }
  }
  // Longest channels first (most data) for stable downstream selection.
  return groups.sort((a, b) => b.samples.length - a.samples.length).map((g) => g.samples);
}

/** Pick the channel with the strongest pulsatile component (highest coefficient of variation). */
export function selectBestChannel(channels: number[][]): number[] {
  let best: number[] = [];
  let bestCv = -1;
  for (const samples of channels) {
    if (samples.length < 10) continue;
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
    const variance = samples.reduce((s, v) => s + (v - mean) ** 2, 0) / samples.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
    if (cv > bestCv) {
      bestCv = cv;
      best = samples;
    }
  }
  return best;
}
