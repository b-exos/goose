/**
 * Classify an inbound parsed frame into a historical-sync event.
 *
 * Known/solid: HISTORICAL_DATA (47) packets are readings, tagged by their K family (k18/k24/…).
 * Markers (HistoryStart/End/Complete) arrive as METADATA/EVENT packets whose exact bytes we
 * have not yet captured from a real band — so the runtime detects transfer boundaries with a
 * quiet-period heuristic rather than relying on marker identification here. This returns the
 * data-packet readings (and treats metadata/events as `metadata`); update once the real
 * marker frames are observed on-device (visible in the More-tab debug log).
 */
import { PACKET_TYPE, type ParsedFrame } from '../protocol';
import type { HistoricalSyncEvent } from './historical-sync';

export function classifyHistoricalFrame(frame: ParsedFrame): HistoricalSyncEvent | null {
  if (frame.packetType === PACKET_TYPE.HISTORICAL_DATA) {
    const family =
      frame.parsedPayload?.kind === 'data_packet' && frame.parsedPayload.packetK != null
        ? `k${frame.parsedPayload.packetK}`
        : undefined;
    return { type: 'reading', family };
  }
  if (frame.packetType === PACKET_TYPE.METADATA || frame.packetType === PACKET_TYPE.EVENT) {
    return { type: 'metadata', name: frame.packetTypeName ?? undefined };
  }
  return null;
}
