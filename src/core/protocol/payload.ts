/**
 * Payload parsing for decoded frames.
 * Ported from the `parse_payload` family in `docs/rust-reference/src/protocol.rs`.
 */
import { encodeHex, readI16Le, readU16Le, readU32Le } from './hex';
import {
  commandName,
  dataPacketDomain,
  historyHrMarkerOffset,
  PACKET_TYPE,
  strapEventName,
} from './names';
import type { DataPacketBodySummary, I16SeriesSummary, ParsedPayload } from './types';

/** Lowercase-hex of `bytes[offset..]`. */
function hexFrom(bytes: Uint8Array, offset: number): string {
  return encodeHex(bytes.subarray(offset));
}

/** Dispatch payload parsing by leading packet-type byte. */
export function parsePayload(payload: Uint8Array): ParsedPayload | null {
  if (payload.length === 0) return null;
  const packetType = payload[0];
  switch (packetType) {
    case PACKET_TYPE.COMMAND:
    case PACKET_TYPE.PUFFIN_COMMAND:
      return parseCommand(payload);
    case PACKET_TYPE.COMMAND_RESPONSE:
    case PACKET_TYPE.PUFFIN_COMMAND_RESPONSE:
      return parseCommandResponse(payload);
    case PACKET_TYPE.EVENT:
    case PACKET_TYPE.RELATIVE_PUFFIN_EVENTS:
    case PACKET_TYPE.PUFFIN_EVENTS_FROM_STRAP:
      return parseEvent(payload);
    case PACKET_TYPE.REALTIME_DATA:
    case PACKET_TYPE.REALTIME_RAW_DATA:
    case PACKET_TYPE.HISTORICAL_DATA:
    case PACKET_TYPE.REALTIME_IMU_DATA_STREAM:
    case PACKET_TYPE.HISTORICAL_IMU_DATA_STREAM:
      return parseDataPacket(payload);
    default: {
      const off = Math.min(1, payload.length);
      return { kind: 'raw', dataOffset: off, dataHex: hexFrom(payload, off), warnings: [] };
    }
  }
}

/** Packet types that may legitimately arrive as a truncated/partial frame. */
export function isPartialDataPacketTypeAllowed(packetType: number): boolean {
  return (
    packetType === PACKET_TYPE.REALTIME_DATA ||
    packetType === PACKET_TYPE.REALTIME_RAW_DATA ||
    packetType === PACKET_TYPE.HISTORICAL_DATA ||
    packetType === PACKET_TYPE.REALTIME_IMU_DATA_STREAM ||
    packetType === PACKET_TYPE.HISTORICAL_IMU_DATA_STREAM
  );
}

function parseCommand(payload: Uint8Array): ParsedPayload {
  const warnings: string[] = [];
  if (payload.length < 3) warnings.push('command_payload_too_short');
  const command = payload[2] ?? null;
  const off = Math.min(3, payload.length);
  return {
    kind: 'command',
    command,
    commandName: command !== null ? commandName(command) : null,
    dataOffset: off,
    dataHex: hexFrom(payload, off),
    warnings,
  };
}

function parseCommandResponse(payload: Uint8Array): ParsedPayload {
  const warnings: string[] = [];
  if (payload.length < 5) warnings.push('command_response_payload_too_short');
  const responseToCommand = payload[2] ?? null;
  const off = Math.min(5, payload.length);
  return {
    kind: 'command_response',
    responseToCommand,
    responseToCommandName: responseToCommand !== null ? commandName(responseToCommand) : null,
    originSequence: payload[3] ?? null,
    resultCode: payload[4] ?? null,
    dataOffset: off,
    dataHex: hexFrom(payload, off),
    warnings,
  };
}

function parseEvent(payload: Uint8Array): ParsedPayload {
  const warnings: string[] = [];
  if (payload.length < 12) warnings.push('event_payload_header_too_short');
  const eventId = readU16Le(payload, 2);
  const off = Math.min(12, payload.length);
  return {
    kind: 'event',
    eventId,
    eventName: eventId !== null ? strapEventName(eventId) : null,
    timestampSeconds: readU32Le(payload, 4),
    timestampSubseconds: readU16Le(payload, 8),
    dataOffset: off,
    dataHex: hexFrom(payload, off),
    warnings,
  };
}

function parseDataPacket(payload: Uint8Array): ParsedPayload {
  const warnings: string[] = [];
  if (payload.length < 13) warnings.push('data_packet_header_too_short');
  const packetK = payload[1] ?? null;
  const hrMarkerOffset = packetK !== null ? historyHrMarkerOffset(packetK) : null;
  const hrPresentMarker =
    hrMarkerOffset !== null ? (payload[hrMarkerOffset] ?? null) : null;
  if (hrMarkerOffset !== null && hrPresentMarker === null) {
    warnings.push('history_hr_marker_missing');
  }
  const { summary, warnings: bodyWarnings } = parseBodySummary(
    payload,
    packetK,
    hrMarkerOffset,
    hrPresentMarker,
  );
  warnings.push(...bodyWarnings);
  const off = Math.min(13, payload.length);
  return {
    kind: 'data_packet',
    packetK,
    domain: packetK !== null ? dataPacketDomain(packetK) : null,
    statusOrStream: payload[2] ?? null,
    counterOrPage: readU32Le(payload, 3),
    timestampSeconds: readU32Le(payload, 7),
    timestampSubseconds: readU16Le(payload, 11),
    hrMarkerOffset,
    hrPresentMarker,
    bodyOffset: off,
    bodyHex: hexFrom(payload, off),
    bodySummary: summary,
    warnings,
  };
}

