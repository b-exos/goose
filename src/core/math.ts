/**
 * Numeric helpers shared by the metric algorithms.
 *
 * Ported 1:1 from the Rust core (`docs/rust-reference/src/metrics.rs`). The exact
 * formulas matter: golden tests assert byte-for-byte parity with the original engine,
 * so these must reproduce the Rust arithmetic (including the n-1 divisors) precisely.
 */

/** Arithmetic mean. Caller guarantees `values.length >= 1`. */
export function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Root mean square of successive differences.
 * Sum of squared adjacent diffs divided by (n - 1), then square-rooted.
 */
export function rmssd(values: number[]): number {
  let sumSq = 0;
  for (let i = 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq / (values.length - 1));
}

/** Sample standard deviation (n - 1 denominator). Returns 0 for fewer than 2 values. */
export function sampleSd(values: number[], meanValue: number): number {
  if (values.length < 2) {
    return 0;
  }
  let sumSq = 0;
  for (const value of values) {
    const diff = value - meanValue;
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq / (values.length - 1));
}

/** Median of a list (average of the two middle values for even counts). Caller ensures non-empty. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Fraction of successive interval pairs differing by more than 50 ms. */
export function pnn50(values: number[]): number {
  let aboveThreshold = 0;
  for (let i = 1; i < values.length; i++) {
    if (Math.abs(values[i] - values[i - 1]) > 50) {
      aboveThreshold += 1;
    }
  }
  return aboveThreshold / (values.length - 1);
}
