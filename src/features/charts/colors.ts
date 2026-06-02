/**
 * WHOOP-style status color scales for the metric visuals.
 * Recovery: red/yellow/green bands. Strain: a blue ramp. Sleep performance: like recovery.
 */
export const STATUS_RED = '#FF3B30';
export const STATUS_YELLOW = '#FFCC00';
export const STATUS_GREEN = '#34C759';
export const STRAIN_BLUE = '#0A84FF';
export const NEUTRAL = '#8E8E93';

/** Recovery 0–100 → red (<34) / yellow (34–66) / green (≥67). */
export function recoveryColor(score: number | null): string {
  if (score === null) return NEUTRAL;
  if (score < 34) return STATUS_RED;
  if (score < 67) return STATUS_YELLOW;
  return STATUS_GREEN;
}

/** Sleep performance % → same banding as recovery. */
export function sleepColor(score: number | null): string {
  return recoveryColor(score);
}

/** Strain uses a single accent regardless of value (intensity conveyed by fill fraction). */
export function strainColor(_score: number | null): string {
  return STRAIN_BLUE;
}
