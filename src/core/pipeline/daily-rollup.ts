/**
 * Daily rollup: turn a day's HR + motion samples into metric runs.
 *
 * MVP scope — what's derivable from HR + motion alone: resting HR, strain (HR-zone load),
 * and energy (kcal). Recovery/HRV need RR-interval decoding (optical R17), so they're
 * computed only when RR samples are supplied; otherwise reported as unavailable. The compute
 * step is pure; `runDailyRollup` fetches frames, computes, and persists.
 */
import { estimateRestingHeartRate, type HeartRateSample, type MotionSample } from '../features/resting-hr';
import { mean } from '../math';
import { gooseStrainV0, type StrainScoreOutput } from '../metrics/strain';
import type { SleepScoreOutput } from '../metrics/sleep';
import { estimateDailyEnergy, type DailyEnergyEstimate } from '../activity/energy';
import { persistAlgorithmRun } from '../store/algorithm-run-repository';
import { decodedFramesForExtraction } from '../store/capture-repository';
import type { GooseDatabase } from '../store/db';
import type { AlgorithmRunResult } from '../types';
import { extractHeartRateSamples, extractMotionSamples } from './extract';
import { computeSleepScore, detectSleepWindow } from './sleep-window';

export interface DailyProfile {
  weightKg?: number;
  maxHrBpm?: number;
  hasAge?: boolean;
  hasSex?: boolean;
}

export interface DailyMetrics {
  hrSampleCount: number;
  motionSampleCount: number;
  restingHrBpm: number | null;
  strain: AlgorithmRunResult<StrainScoreOutput> | null;
  energy: DailyEnergyEstimate | null;
  sleep: AlgorithmRunResult<SleepScoreOutput> | null;
  /** True when recovery/HRV could not be computed (no RR intervals available). */
  recoveryUnavailable: boolean;
}

const DEFAULT_MAX_HR = 180;
const DEFAULT_WEIGHT_KG = 70;
const MAX_GAP_MINUTES = 10;

/** HR-zone minutes by %HR-reserve, attributing each inter-sample gap to the earlier sample's zone. */
export function hrZoneMinutes(samples: HeartRateSample[], restingHr: number, maxHr: number): number[] {
  const zones = [0, 0, 0, 0, 0];
  const reserve = Math.max(maxHr - restingHr, 1);
  const sorted = [...samples].sort((a, b) => a.timeUnixMs - b.timeUnixMs);
  for (let i = 0; i < sorted.length - 1; i++) {
    const dtMin = (sorted[i + 1].timeUnixMs - sorted[i].timeUnixMs) / 60000;
    if (dtMin <= 0 || dtMin > MAX_GAP_MINUTES) continue;
    const frac = Math.min(Math.max((sorted[i].heartRateBpm - restingHr) / reserve, 0), 1);
    const zone = Math.min(Math.floor(frac / 0.2), 4);
    zones[zone] += dtMin;
  }
  return zones;
}

