/**
 * Type definitions for the parsed WHOOP frame protocol.
 * Ported from the structs/enums in `docs/rust-reference/src/protocol.rs`.
 *
 * Discriminant `kind` values use the same snake_case strings the Rust core serialized
 * (e.g. `data_packet`, `raw_motion_k10`) so they line up with the golden fixtures.
 */

export const FRAME_START = 0xaa;

/** Device families, distinguished by header length / CRC scheme. */
export type DeviceType = 'GEN4' | 'MAVERICK' | 'PUFFIN' | 'GOOSE';

/** Summary statistics for a parsed series of little-endian i16 samples. */
export interface I16SeriesSummary {
  name: string;
  offset: number;
  expectedCount: number;
  parsedCount: number;
  min: number | null;
  max: number | null;
  sum: number;
  preview: number[];
}

export type DataPacketBodySummary =
  | { kind: 'normal_history'; hrPresent: boolean | null; markerOffset: number | null; markerValue: number | null }
  | {
      kind: 'r17_optical_or_labrador_filtered';
      flags: number | null;
      flagBit9: boolean | null;
      flagBit11: boolean | null;
      channelsOrGain: number[];
      sampleCount: number | null;
      samples: I16SeriesSummary | null;
      warnings: string[];
    }
  | { kind: 'raw_motion_k10'; heartRate: number | null; axes: I16SeriesSummary[]; warnings: string[] }
  | {
      kind: 'raw_motion_k21';
      fieldX: number | null;
      group1Count: number | null;
      group2Count: number | null;
      axes: I16SeriesSummary[];
      warnings: string[];
    };

export type ParsedPayload =
  | { kind: 'command'; command: number | null; commandName: string | null; dataOffset: number; dataHex: string; warnings: string[] }
  | {
      kind: 'command_response';
      responseToCommand: number | null;
      responseToCommandName: string | null;
      originSequence: number | null;
      resultCode: number | null;
      dataOffset: number;
      dataHex: string;
      warnings: string[];
    }
  | {
      kind: 'event';
      eventId: number | null;
      eventName: string | null;
      timestampSeconds: number | null;
      timestampSubseconds: number | null;
      dataOffset: number;
      dataHex: string;
      warnings: string[];
    }
  | {
      kind: 'data_packet';
      packetK: number | null;
      domain: string | null;
      statusOrStream: number | null;
      counterOrPage: number | null;
      timestampSeconds: number | null;
      timestampSubseconds: number | null;
      hrMarkerOffset: number | null;
      hrPresentMarker: number | null;
      bodyOffset: number;
      bodyHex: string;
      bodySummary: DataPacketBodySummary | null;
      warnings: string[];
    }
  | { kind: 'raw'; dataOffset: number; dataHex: string; warnings: string[] };

export interface ParsedFrame {
  deviceType: DeviceType;
  rawLen: number;
  headerLen: number;
  declaredLen: number;
  payloadHex: string;
  payloadCrcHex: string;
  headerCrcValid: boolean;
  payloadCrcValid: boolean;
  packetType: number | null;
  packetTypeName: string | null;
  sequence: number | null;
  commandOrEvent: number | null;
  parsedPayload: ParsedPayload | null;
  warnings: string[];
}

export interface DeframeResult {
  frames: Uint8Array[];
  bufferedLen: number;
  droppedPrefixLen: number;
}

/** Header length in bytes for a device family. */
export function headerLen(device: DeviceType): number {
  return device === 'GEN4' ? 4 : 8;
}
