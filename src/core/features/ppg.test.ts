/** Tests raw-optical (k20) channel extraction against an on-device captured packet. */
import { extractK20Channels, stitchK20Channels } from './ppg';

// A real k20 frame payload captured on-device (one optical channel block of 25 samples).
const K20_ONE_CHANNEL =
  '2b14819f403700df01206a3d4a04001900001901d60604ac0d0320000000200304200000002003' +
  'd29e0200d4a40200eaa702009aa9020034ab0200ecac0200adac020065aa0200beb3020074bf0200' +
  '8bc6020030cb020041ce020068d0020067d202005ad30200e2d1020076d0020033d1020042d30200' +
  '04d5020015d70200edd802000fda02008eda0200';

describe('k20 PPG extraction', () => {
  it('extracts the channel sample block from a real k20 packet', () => {
    const result = extractK20Channels(K20_ONE_CHANNEL)!;
    expect(result).not.toBeNull();
    expect(result.timestampSeconds).toBeGreaterThan(1_700_000_000); // plausible 2024+ unix
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].samples).toHaveLength(25);
    // Smooth rising optical curve: first sample ~171730, monotone-ish, last ~187022.
    expect(result.blocks[0].samples[0]).toBe(171730);
    expect(result.blocks[0].samples[24]).toBe(187022);
  });

  it('returns null for a non-k20 payload', () => {
    expect(extractK20Channels('2b150000')).toBeNull(); // k=21, not 20
  });

  it('groups blocks by slot offset across packets, in counter order', () => {
    // Two packets; the channel at offset 13 and the channel at offset 50, ordered by counter.
    const a = {
      counter: 2,
      timestampSeconds: 1,
      blocks: [{ offset: 13, samples: [3, 4] }, { offset: 50, samples: [300, 400] }],
    };
    const b = {
      counter: 1,
      timestampSeconds: 0,
      blocks: [{ offset: 13, samples: [1, 2] }, { offset: 50, samples: [100, 200] }],
    };
    const stitched = stitchK20Channels([a, b]);
    expect(stitched).toHaveLength(2);
    expect(stitched).toContainEqual([1, 2, 3, 4]); // offset-13 channel, counter-ordered
    expect(stitched).toContainEqual([100, 200, 300, 400]); // offset-50 channel
  });
});
