/**
 * Daily rollup: turn a day's HR + motion samples into metric runs.
 *
 * Scope: resting HR, strain (HR-zone load), energy (kcal), and sleep from HR + motion;
 * plus HRV + recovery when RR-interval samples (optical R17) are available. Recovery uses
 * neutral placeholders for the not-yet-decoded vitals (respiratory rate, skin temp), so it's
 * HRV/RHR/sleep-driven. The compute step is pure; `runDailyRollup` fetches frames, queries
 * baselines, computes, and persists.
 */
import { estimateRestingHeartRate, type HeartRateSample, type MotionSample } from '../features/resting-hr';
import { aggregateHrv, type HrvFeatureSample } from '../features/hrv';
import { mean } from '../math';
import type { HrvOutput } from '../metrics/hrv';
import { gooseRecoveryV0, type RecoveryScoreOutput } from '../metrics/recovery';
import { gooseStrainV0, type StrainScoreOutput } from '../metrics/strain';
import type { SleepScoreOutput } from '../metrics/sleep';
import { estimateDailyEnergy, type DailyEnergyEstimate } from '../activity/energy';
import { persistAlgorithmRun } from '../store/algorithm-run-repository';
import { decodedFramesForExtraction } from '../store/capture-repository';
import type { GooseDatabase } from '../store/db';
import type { AlgorithmRunResult } from '../types';
import {
  extractHeartRateSamples,
  extractMotionSamples,
  extractPpgRrIntervals,
  extractRrIntervals,
} from './extract';
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
  hrv: AlgorithmRunResult<HrvOutput> | null;
  recovery: AlgorithmRunResult<RecoveryScoreOutput> | null;
  /** True when recovery/HRV could not be computed (no usable RR intervals). */
  recoveryUnavailable: boolean;
  /**
   * - `unavailable`: no HRV (no usable optical RR).
   * - `calibrating`: HRV exists but there's no personal baseline yet, so a score would be a
   *   meaningless neutral default — withheld until enough history accrues.
   * - `available`: HRV + a real baseline → the score is meaningful.
   */
  recoveryStatus: 'unavailable' | 'calibrating' | 'available';
}

/** Baselines + prior-day context for recovery; absent fields fall back to neutral. */
export interface RecoveryInputs {
  rrSamples: HrvFeatureSample[];
  hrvBaselineRmssdMs?: number | null;
  restingHrBaselineBpm?: number | null;
  priorStrain0To21?: number | null;
}

const DEFAULT_MAX_HR = 180;
const DEFAULT_WEIGHT_KG = 70;
const MAX_GAP_MINUTES = 10;
/** Minimum RR intervals before HRV/recovery is trustworthy (vs. the reference's noisy 2). */
const MIN_RR_FOR_RECOVERY = 30;
/** Neutral respiratory rate for the recovery model until a respiratory decoder lands. */
const NEUTRAL_RESPIRATORY_RPM = 14;
/** Neutral sleep score when no sleep window was detected for the day. */
const NEUTRAL_SLEEP_SCORE = 70;
/** Prior nights of sleep-HRV/RHR needed before a recovery score is meaningful (vs. calibrating). */
const MIN_BASELINE_NIGHTS = 3;
/** Raw optical (R20) packet_k — the high-volume PPG family, only needed for sleep-window HRV. */
const OPTICAL_PACKET_K = 20;

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