interface BodyResult {
  summary: DataPacketBodySummary | null;
  warnings: string[];
}

function parseBodySummary(
  payload: Uint8Array,
  packetK: number | null,
  hrMarkerOffset: number | null,
  hrPresentMarker: number | null,
): BodyResult {
  if (packetK === null) return { summary: null, warnings: [] };
  switch (packetK) {
    case 7:
    case 9:
    case 12:
    case 18:
    case 24:
      return {
        summary: {
          kind: 'normal_history',
          hrPresent: hrPresentMarker !== null ? hrPresentMarker !== 0 : null,
          markerOffset: hrMarkerOffset,
          markerValue: hrPresentMarker,
        },
        warnings: [],
      };
    case 17:
      return parseR17(payload);
    case 10:
      return parseK10(payload);
    case 21:
      return parseK21(payload);
    default:
      return { summary: null, warnings: [] };
  }
}

function parseR17(payload: Uint8Array): BodyResult {
  const flags = readU16Le(payload, 13);
  const sampleCount = readU16Le(payload, 24);
  const channelsOrGain: number[] = [];
  for (let offset = 15; offset <= 20; offset++) {
    if (offset < payload.length) channelsOrGain.push(payload[offset]);
  }
  const { summary: samples, warnings } = summarizeI16Series(payload, 26, sampleCount ?? 0, 'r17_samples');
  if (payload.length < 26) warnings.push('r17_header_too_short');
  return {
    summary: {
      kind: 'r17_optical_or_labrador_filtered',
      flags,
      flagBit9: flags !== null ? (flags & (1 << 9)) !== 0 : null,
      flagBit11: flags !== null ? (flags & (1 << 11)) !== 0 : null,
      channelsOrGain,
      sampleCount,
      samples,
      warnings: [...warnings],
    },
    warnings,
  };
}

function parseK10(payload: Uint8Array): BodyResult {
  const axes: I16SeriesSummary[] = [];
  const warnings: string[] = [];
  const layout: [string, number][] = [
    ['accelerometer_x', 85],
    ['accelerometer_y', 285],
    ['accelerometer_z', 485],
    ['gyroscope_x', 688],
    ['gyroscope_y', 888],
    ['gyroscope_z', 1088],
  ];
  for (const [name, offset] of layout) {
    const { summary, warnings: w } = summarizeI16Series(payload, offset, 100, name);
    warnings.push(...w);
    if (summary) axes.push(summary);
  }
  return {
    summary: { kind: 'raw_motion_k10', heartRate: payload[17] ?? null, axes, warnings: [...warnings] },
    warnings,
  };
}

function parseK21(payload: Uint8Array): BodyResult {
  const group1Count = readU16Le(payload, 16);
  const group2Count = readU16Le(payload, 622);
  const axes: I16SeriesSummary[] = [];
  const warnings: string[] = [];
  const layout: [string, number, number | null][] = [
    ['group_1_axis_0', 20, group1Count],
    ['group_1_axis_1', 220, group1Count],
    ['group_1_axis_2', 420, group1Count],
    ['group_2_axis_0', 632, group2Count],
    ['group_2_axis_1', 832, group2Count],
    ['group_2_axis_2', 1032, group2Count],
  ];
  for (const [name, offset, count] of layout) {
    const { summary, warnings: w } = summarizeI16Series(payload, offset, count ?? 0, name);
    warnings.push(...w);
    if (summary) axes.push(summary);
  }
  return {
    summary: { kind: 'raw_motion_k21', fieldX: readU16Le(payload, 14), group1Count, group2Count, axes, warnings: [...warnings] },
    warnings,
  };
}

interface SeriesResult {
  summary: I16SeriesSummary | null;
  warnings: string[];
}

function summarizeI16Series(
  payload: Uint8Array,
  offset: number,
  expectedCount: number,
  name: string,
): SeriesResult {
  if (expectedCount === 0) {
    return {
      summary: { name, offset, expectedCount, parsedCount: 0, min: null, max: null, sum: 0, preview: [] },
      warnings: [],
    };
  }
  const availableBytes = Math.max(payload.length - offset, 0);
  const parsedCount = Math.min(expectedCount, Math.floor(availableBytes / 2));
  const warnings: string[] = [];
  if (parsedCount < expectedCount) warnings.push(`${name}_truncated`);

  let min: number | null = null;
  let max: number | null = null;
  let sum = 0;
  const preview: number[] = [];
  for (let i = 0; i < parsedCount; i++) {
    const value = readI16Le(payload, offset + i * 2)!;
    min = min === null ? value : Math.min(min, value);
    max = max === null ? value : Math.max(max, value);
    sum += value;
    if (preview.length < 8) preview.push(value);
  }
  return { summary: { name, offset, expectedCount, parsedCount, min, max, sum, preview }, warnings };
}

/** Collect the warnings array out of any parsed-payload variant. */
export function parsedPayloadWarnings(payload: ParsedPayload): string[] {
  return payload.warnings;
}
