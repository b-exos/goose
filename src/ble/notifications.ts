/**
 * Inbound BLE notification handling: buffer raw characteristic chunks, deframe them, and
 * parse each complete WHOOP frame.
 *
 * BLE notifications arrive as MTU-sized chunks that may split or batch frames, so each
 * characteristic gets its own `FrameAccumulator`. Pure over byte input — no native deps —
 * so it is unit-testable with synthetic streams.
 */
import { heartRateFromFrame } from '../core/features/heart-rate';
import {
  FrameAccumulator,
  parseFrame,
  type DeviceType,
  type ParsedFrame,
} from '../core/protocol';
import type { WhoopCharacteristicRole } from './uuids';

export interface InboundFrame {
  role: WhoopCharacteristicRole;
  frame: ParsedFrame;
  /** Raw frame bytes (for capture/evidence persistence). */
  raw: Uint8Array;
}

/**
 * Routes inbound chunks per characteristic role into deframed, parsed frames. Frames that
 * fail to parse are skipped (their error is returned via `lastError` for diagnostics).
 */
export class NotificationRouter {
  private readonly accumulators = new Map<WhoopCharacteristicRole, FrameAccumulator>();
  lastError: string | null = null;

  constructor(private readonly deviceType: DeviceType) {}

  /** Feed a raw chunk for a characteristic role; returns any newly-completed parsed frames. */
  ingest(role: WhoopCharacteristicRole, chunk: Uint8Array): InboundFrame[] {
    let accumulator = this.accumulators.get(role);
    if (!accumulator) {
      accumulator = new FrameAccumulator(this.deviceType);
      this.accumulators.set(role, accumulator);
    }
    const { frames } = accumulator.feed(chunk);
    const out: InboundFrame[] = [];
    for (const raw of frames) {
      try {
        out.push({ role, frame: parseFrame(this.deviceType, raw), raw });
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
      }
    }
    return out;
  }
}

/**
 * Pull the most recent live heart rate from a parsed data-packet frame, if present.
 *
 * Matches the reference HR sources (`heart_rate_plan_from_row`): raw-motion K10 (the
 * `heart_rate` byte) and normal-history packets (the HR-present marker value).
 */
export function liveHeartRateFromFrame(frame: ParsedFrame): number | null {
  return heartRateFromFrame(frame);
}
