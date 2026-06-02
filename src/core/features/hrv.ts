/**
 * HRV feature extraction: aggregate per-frame RR intervals into a windowed HRV result,
 * per-day RMSSD, and a median-RMSSD baseline.
 *
 * Ported from `run_hrv_feature_report` / `daily_hrv_features` / `hrv_baseline_feature`
 * (metric_features.rs). Decoupled from frame-plan extraction: callers pass HRV samples
 * (each carrying its RR intervals). Builds on the golden-tested `gooseHrvV0`.
 */
import { median } from '../math';
import { gooseHrvV0, type HrvInput, type HrvOutput } from '../metrics/hrv';
import type { AlgorithmRunResult } from '../types';

/** One HRV sample (e.g. derived from an R17 optical frame). */
export interface HrvFeatureSample {
  metricInputId: string;
  capturedAt: string;
  rrIntervalsMs: number[];
  trusted?: boolean;
}

export interface HrvDayFeature {
  date: string;
  rmssdMs: number;
  rrIntervalCount: number;
  trustedMetricInput: boolean;
  inputIds: string[];
}

export interface HrvBaselineFeature {
  hrvBaselineRmssdMs: number;
  method: 'median_daily_rmssd';
  dayCount: number;
  trustedMetricInput: boolean;
}

/** UTC date key (`YYYY-MM-DD`) from an RFC3339 timestamp, or null if too short. */
function featureDate(capturedAt: string): string | null {
  return capturedAt.length >= 10 ? capturedAt.slice(0, 10) : null;
}

/**
 * Aggregate all RR intervals across samples and run HRV v0 over the window.
 * Returns null when there aren't enough intervals to compute.
 */
export function aggregateHrv(
  samples: HrvFeatureSample[],
  startTime: string,
  endTime: string,
  minRrIntervalsToCompute: number,
): AlgorithmRunResult<HrvOutput> | null {
  const rrIntervalsMs = samples.flatMap((s) => s.rrIntervalsMs);
  if (rrIntervalsMs.length < minRrIntervalsToCompute) return null;
  const inputIds = samples.map((s) => s.metricInputId).sort();
  const input: HrvInput = { startTime, endTime, rrIntervalsMs, inputIds };
  return gooseHrvV0(input);
}

/** Per-day HRV features (date → daily RMSSD), skipping days below the RR threshold. */
export function dailyHrvFeatures(
  samples: HrvFeatureSample[],
  minRrIntervalsToCompute: number,
): HrvDayFeature[] {
  const byDate = new Map<string, HrvFeatureSample[]>();
  for (const sample of samples) {
    const date = featureDate(sample.capturedAt);
    if (date === null) continue;
    const bucket = byDate.get(date);
    if (bucket) bucket.push(sample);
    else byDate.set(date, [sample]);
  }

  const days: HrvDayFeature[] = [];
  for (const date of [...byDate.keys()].sort()) {
    const features = byDate.get(date)!;
    const rrIntervalsMs = features.flatMap((f) => f.rrIntervalsMs);
    if (rrIntervalsMs.length < minRrIntervalsToCompute) continue;
    const inputIds = features.map((f) => f.metricInputId).sort();
    const result = gooseHrvV0({
      startTime: `${date}T00:00:00Z`,
      endTime: `${date}T23:59:59Z`,
      rrIntervalsMs,
      inputIds,
    });
    if (!result.output) continue;
    days.push({
      date,
      rmssdMs: result.output.rmssdMs,
      rrIntervalCount: rrIntervalsMs.length,
      trustedMetricInput: features.every((f) => f.trusted !== false),
      inputIds,
    });
  }
  return days;
}

/** Median-of-daily-RMSSD baseline, or null if fewer than `baselineMinDays` days. */
export function hrvBaseline(
  daily: HrvDayFeature[],
  baselineMinDays: number,
): HrvBaselineFeature | null {
  if (baselineMinDays === 0 || daily.length < baselineMinDays) return null;
  return {
    hrvBaselineRmssdMs: median(daily.map((d) => d.rmssdMs)),
    method: 'median_daily_rmssd',
    dayCount: daily.length,
    trustedMetricInput: daily.every((d) => d.trustedMetricInput),
  };
}
