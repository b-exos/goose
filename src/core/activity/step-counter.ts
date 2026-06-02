/**
 * Device step-counter aggregation: turn a time-ordered sequence of cumulative counter
 * samples into a daily step total with quality/confidence.
 *
 * Ported from `summarize_step_counter_segments`, `step_counter_confidence`,
 * `average_cadence_spm`, and the core of `rollup_device_step_counter_day` in
 * `docs/rust-reference/src/step_counter.rs`. The aggregation is pure over the sample list
 * (the store provides them time-ordered); the persistence wrapper lives in the repository.
 */

export const GOOSE_STEPS_DEVICE_COUNTER_V0_ID = 'goose.steps.device_counter.v0';
export const GOOSE_STEPS_DEVICE_COUNTER_V0_VERSION = '0.1.0';

/** One decoded step-counter reading (cumulative `counterValue`). */
export interface StepCounterSample {
  sampleId: string;
  sampleTimeUnixMs: number;
  counterValue: number;
  cadenceSpm?: number | null;
  activityState?: string | null;
}

export interface StepSegmentSummary {
  steps: number;
  usableSegmentCount: number;
  resetCount: number;
  duplicateSampleCount: number;
  sameTimestampConflictCount: number;
  firstCounterValue: number | null;
  lastCounterValue: number | null;
  qualityFlags: string[];
}

/**
 * Walk adjacent samples summing positive counter deltas into steps, while detecting
 * resets, duplicates, and same-timestamp conflicts. `samples` must be time-ordered.
 */
export function summarizeStepCounterSegments(samples: StepCounterSample[]): StepSegmentSummary {
  const flags = new Set<string>();
  let steps = 0;
  let usableSegmentCount = 0;
  let resetCount = 0;
  let duplicateSampleCount = 0;
  let sameTimestampConflictCount = 0;

  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    if (cur.sampleTimeUnixMs === prev.sampleTimeUnixMs) {
      if (cur.counterValue === prev.counterValue) {
        duplicateSampleCount += 1;
        flags.add('duplicate_sample');
      } else {
        sameTimestampConflictCount += 1;
        flags.add('same_timestamp_counter_conflict');
      }
      continue;
    }
    if (cur.counterValue >= prev.counterValue) {
      steps += cur.counterValue - prev.counterValue;
      usableSegmentCount += 1;
    } else {
      resetCount += 1;
      flags.add('counter_reset_detected');
    }
  }

  return {
    steps,
    usableSegmentCount,
    resetCount,
    duplicateSampleCount,
    sameTimestampConflictCount,
    firstCounterValue: samples.length > 0 ? samples[0].counterValue : null,
    lastCounterValue: samples.length > 0 ? samples[samples.length - 1].counterValue : null,
    qualityFlags: [...flags].sort(),
  };
}

/** Confidence in [0.50, 0.95], penalized by resets/duplicates/conflicts. */
export function stepCounterConfidence(summary: StepSegmentSummary): number {
  const penalty =
    summary.resetCount * 0.1 +
    summary.duplicateSampleCount * 0.02 +
    summary.sameTimestampConflictCount * 0.1;
  return Math.min(Math.max(0.95 - penalty, 0.5), 0.95);
}

/** Mean cadence across samples that report one, or null. */
export function averageCadenceSpm(samples: StepCounterSample[]): number | null {
  const cadences = samples.map((s) => s.cadenceSpm).filter((c): c is number => c != null);
  if (cadences.length === 0) return null;
  return cadences.reduce((sum, c) => sum + c, 0) / cadences.length;
}

export interface StepCounterDailyRollupOptions {
  dateKey: string;
  timezone: string;
  minSampleCount: number;
}

export interface StepCounterDailyRollupReport {
  schema: 'goose.step-counter-daily-rollup-report.v1';
  pass: boolean;
  dateKey: string;
  timezone: string;
  sampleCount: number;
  steps: number | null;
  usableSegmentCount: number;
  resetCount: number;
  duplicateSampleCount: number;
  sameTimestampConflictCount: number;
  averageCadenceSpm: number | null;
  confidence: number;
  qualityFlags: string[];
  issues: string[];
}

/**
 * Roll the day's samples into a step total + quality report (pure; no persistence).
 * Mirrors the non-store parts of `rollup_device_step_counter_day`.
 */
export function rollupStepCounterDay(
  samples: StepCounterSample[],
  options: StepCounterDailyRollupOptions,
): StepCounterDailyRollupReport {
  const issues: string[] = [];
  if (samples.length < options.minSampleCount) {
    issues.push('insufficient_step_counter_samples');
  }
  const summary = summarizeStepCounterSegments(samples);
  const qualityFlags = [...summary.qualityFlags];
  if (samples.length >= options.minSampleCount) {
    qualityFlags.unshift('counter_delta');
  }
  if (summary.usableSegmentCount === 0 && samples.length >= options.minSampleCount) {
    issues.push('no_usable_step_counter_segments');
  }
  const dedupedSorted = [...new Set(qualityFlags)].sort();

  const pass = issues.length === 0;
  const confidence = pass ? stepCounterConfidence(summary) : 0;
  return {
    schema: 'goose.step-counter-daily-rollup-report.v1',
    pass,
    dateKey: options.dateKey,
    timezone: options.timezone,
    sampleCount: samples.length,
    steps: pass ? summary.steps : null,
    usableSegmentCount: summary.usableSegmentCount,
    resetCount: summary.resetCount,
    duplicateSampleCount: summary.duplicateSampleCount,
    sameTimestampConflictCount: summary.sameTimestampConflictCount,
    averageCadenceSpm: pass ? averageCadenceSpm(samples) : null,
    confidence,
    qualityFlags: dedupedSorted,
    issues,
  };
}
