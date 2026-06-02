/**
 * Extract a heart-rate value (bpm) from a parsed frame.
 *
 * Three sources, matching the reference HR plans plus the observed realtime stream:
 *  - REALTIME_DATA: byte 7 present-flag + byte 8 bpm (observed on-device).
 *  - raw_motion_k10: the `heartRate` byte.
 *  - normal_history (K18/K24): the HR-present marker value.
 * Returns null when the frame carries no HR. Lives in `core` so both the BLE layer and the
 * extraction pipeline share one implementation.
 */
import { decodeHexWithWhitespace, PACKET_TYPE, type ParsedFrame } from '../protocol';

export function heartRateFromFrame(frame: ParsedFrame): number | null {
  if (frame.packetType === PACKET_TYPE.REALTIME_DATA) {
    const payload = decodeHexWithWhitespace(frame.payloadHex);
    const present = payload[7] ?? 0;
    const bpm = payload[8] ?? 0;
    if (present !== 0 && bpm > 0 && bpm < 255) return bpm;
  }

  const body = frame.parsedPayload?.kind === 'data_packet' ? frame.parsedPayload.bodySummary : null;
  if (!body) return null;
  if (body.kind === 'raw_motion_k10' && body.heartRate != null && body.heartRate > 0) {
    return body.heartRate;
  }
  if (
    body.kind === 'normal_history' &&
    body.hrPresent === true &&
    body.markerValue != null &&
    body.markerValue > 0
  ) {
    return body.markerValue;
  }
  return null;
}