/** Compute the day's derivable metrics from HR + motion (+ optional RR) samples (pure). */
export function computeDailyMetrics(
  hrSamples: HeartRateSample[],
  motionSamples: MotionSample[],
  startTime: string,
  endTime: string,
  profile: DailyProfile = {},
  recoveryInputs: RecoveryInputs = { rrSamples: [] },
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
      // Strain accrues from effort ABOVE rest: zero out zone 0 (sedentary) so a long day of
      // sitting doesn't pile up strain. Zones 1–4 (light→max) still accumulate normally.
      const strainZones = [0, zones[1], zones[2], zones[3], zones[4]];
      const activeMinutes = strainZones.reduce((sum, z) => sum + z, 0);
      strain = gooseStrainV0({
        startTime,
        endTime,
        durationMinutes: Math.max(activeMinutes, 1e-6),
        restingHrBpm,
        averageHrBpm,
        maxHrBpm,
        hrZoneMinutes: strainZones,
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

  // HRV from optical RR. A recovery SCORE is only meaningful against a personal baseline — with
  // self-as-baseline the HRV/RHR components collapse to a neutral ~70, producing a misleading
  // "fine" score regardless of true fatigue. So we only emit a score once real baselines exist;
  // otherwise we report `calibrating` (HRV measured, baseline still building).
  const hrv = aggregateHrv(recoveryInputs.rrSamples, startTime, endTime, MIN_RR_FOR_RECOVERY);
  const rmssdMs = hrv?.output?.rmssdMs ?? null;
  const hasBaseline =
    recoveryInputs.hrvBaselineRmssdMs != null && recoveryInputs.restingHrBaselineBpm != null;

  let recovery: AlgorithmRunResult<RecoveryScoreOutput> | null = null;
  let recoveryStatus: DailyMetrics['recoveryStatus'] = 'unavailable';
  if (rmssdMs !== null && rmssdMs > 0 && restingHrBpm !== null) {
    if (hasBaseline) {
      recovery = gooseRecoveryV0({
        startTime,
        endTime,
        hrvRmssdMs: rmssdMs,
        hrvBaselineRmssdMs: recoveryInputs.hrvBaselineRmssdMs!,
        restingHrBpm,
        restingHrBaselineBpm: recoveryInputs.restingHrBaselineBpm!,
        respiratoryRateRpm: NEUTRAL_RESPIRATORY_RPM,
        respiratoryRateBaselineRpm: NEUTRAL_RESPIRATORY_RPM,
        skinTempDeltaC: 0,
        sleepScore0To100: sleep?.output?.score0To100 ?? NEUTRAL_SLEEP_SCORE,
        priorStrain0To21: recoveryInputs.priorStrain0To21 ?? 0,
        inputIds: ['pipeline.recovery', 'neutral:respiratory', 'neutral:skin_temp'],
      });
      recoveryStatus = recovery.output ? 'available' : 'calibrating';
    } else {
      recoveryStatus = 'calibrating';
    }
  }

  return {
    hrSampleCount: hrSamples.length,
    motionSampleCount: motionSamples.length,
    restingHrBpm,
    strain,
    energy,
    sleep,
    hrv,
    recovery,
    recoveryUnavailable: recovery?.output == null,
    recoveryStatus,
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
 * Median of prior days' values for a `daily_recovery_metrics` column (before `dateKey`), or null
 * if fewer than `minNights` prior nights exist — a recovery score needs a real personal baseline,
 * not a single night, to be meaningful.
 */
async function priorMedian(
  db: GooseDatabase,
  column: 'hrv_rmssd_ms' | 'resting_hr_bpm',
  dateKey: string,
  minNights: number,
): Promise<number | null> {
  const rows = await db.getAllAsync<{ value: number }>(
    `SELECT ${column} AS value FROM daily_recovery_metrics
      WHERE date_key < ? AND ${column} IS NOT NULL ORDER BY date_key`,
    [dateKey],
  );
  if (rows.length < minNights) return null;
  const values = rows.map((r) => r.value).sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

/** The most recent strain score from a prior day, for recovery's prior-strain component. */
async function priorStrainScore(db: GooseDatabase, dateKey: string): Promise<number | null> {
  const row = await db.getFirstAsync<{ value: number }>(
    `SELECT value FROM metric_values
      WHERE name = 'score0To21' AND run_id LIKE '%.strain' AND run_id < ?
      ORDER BY run_id DESC LIMIT 1`,
    [`${dateKey}.strain`],
  );
  return row?.value ?? null;
}

/**
 * Fetch a day's decoded frames, compute the derivable metrics, and persist them
 * (strain/sleep/hrv/recovery runs + daily recovery/activity rollup rows). Idempotent per date.
 */
export async function runDailyRollup(
  db: GooseDatabase,
  options: DailyRollupOptions,
): Promise<DailyMetrics> {
  // HR/motion/strain/sleep need everything EXCEPT the high-volume raw optical (k20). Excluding it
  // keeps this scan small (the common path, run on every recompute) instead of parsing every
  // 25 Hz optical frame. k20 is loaded separately, only when there's a sleep window to score.
  const rows = await decodedFramesForExtraction(db, options.startIso, options.endIso, {
    excludePacketK: [OPTICAL_PACKET_K],
  });
  const hrSamples = extractHeartRateSamples(rows);
  const motionSamples = extractMotionSamples(rows);
  // Recovery HRV comes from the SLEEP window (quiescent HR/motion), not noisy daytime activity.
  // Scope PPG RR to the detected sleep window; no sleep window ⇒ no recovery HRV (and no need to
  // touch the heavy optical frames at all). R17 (rare) is included in the main scan.
  const sleepWindow = detectSleepWindow(motionSamples, hrSamples);
  const rrSamples = [...extractRrIntervals(rows)];
  if (sleepWindow) {
    const opticalRows = await decodedFramesForExtraction(db, options.startIso, options.endIso, {
      includePacketK: [OPTICAL_PACKET_K],
    });
    rrSamples.push(
      ...extractPpgRrIntervals(opticalRows, { startMs: sleepWindow.startMs, endMs: sleepWindow.endMs }),
    );
  }

  const [hrvBaselineRmssdMs, restingHrBaselineBpm, priorStrain0To21] = await Promise.all([
    priorMedian(db, 'hrv_rmssd_ms', options.dateKey, MIN_BASELINE_NIGHTS),
    priorMedian(db, 'resting_hr_bpm', options.dateKey, MIN_BASELINE_NIGHTS),
    priorStrainScore(db, options.dateKey),
  ]);

  const metrics = computeDailyMetrics(hrSamples, motionSamples, options.startIso, options.endIso, options.profile, {
    rrSamples,
    hrvBaselineRmssdMs,
    restingHrBaselineBpm,
    priorStrain0To21,
  });

  const startMs = Date.parse(options.startIso);
  const endMs = Date.parse(options.endIso);

  if (metrics.strain) {
    await persistAlgorithmRun(db, `${options.dateKey}.strain`, metrics.strain);
  }
  if (metrics.sleep) {
    await persistAlgorithmRun(db, `${options.dateKey}.sleep`, metrics.sleep);
  }
  if (metrics.hrv?.output) {
    await persistAlgorithmRun(db, `${options.dateKey}.hrv`, metrics.hrv);
  }
  if (metrics.recovery?.output) {
    await persistAlgorithmRun(db, `${options.dateKey}.recovery`, metrics.recovery);
  } else {
    // No score this run (unavailable/calibrating) — clear any stale recovery run so the UI
    // doesn't keep showing an old, now-withheld value (cascades to its metric_values).
    await db.runAsync('DELETE FROM algorithm_runs WHERE run_id = ?', [`${options.dateKey}.recovery`]);
  }

  if (metrics.restingHrBpm !== null) {
    const hrvRmssdMs = metrics.hrv?.output?.rmssdMs ?? null;
    await db.runAsync(
      `INSERT OR REPLACE INTO daily_recovery_metrics
         (daily_metric_id, date_key, timezone, start_time_unix_ms, end_time_unix_ms,
          resting_hr_bpm, hrv_rmssd_ms, source_kind, confidence, provenance_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`rec-${options.dateKey}`, options.dateKey, options.timezone, startMs, endMs,
        metrics.restingHrBpm, hrvRmssdMs, 'device_sensor', 0.7,
        '{"pipeline":"daily-rollup","vitals":"respiratory_and_skin_temp_neutral"}'],
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
