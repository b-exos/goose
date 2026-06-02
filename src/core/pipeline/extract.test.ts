/** Tests frame→sample extraction against real decoded-frame fixtures. */
import { parseFrameHex, type ParsedFrame } from '../protocol';
import { loadHex } from '../testing/fixtures';
import {
  extractHeartRateSamples,
  extractMotionSamples,
  type DecodedFrameForExtraction,
} from './extract';

function row(fixture: string, capturedAtMs: number): DecodedFrameForExtraction {
  const frame: ParsedFrame = parseFrameHex('GOOSE', loadHex(`synthetic/${fixture}.hex`));
  return {
    frameId: fixture,
    packetType: frame.packetType,
    packetTypeName: frame.packetTypeName,
    payloadHex: frame.payloadHex,
    parsedPayloadJson: JSON.stringify(frame.parsedPayload),
    capturedAtMs,
  };
}

describe('frame extraction', () => {
  const rows = [
    row('goose_v5_k10_motion_summary_short', 1000), // HR 72 + motion
    row('goose_v5_historical_k18_packet', 2000), // normal-history HR marker 77
    row('goose_v5_get_hello_frame', 3000), // command — no HR/motion
  ];

  it('extracts heart-rate samples from HR-bearing frames', () => {
    const hr = extractHeartRateSamples(rows);
    expect(hr.map((s) => s.heartRateBpm)).toEqual([72, 77]);
    expect(hr.map((s) => s.timeUnixMs)).toEqual([1000, 2000]);
    expect(hr[0].frameId).toBe('goose_v5_k10_motion_summary_short');
  });

  it('extracts motion samples from raw-motion frames only', () => {
    const motion = extractMotionSamples(rows);
    expect(motion).toHaveLength(1);
    expect(motion[0].frameId).toBe('goose_v5_k10_motion_summary_short');
    expect(motion[0].motionIntensity0To1).toBeCloseTo(1.2 / 32767, 12);
  });
});