/** Compute the day's derivable metrics from HR + motion samples (pure). */
export function computeDailyMetrics(
  hrSamples: HeartRateSample[],
  motionSamples: MotionSample[],
  startTime: string,
  endTime: string,
  profile: DailyProfile = {},
): DailyMetrics {
  const resting = estimateRestingHeartRate(hrSamples, motionSamples);
  const restingHrBpm = resting?.restingHrBpm ?? null;

  let strain: AlgorithmRunResult<StrainScoreOutput> | null = null;
  let energy: DailyEnergyEstimate | null = null;

  if (hrSamples.length >= 2 && restingHrBpm !== null) {
    const bpms = hrSamples.map((s) => s.heartRateBpm);
    const maxHrBpm = profile.maxHrBpm ?? Math.max(DEFAULT_MAX_HR, ...bpms);
    const zones = hrZoneMinutes(hrSamples, restingHrBpm, maxHrBpm);
    const durationMinutes = zones.reduce((sum, z) => sum + z, 0);

    if (durationMinutes > 0 && maxHrBpm > restingHrBpm) {
      const averageHrBpm = mean(bpms);
      strain = gooseStrainV0({
        startTime,
        endTime,
        durationMinutes,
        restingHrBpm,
        averageHrBpm,
        maxHrBpm,
        hrZoneMinutes: zones,
        inputIds: ['pipeline.daily'],
      });
      const weightKg = profile.weightKg ?? DEFAULT_WEIGHT_KG;
      energy = estimateDailyEnergy(
        {
          weightKg,
          coveredMinutes: durationMinutes,
          hrZoneMinutes: zones,
          averageHrBpm,
          restingHrBpm,
          maxHrBpm,
          averageMotionIntensity0To1: motionSamples.length
            ? mean(motionSamples.map((m) => m.motionIntensity0To1))
            : null,
        },
        24 * 60,
        {
          hasWeight: profile.weightKg != null,
          hasAge: profile.hasAge ?? false,
          hasSex: profile.hasSex ?? false,
          heartRateSampleCount: hrSamples.length,
          minHeartRateSamples: 10,
          motionSampleCount: motionSamples.length,
          hasDeviceStepCadenceSupport: false,
          coveredMinutes: durationMinutes,
          requestedMinutes: 24 * 60,
        },
      );
    }
  }

  const sleepWindow = detectSleepWindow(motionSamples, hrSamples);
  const sleep = sleepWindow ? computeSleepScore(sleepWindow, startTime, endTime) : null;

  return {
    hrSampleCount: hrSamples.length,
    motionSampleCount: motionSamples.length,
    restingHrBpm,
    strain,
    energy,
    sleep,
    recoveryUnavailable: true, // until RR-interval / HRV decoding lands
  };
}

export interface DailyRollupOptions {
  dateKey: string; // YYYY-MM-DD
  startIso: string;
  endIso: string;
  timezone: string;
  profile?: DailyProfile;
}

/**
 * Fetch a day's decoded frames, compute the derivable metrics, and persist them
 * (strain run + daily recovery/activity rollup rows). Idempotent per date via stable ids.
 */
export async function runDailyRollup(
  db: GooseDatabase,
  options: DailyRollupOptions,
): Promise<DailyMetrics> {
  const rows = await decodedFramesForExtraction(db, options.startIso, options.endIso);
  const hrSamples = extractHeartRateSamples(rows);
  const motionSamples = extractMotionSamples(rows);
  const metrics = computeDailyMetrics(hrSamples, motionSamples, options.startIso, options.endIso, options.profile);

  const startMs = Date.parse(options.startIso);
  const endMs = Date.parse(options.endIso);

  if (metrics.strain) {
    await persistAlgorithmRun(db, `${options.dateKey}.strain`, metrics.strain);
  }
  if (metrics.sleep) {
    await persistAlgorithmRun(db, `${options.dateKey}.sleep`, metrics.sleep);
  }

  if (metrics.restingHrBpm !== null) {
    await db.runAsync(
      `INSERT OR REPLACE INTO daily_recovery_metrics
         (daily_metric_id, date_key, timezone, start_time_unix_ms, end_time_unix_ms,
          resting_hr_bpm, source_kind, confidence, provenance_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`rec-${options.dateKey}`, options.dateKey, options.timezone, startMs, endMs,
        metrics.restingHrBpm, 'device_sensor', 0.7, '{"pipeline":"daily-rollup"}'],
    );
  }

  if (metrics.energy) {
    await db.runAsync(
      `INSERT OR REPLACE INTO daily_activity_metrics
         (daily_metric_id, date_key, timezone, start_time_unix_ms, end_time_unix_ms,
          active_kcal, resting_kcal, total_kcal, source_kind, confidence, provenance_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`act-${options.dateKey}`, options.dateKey, options.timezone, startMs, endMs,
        metrics.energy.activeKcal, metrics.energy.restingKcal, metrics.energy.totalKcal,
        'local_estimate', metrics.energy.confidence, '{"pipeline":"daily-rollup"}'],
    );
  }

  return metrics;
}
