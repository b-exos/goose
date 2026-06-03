/** Tests PPG pulse detection on a synthetic known-HR signal and a real captured waveform window. */
import { detectRrIntervalsMs } from './ppg-pulse';

describe('PPG pulse detection', () => {
  it('recovers HR from a synthetic 60 bpm signal at 25 Hz', () => {
    // 1 Hz sine (60 bpm) on a DC baseline, 20 s at 25 Hz.
    const rate = 25;
    const samples: number[] = [];
    for (let i = 0; i < rate * 20; i++) {
      samples.push(100_000 + 300 * Math.sin((2 * Math.PI * i) / rate));
    }
    const result = detectRrIntervalsMs(samples, rate);
    expect(result.hrBpm).toBeGreaterThanOrEqual(57);
    expect(result.hrBpm).toBeLessThanOrEqual(63);
    expect(result.rrIntervalsMs.length).toBeGreaterThan(10);
  });

  it('recovers a plausible HR (~50-75 bpm) from a real captured PPG window', () => {
    // Real best-channel window captured on-device (~25 Hz, pulse period ~25 samples).
    const real = [
      113378, 113392, 113401, 113410, 113413, 113420, 113439, 113436, 113442, 113448, 113474,
      113483, 113483, 113458, 113324, 113231, 113303, 113325, 113335, 113332, 113366, 113390,
      113375, 113377, 113358, 113385, 113379, 113388, 113373, 113416, 113431, 113445, 113448,
      113451, 113490, 113499, 113506, 113540, 113498, 113434, 113379, 113337, 113332, 113331,
      113326, 113332, 113328, 113340, 113340, 113357, 113346, 113355, 113364, 113376, 113385,
      113390, 113397, 113408, 113418, 113410, 113430, 113444, 113443, 113487, 113482, 113411,
      113327, 113288, 113284, 113309, 113302, 113331, 113329, 113314, 113338, 113322, 113318,
      113320, 113327, 113346, 113347, 113359, 113385, 113382, 113392, 113410, 113413, 113422,
      113452, 113465, 113454, 113367, 113307, 113308, 113265, 113254, 113229, 113256, 113275,
      113262, 113247, 113247, 113250, 113260, 113291, 113307, 113321, 113334, 113353, 113368,
      113388, 113389, 113418, 113449, 113471, 113488, 113496, 113498, 113443, 113397,
    ];
    const result = detectRrIntervalsMs(real, 25);
    expect(result.beatCount).toBeGreaterThanOrEqual(3);
    expect(result.hrBpm).not.toBeNull();
    expect(result.hrBpm!).toBeGreaterThanOrEqual(45);
    expect(result.hrBpm!).toBeLessThanOrEqual(80);
  });

  it('returns empty for a too-short signal', () => {
    expect(detectRrIntervalsMs([1, 2, 3], 25).rrIntervalsMs).toEqual([]);
  });
});
