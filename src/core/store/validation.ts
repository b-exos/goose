/**
 * Store input validation, ported from the `validate_*` helpers and `ALLOWED_*`
 * allow-lists in `docs/rust-reference/src/store.rs`. Error messages match the Rust
 * originals so behaviour is identical. Each throws a `StoreValidationError` on failure.
 */

export class StoreValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreValidationError';
  }
}

export const ALLOWED_ACTIVITY_SYNC_STATUSES = [
  'candidate', 'verified', 'user_confirmed', 'synced', 'blocked', 'discarded',
] as const;

export const ALLOWED_ACTIVITY_TYPES = [
  'unknown', 'running', 'walking', 'cycling', 'jogging', 'strength', 'weightlifting',
  'powerlifting', 'swimming', 'rowing', 'hiit', 'hiking', 'hiking_rucking',
  'functional_fitness', 'machine_workout', 'martial_arts', 'boxing', 'kickboxing',
  'rock_climbing', 'climber', 'pilates', 'yoga', 'hot_yoga', 'restorative_yoga',
  'meditation', 'breathwork', 'non_sleep_deep_rest', 'ice_bath', 'sauna', 'manual',
  'manual_labor', 'commuting', 'cleaning', 'cooking', 'driving', 'dog_walking',
  'stroller_walking', 'stroller_jogging', 'race_walking', 'spinning', 'elliptical',
  'team_sport', 'padel', 'barre', 'barre3', 'other', 'other_recovery', 'nap',
] as const;

export const ALLOWED_ACTIVITY_DETECTION_METHODS = [
  'user_assigned', 'heuristic_motion', 'heuristic_hr_motion', 'machine_learning',
  'official_capture', 'imported', 'manual_split', 'manual_merge', 'manual_annotation',
] as const;

export const ALLOWED_ACTIVITY_INTERVAL_TYPES = [
  'lap', 'pause', 'work', 'rest', 'window', 'split',
] as const;

export const ALLOWED_EXTERNAL_SLEEP_PLATFORMS = [
  'healthkit', 'health_connect', 'manual', 'import',
] as const;

export const ALLOWED_EXTERNAL_SLEEP_STAGE_KINDS = [
  'in_bed', 'asleep', 'awake', 'core', 'deep', 'rem', 'unknown', 'not_applicable',
] as const;

export const ALLOWED_ACTIVITY_METRIC_UNITS = [
  'raw', 'bpm', 'ms', 'hz', 'count', 'steps', 'm', 'km', 'mi', 'kcal', 'm/s', 'km/h',
  'min', 's', 'percent', 'ratio', 'load', 'joule', 'w', 'kg', 'm/s2', 'c', 'f', 'degrees', 'n/a',
] as const;

/** Non-empty (after trim). */
export function validateRequired(name: string, value: string): void {
  if (value.trim().length === 0) {
    throw new StoreValidationError(`${name} is required`);
  }
}

/** Non-empty if present. */
export function validateOptionalRequired(name: string, value: string | null | undefined): void {
  if (value !== null && value !== undefined) validateRequired(name, value);
}

/** Integer >= 0. */
export function validateNonNegative(name: string, value: number): void {
  if (value < 0) throw new StoreValidationError(`${name} must be non-negative`);
}

/** Window must be strictly ordered. */
export function validateWindowOrder(startMs: number, endMs: number): void {
  if (endMs <= startMs) {
    throw new StoreValidationError('end_time_unix_ms must be greater than start_time_unix_ms');
  }
}

/** Finite confidence in [0, 1]. */
export function validateConfidence(name: string, confidence: number): void {
  if (!Number.isFinite(confidence)) throw new StoreValidationError(`${name} must be finite`);
  if (confidence < 0 || confidence > 1) {
    throw new StoreValidationError(`${name} must be between 0.0 and 1.0`);
  }
}

/** Value must be one of the allow-list. */
export function validateAllowed(name: string, value: string, allowed: readonly string[]): void {
  if (!allowed.includes(value)) {
    throw new StoreValidationError(`${name} must be one of: ${allowed.join(', ')}`);
  }
}

/** Must parse as JSON. */
export function validateJson(name: string, value: string): void {
  try {
    JSON.parse(value);
  } catch (error) {
    throw new StoreValidationError(`${name} must be valid JSON: ${String(error)}`);
  }
}

/** Must parse as a JSON object. */
export function validateJsonObject(name: string, value: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new StoreValidationError(`${name} must be valid JSON: ${String(error)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new StoreValidationError(`${name} must be a JSON object`);
  }
}
