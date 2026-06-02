/**
 * Shared scoring primitives for the weighted-component metric algorithms
 * (strain, stress, recovery, sleep).
 *
 * Ported from the helpers in `docs/rust-reference/src/metrics.rs`
 * (`score_component`, `component_sum`, `clamp_*`, `require_*`). The contribution
 * formula and clamp behaviour are load-bearing for golden parity.
 */

/** A weighted sub-score: raw value, its 0–100 score, weight, and 0–scale contribution. */
export interface ScoreComponent {
  name: string;
  value: number;
  unit: string;
  score0To100: number;
  weight: number;
  contribution: number;
}

/** Clamp to [0, max]; non-finite inputs collapse to 0 (matches Rust `clamp_0_to`). */
export function clamp0To(max: number, value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(value, 0), max);
}

/** Clamp to [0, 100]. */
export function clamp0100(value: number): number {
  return clamp0To(100, value);
}

/** Clamp to [0, 1]. */
export function clampFraction(value: number): number {
  return clamp0To(1, value);
}

/**
 * Build a scored component. `score0To100` is clamped, and the contribution is
 * `clampedScore / 100 * outputScale * weight` — the value that `componentSum` totals.
 */
export function scoreComponent(
  name: string,
  value: number,
  unit: string,
  score0To100: number,
  weight: number,
  outputScale: number,
): ScoreComponent {
  const clamped = clamp0100(score0To100);
  return {
    name,
    value,
    unit,
    score0To100: clamped,
    weight,
    contribution: (clamped / 100) * outputScale * weight,
  };
}

/** Sum of component contributions — the final metric score. */
export function componentSum(components: ScoreComponent[]): number {
  return components.reduce((sum, c) => sum + c.contribution, 0);
}

/** Push a `<name>_must_be_finite_positive` error when value is non-finite or <= 0. */
export function requireFinitePositive(
  name: string,
  value: number,
  errors: string[],
): void {
  if (!Number.isFinite(value) || value <= 0) {
    errors.push(`${name}_must_be_finite_positive`);
  }
}

/** Push a `<name>_must_be_finite_non_negative` error when value is non-finite or < 0. */
export function requireFiniteNonNegative(
  name: string,
  value: number,
  errors: string[],
): void {
  if (!Number.isFinite(value) || value < 0) {
    errors.push(`${name}_must_be_finite_non_negative`);
  }
}

/** Push a `<name>_must_be_between_<min>_and_<max>` error when out of [min, max]. */
export function requireBounded(
  name: string,
  value: number,
  min: number,
  max: number,
  errors: string[],
): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    errors.push(`${name}_must_be_between_${min}_and_${max}`);
  }
}
