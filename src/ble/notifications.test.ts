/** Tests for the BLE notification router: chunk buffering, deframing, and parsing. */
import { buildV5PayloadFrame, decodeHexWithWhitespace, parseFrame } from '../core/protocol';
import { loadHex } from '../core/testing/fixtures';
import { liveHeartRateFromFrame, NotificationRouter } from './notifications';

describe('NotificationRouter', () => {
  it('reassembles a frame split across two chunks', () => {
    const full = decodeHexWithWhitespace(loadHex('synthetic/goose_v5_get_hello_frame.hex'));
    const router = new NotificationRouter('GOOSE');

    const firstHalf = full.subarray(0, 6);
    const secondHalf = full.subarray(6);
    expect(router.ingest('command_from_strap', firstHalf)).toHaveLength(0);

    const frames = router.ingest('command_from_strap', secondHalf);
    expect(frames).toHaveLength(1);
    expect(frames[0].frame.packetType).toBe(35);
    expect(frames[0].role).toBe('command_from_strap');
  });

  it('emits multiple frames when chunks batch them', () => {
    const a = decodeHexWithWhitespace(loadHex('synthetic/goose_v5_get_hello_frame.hex'));
    const b = decodeHexWithWhitespace(loadHex('synthetic/goose_v5_temperature_event.hex'));
    const batched = new Uint8Array([...a, ...b]);

    const router = new NotificationRouter('GOOSE');
    const frames = router.ingest('data_from_strap', batched);
    expect(frames.map((f) => f.frame.packetType)).toEqual([35, 48]);
  });

  it('extracts live heart rate from a K10 motion frame', () => {
    const k10 = decodeHexWithWhitespace(loadHex('synthetic/goose_v5_k10_motion_summary_short.hex'));
    const router = new NotificationRouter('GOOSE');
    const [frame] = router.ingest('data_from_strap', k10);
    expect(liveHeartRateFromFrame(frame.frame)).toBe(72);
  });

  it('extracts live heart rate from a REALTIME_DATA frame (byte 8)', () => {
    // REALTIME_DATA (0x28), k=2, counter, …, present flag at [7]=1, bpm at [8]=57.
    const payload = new Uint8Array([0x28, 0x02, 0xc8, 0x4d, 0x1f, 0x6a, 0x47, 0x01, 57, 0, 0, 0, 0]);
    const frame = parseFrame('GOOSE', buildV5PayloadFrame(payload));
    expect(frame.packetTypeName).toBe('REALTIME_DATA');
    expect(liveHeartRateFromFrame(frame)).toBe(57);
  });
});
