/**
 * Reads a day's computed metrics back out of the store for the UI.
 *
 * Pulls the strain/sleep/recovery scores from the persisted algorithm runs' `metric_values`
 * and the resting HR / HRV / energy from the daily rollup rows (written by `runDailyRollup`).
 * Recovery is available once RR intervals (optical R17) were decoded for the day.
 */
import type { GooseDatabase } from './db';

export interface DailyMetricsSummary {
  dateKey: string;
  sleepScore0To100: number | null;
  strainScore0To21: number | null;
  recoveryScore0To100: number | null;
  restingHrBpm: number | null;
  hrvRmssdMs: number | null;
  totalKcal: number | null;
  recoveryAvailable: boolean;
  /** `unavailable` (no HRV) · `calibrating` (HRV but no baseline) · `available` (real score). */
  recoveryStatus: 'unavailable' | 'calibrating' | 'available';
}

async function metricValue(db: GooseDatabase, runId: string, name: string): Promise<number | null> {
  const row = await db.getFirstAsync<{ value: number }>(
    'SELECT value FROM metric_values WHERE run_id = ? AND name = ?',
    [runId, name],
  );
  return row?.value ?? null;
}

/** Load the summary for a date (the ids `runDailyRollup` writes under). */
export async function loadDailyMetrics(db: GooseDatabase, dateKey: string): Promise<DailyMetricsSummary> {
  const [sleepScore, strainScore, recoveryScore, recovery, activity] = await Promise.all([
    metricValue(db, `${dateKey}.sleep`, 'score0To100'),
    metricValue(db, `${dateKey}.strain`, 'score0To21'),
    metricValue(db, `${dateKey}.recovery`, 'score0To100'),
    db.getFirstAsync<{ resting_hr_bpm: number | null; hrv_rmssd_ms: number | null }>(
      'SELECT resting_hr_bpm, hrv_rmssd_ms FROM daily_recovery_metrics WHERE daily_metric_id = ?',
      [`rec-${dateKey}`],
    ),
    db.getFirstAsync<{ total_kcal: number | null }>(
      'SELECT total_kcal FROM daily_activity_metrics WHERE daily_metric_id = ?',
      [`act-${dateKey}`],
    ),
  ]);

  const hrvRmssdMs = recovery?.hrv_rmssd_ms ?? null;
  const recoveryStatus: DailyMetricsSummary['recoveryStatus'] =
    recoveryScore !== null ? 'available' : hrvRmssdMs !== null ? 'calibrating' : 'unavailable';

  return {
    dateKey,
    sleepScore0To100: sleepScore,
    strainScore0To21: strainScore,
    recoveryScore0To100: recoveryScore,
    restingHrBpm: recovery?.resting_hr_bpm ?? null,
    hrvRmssdMs,
    totalKcal: activity?.total_kcal ?? null,
    recoveryAvailable: recoveryScore !== null,
    recoveryStatus,
  };
}
