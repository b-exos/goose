/**
 * Frame-level decode/encode and stream deframing.
 * Ported from `parse_frame`, `build_v5_*`, and `FrameAccumulator` in
 * `docs/rust-reference/src/protocol.rs`.
 */
import { crc16Modbus, crc32Ieee, crc8 } from './crc';
import { decodeHexWithWhitespace, encodeHex, readU32Le } from './hex';
import { packetTypeName, PACKET_TYPE } from './names';
import { isPartialDataPacketTypeAllowed, parsePayload } from './payload';
import {
  FRAME_START,
  headerLen,
  type DeframeResult,
  type DeviceType,
  type ParsedFrame,
} from './types';

/** Total expected frame length given a buffer's header, or null if too short to tell. */
export function expectedFrameLen(device: DeviceType, buffer: Uint8Array): number | null {
  if (device === 'GEN4') {
    if (buffer.length < 4) return null;
    return (buffer[1] | (buffer[2] << 8)) + 4;
  }
  if (buffer.length < 8) return null;
  return (buffer[2] | (buffer[3] << 8)) + 8;
}

/** Parse a hex (whitespace-tolerant) frame string. */
export function parseFrameHex(device: DeviceType, hexValue: string): ParsedFrame {
  return parseFrame(device, decodeHexWithWhitespace(hexValue));
}

/** Parse a single framed packet. Throws on structural errors (bad start byte, length). */
export function parseFrame(device: DeviceType, frame: Uint8Array): ParsedFrame {
  if (frame[0] !== FRAME_START) {
    throw new Error('frame does not start with 0xaa');
  }
  const hLen = headerLen(device);
  if (frame.length < hLen) {
    throw new Error(`frame shorter than ${hLen}-byte header`);
  }

  const declaredLen =
    device === 'GEN4' ? frame[1] | (frame[2] << 8) : frame[2] | (frame[3] << 8);
  if (declaredLen < 4) {
    throw new Error('declared length must include at least the 4-byte payload CRC');
  }

  const headerCrcValid =
    device === 'GEN4'
      ? crc8(frame.subarray(1, 3)) === frame[3]
      : crc16Modbus(frame.subarray(0, 6)) === (frame[6] | (frame[7] << 8));

  const expectedLen = hLen + declaredLen;
  if (frame.length > expectedLen) {
    throw new Error(`frame length ${frame.length} does not match declared length ${expectedLen}`);
  }
  const frameTruncated = frame.length < expectedLen;
  const partialPacketType = frame[hLen];
  if (
    frameTruncated &&
    (!headerCrcValid ||
      partialPacketType === undefined ||
      !isPartialDataPacketTypeAllowed(partialPacketType))
  ) {
    throw new Error(`frame length ${frame.length} does not match declared length ${expectedLen}`);
  }

  let payload: Uint8Array;
  let payloadCrc: Uint8Array;
  let payloadCrcValid: boolean;
  if (frameTruncated) {
    payload = frame.subarray(hLen);
    payloadCrc = new Uint8Array(0);
    payloadCrcValid = false;
  } else {
    const payloadEnd = frame.length - 4;
    payload = frame.subarray(hLen, payloadEnd);
    payloadCrc = frame.subarray(payloadEnd);
    payloadCrcValid = crc32Ieee(payload) === readU32Le(payloadCrc, 0);
  }

  const warnings: string[] = [];
  if (frameTruncated) {
    warnings.push('frame_truncated', 'payload_crc_unavailable_due_to_truncated_frame');
  }
  if (!headerCrcValid) warnings.push('header_crc_mismatch');
  if (!payloadCrcValid && !frameTruncated) warnings.push('payload_crc_mismatch');

  const packetType = payload.length > 0 ? payload[0] : null;
  const parsedPayload = parsePayload(payload);
  if (parsedPayload) warnings.push(...parsedPayload.warnings);

  return {
    deviceType: device,
    rawLen: frame.length,
    headerLen: hLen,
    declaredLen,
    payloadHex: encodeHex(payload),
    payloadCrcHex: encodeHex(payloadCrc),
    headerCrcValid,
    payloadCrcValid,
    packetType,
    packetTypeName: packetType !== null ? packetTypeName(packetType) : null,
    sequence: payload[1] ?? null,
    commandOrEvent: payload[2] ?? null,
    parsedPayload,
    warnings,
  };
}

/** 4-byte alignment padding count for a payload of the given length. */
export function paddingLen(length: number): number {
  const remainder = length % 4;
  return remainder === 0 ? 0 : 4 - remainder;
}

/** Build a v5 command payload frame (packet type COMMAND + sequence + command + data). */
export function buildV5CommandFrame(sequence: number, command: number, data: Uint8Array): Uint8Array {
  const payload = new Uint8Array(3 + data.length);
  payload[0] = PACKET_TYPE.COMMAND;
  payload[1] = sequence;
  payload[2] = command;
  payload.set(data, 3);
  return buildV5PayloadFrame(payload);
}

/** Build a v5 framed packet around a raw payload (adds padding, header, both CRCs). */
export function buildV5PayloadFrame(payloadIn: Uint8Array): Uint8Array {
  const padding = paddingLen(payloadIn.length);
  const payload = new Uint8Array(payloadIn.length + padding);
  payload.set(payloadIn, 0);

  const payloadCrcValue = crc32Ieee(payload);
  const payloadCrc = new Uint8Array([
    payloadCrcValue & 0xff,
    (payloadCrcValue >>> 8) & 0xff,
    (payloadCrcValue >>> 16) & 0xff,
    (payloadCrcValue >>> 24) & 0xff,
  ]);
  const declaredLen = payload.length + payloadCrc.length;

  const header = new Uint8Array(8);
  header[0] = FRAME_START;
  header[1] = 0x01;
  header[2] = declaredLen & 0xff;
  header[3] = (declaredLen >>> 8) & 0xff;
  header[4] = 0x00;
  header[5] = 0x01;
  const headerCrc = crc16Modbus(header.subarray(0, 6));
  header[6] = headerCrc & 0xff;
  header[7] = (headerCrc >>> 8) & 0xff;

  const frame = new Uint8Array(8 + declaredLen);
  frame.set(header, 0);
  frame.set(payload, 8);
  frame.set(payloadCrc, 8 + payload.length);
  return frame;
}

/** Stateful deframer that buffers byte chunks and emits complete frames. */
export class FrameAccumulator {
  private buffer: Uint8Array = new Uint8Array(0);

  constructor(private readonly device: DeviceType) {}

  feed(chunk: Uint8Array): DeframeResult {
    this.buffer = concat(this.buffer, chunk);
    const frames: Uint8Array[] = [];
    let dropped = this.dropUntilFrameStart();

    for (;;) {
      const expectedLen = expectedFrameLen(this.device, this.buffer);
      if (expectedLen === null || this.buffer.length < expectedLen) break;
      frames.push(this.buffer.slice(0, expectedLen));
      this.buffer = this.buffer.slice(expectedLen);
      dropped += this.dropUntilFrameStart();
    }

    return { frames, bufferedLen: this.buffer.length, droppedPrefixLen: dropped };
  }

  private dropUntilFrameStart(): number {
    const start = this.buffer.indexOf(FRAME_START);
    if (start === 0) return 0;
    if (start < 0) {
      const dropped = this.buffer.length;
      this.buffer = new Uint8Array(0);
      return dropped;
    }
    this.buffer = this.buffer.slice(start);
    return start;
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
