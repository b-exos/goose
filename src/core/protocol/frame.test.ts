/**
 * Golden parity tests for the frame protocol against the preserved Rust fixtures.
 * Covers full-frame decode, header/payload CRC validation, and command/event parsing.
 */
import {
  buildV5CommandFrame,
  COMMAND_GET_HELLO,
  parseFrame,
  parseFrameHex,
} from './index';
import { loadFixture, loadHex } from '../testing/fixtures';

describe('parseFrameHex (golden)', () => {
  it('decodes the GOOSE GET_HELLO command frame', () => {
    const hex = loadHex('synthetic/goose_v5_get_hello_frame.hex');
    const { expected } = loadFixture<{
      device_type: string;
      packet_type: number;
      sequence: number;
      command_or_event: number;
      payload_hex: string;
      header_crc_valid: boolean;
      payload_crc_valid: boolean;
    }>('synthetic/goose_v5_get_hello_frame.fixture.json');

    const frame = parseFrameHex('GOOSE', hex);
    expect(frame.deviceType).toBe(expected.device_type);
    expect(frame.packetType).toBe(expected.packet_type);
    expect(frame.sequence).toBe(expected.sequence);
    expect(frame.commandOrEvent).toBe(expected.command_or_event);
    expect(frame.payloadHex).toBe(expected.payload_hex);
    expect(frame.headerCrcValid).toBe(expected.header_crc_valid);
    expect(frame.payloadCrcValid).toBe(expected.payload_crc_valid);
    expect(frame.parsedPayload?.kind).toBe('command');
  });

  it('decodes the TEMPERATURE_LEVEL event frame', () => {
    const { expected } = loadFixture<{
      packet_type: number;
      packet_type_name: string;
      sequence: number;
      command_or_event: number;
      payload_hex: string;
      header_crc_valid: boolean;
      payload_crc_valid: boolean;
      parsed_payload: {
        kind: string;
        event_id: number;
        event_name: string;
        timestamp_seconds: number;
        timestamp_subseconds: number;
        data_offset: number;
        data_hex: string;
      };
    }>('synthetic/goose_v5_temperature_event.fixture.json');
    const hex = loadHex('synthetic/goose_v5_temperature_event.hex');

    const frame = parseFrameHex('GOOSE', hex);
    expect(frame.packetType).toBe(expected.packet_type);
    expect(frame.packetTypeName).toBe(expected.packet_type_name);
    expect(frame.sequence).toBe(expected.sequence);
    expect(frame.commandOrEvent).toBe(expected.command_or_event);
    expect(frame.payloadHex).toBe(expected.payload_hex);
    expect(frame.headerCrcValid).toBe(expected.header_crc_valid);
    expect(frame.payloadCrcValid).toBe(expected.payload_crc_valid);

    const ev = expected.parsed_payload;
    expect(frame.parsedPayload?.kind).toBe(ev.kind);
    if (frame.parsedPayload?.kind === 'event') {
      expect(frame.parsedPayload.eventId).toBe(ev.event_id);
      expect(frame.parsedPayload.eventName).toBe(ev.event_name);
      expect(frame.parsedPayload.timestampSeconds).toBe(ev.timestamp_seconds);
      expect(frame.parsedPayload.timestampSubseconds).toBe(ev.timestamp_subseconds);
      expect(frame.parsedPayload.dataOffset).toBe(ev.data_offset);
      expect(frame.parsedPayload.dataHex).toBe(ev.data_hex);
    }
  });
});

describe('buildV5CommandFrame', () => {
  it('produces a frame with valid header and payload CRCs', () => {
    const built = buildV5CommandFrame(1, COMMAND_GET_HELLO, new Uint8Array());
    const parsed = parseFrame('GOOSE', built);
    expect(parsed.headerCrcValid).toBe(true);
    expect(parsed.payloadCrcValid).toBe(true);
    expect(parsed.packetType).toBe(35);
    expect(parsed.commandOrEvent).toBe(COMMAND_GET_HELLO);
  });
});
