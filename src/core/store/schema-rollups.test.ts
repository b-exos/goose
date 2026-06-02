/** Confirms the deferred rollup/poll tables are created by migrate(). */
import { createTestDatabase, type TestDatabase } from '../testing/sqlite';
import { migrate } from './db';

const EXPECTED_TABLES = [
  'daily_activity_metrics',
  'hourly_activity_metrics',
  'daily_recovery_metrics',
  'metric_provenance',
  'step_counter_samples',
  'historical_range_polls',
];

describe('rollup schema', () => {
  let db: TestDatabase;
  beforeEach(async () => {
    db = createTestDatabase();
    await migrate(db);
  });
  afterEach(() => db.close());

  it('creates all deferred rollup/poll tables', async () => {
    for (const table of EXPECTED_TABLES) {
      const row = await db.getFirstAsync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        [table],
      );
      expect(row?.name).toBe(table);
    }
  });

  it('round-trips a daily recovery rollup row', async () => {
    await db.runAsync(
      `INSERT INTO daily_recovery_metrics
         (daily_metric_id, date_key, timezone, start_time_unix_ms, end_time_unix_ms,
          resting_hr_bpm, hrv_rmssd_ms, source_kind, confidence, provenance_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['rec-1', '2026-05-28', 'America/Phoenix', 1000, 2000, 58, 64.2, 'device_sensor', 0.8, '{}'],
    );
    const row = await db.getFirstAsync<{ resting_hr_bpm: number; hrv_rmssd_ms: number }>(
      'SELECT resting_hr_bpm, hrv_rmssd_ms FROM daily_recovery_metrics WHERE daily_metric_id = ?',
      ['rec-1'],
    );
    expect(row?.resting_hr_bpm).toBe(58);
    expect(row?.hrv_rmssd_ms).toBeCloseTo(64.2, 9);
  });
});
