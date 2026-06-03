/**
 * Pulse detection on a raw optical (PPG) waveform → beat-to-beat RR intervals.
 *
 * The WHOOP 5.0 gives raw optical ADC samples (~25 Hz, DC-heavy with a small pulsatile AC),
 * not RR intervals. This recovers RR by detrending out the DC/drift, finding pulse peaks with a
 * refractory minimum spacing, and converting peak spacing to milliseconds. The RR intervals feed
 * the existing `gooseHrvV0` → `gooseRecoveryV0` cores. HR derived here is validated on-device
 * against the band's own HR stream before trusting HRV.
 */

/** Plausible RR-interval range (ms): ~30–200 bpm. */
const RR_MIN_MS = 300;
const RR_MAX_MS = 2000;
/** Detrend window (seconds): wide enough to keep the pulse AC, narrow enough to remove drift. */
const DETREND_WINDOW_SEC = 1.5;
/** Refractory period (seconds): no two beats closer than this (caps at ~200 bpm). */
const MIN_BEAT_GAP_SEC = 0.33;

export interface PulseResult {
  rrIntervalsMs: number[];
  beatCount: number;
  /** Median-RR heart rate (bpm), for validation against the band's reported HR. */
  hrBpm: number | null;
}

/** Centered moving average; window is forced odd so it doesn't shift the signal phase. */
function movingAverage(x: number[], window: number): number[] {
  const half = Math.floor(window / 2);
  const out = new Array<number>(x.length);
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    sum += x[i];
    if (i - window >= 0) sum -= x[i - window];
    // trailing-window sum at i; convert to centered by indexing out[i-half]
    const center = i - half;
    if (center >= 0) {
      const count = Math.min(i + 1, window);
      out[center] = sum / count;
    }
  }
  // tail: fill remaining centers with the last available average
  for (let i = Math.max(0, x.length - half); i < x.length; i++) {
    if (out[i] === undefined) out[i] = x[i];
  }
  for (let i = 0; i < x.length; i++) if (out[i] === undefined) out[i] = x[i];
  return out;
}

/**
 * Detect RR intervals (ms) from a PPG sample array at `sampleRateHz`. Returns plausible
 * beat-to-beat intervals plus a median-RR HR estimate. Empty if the signal is too short/flat.
 */
export function detectRrIntervalsMs(samples: number[], sampleRateHz: number): PulseResult {
  const empty: PulseResult = { rrIntervalsMs: [], beatCount: 0, hrBpm: null };
  if (samples.length < sampleRateHz * 3 || sampleRateHz <= 0) return empty;

  const detrendWin = Math.max(3, Math.round(DETREND_WINDOW_SEC * sampleRateHz));
  const baseline = movingAverage(samples, detrendWin);
  const ac = samples.map((v, i) => v - baseline[i]);

  // Adaptive amplitude threshold: a fraction of the AC standard deviation.
  const mean = ac.reduce((s, v) => s + v, 0) / ac.length;
  const std = Math.sqrt(ac.reduce((s, v) => s + (v - mean) ** 2, 0) / ac.length);
  const threshold = std * 0.3;
  const minGap = Math.max(1, Math.round(MIN_BEAT_GAP_SEC * sampleRateHz));

  const peakIndices: number[] = [];
  for (let i = 1; i < ac.length - 1; i++) {
    if (ac[i] <= threshold) continue;
    if (ac[i] < ac[i - 1] || ac[i] < ac[i + 1]) continue; // local maximum
    const last = peakIndices[peakIndices.length - 1];
    if (last !== undefined && i - last < minGap) {
      // keep the taller of two too-close peaks
      if (ac[i] > ac[last]) peakIndices[peakIndices.length - 1] = i;
      continue;
    }
    peakIndices.push(i);
  }

  const msPerSample = 1000 / sampleRateHz;
  const rrIntervalsMs: number[] = [];
  for (let i = 1; i < peakIndices.length; i++) {
    const rr = (peakIndices[i] - peakIndices[i - 1]) * msPerSample;
    if (rr >= RR_MIN_MS && rr <= RR_MAX_MS) rrIntervalsMs.push(rr);
  }
  if (rrIntervalsMs.length === 0) return empty;

  const sorted = [...rrIntervalsMs].sort((a, b) => a - b);
  const medianRr = sorted[Math.floor(sorted.length / 2)];
  return {
    rrIntervalsMs,
    beatCount: peakIndices.length,
    hrBpm: medianRr > 0 ? Math.round(60000 / medianRr) : null,
  };
}
