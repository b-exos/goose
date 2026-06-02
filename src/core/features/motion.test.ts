/** Tests for motion feature extraction against the K10 raw-motion fixture. */
import { parseFrameHex } from '../protocol';
import { loadHex } from '../testing/fixtures';
import { motionFeatureFromFrame, motionIntensityFromAxes } from './motion';

describe('motion features', () => {
  it('computes mean/peak absolute amplitude over axes', () => {
    // bytes: i16 LE 1, -2, 3 at offset 0
    const payload = new Uint8Array([0x01, 0x00, 0xfe, 0xff, 0x03, 0x00]);
    const acc = motionIntensityFromAxes(payload, [{ offset: 0, parsedCount: 3 }]);
    expect(acc.sampleCount).toBe(3);
    expect(acc.rawMeanAbs).toBeCloseTo((1 + 2 + 3) / 3, 10);
    expect(acc.rawPeakAbs).toBe(3);
    expect(acc.axisCount).toBe(1);
  });

  it('derives a motion feature from the K10 fixture frame', () => {
    const frame = parseFrameHex('GOOSE', loadHex('synthetic/goose_v5_k10_motion_summary_short.hex'));
    const feature = motionFeatureFromFrame(frame)!;
    // accelerometer_x parsed [1,-2,3,0,0] -> abs sum 6 over 5 samples
    expect(feature.parsedSampleCount).toBe(5);
    expect(feature.rawMeanAbs).toBeCloseTo(1.2, 10);
    expect(feature.motionIntensity0To1).toBeCloseTo(1.2 / 32767, 12);
    expect(feature.heartRateBpm).toBe(72);
  });

  it('returns null for a non-motion frame', () => {
    const frame = parseFrameHex('GOOSE', loadHex('synthetic/goose_v5_get_hello_frame.hex'));
    expect(motionFeatureFromFrame(frame)).toBeNull();
  });
});
