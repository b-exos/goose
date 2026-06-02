/** Verifies daily metrics are read back after a rollup runs. */
import { importCapturedFrameBatch } from '../capture/import';
import { runDailyRollup } from '../pipeline/daily-rollup';
import { loadHex } from '../testing/fixtures';
import { createTestDatabase, type TestDatabase } from '../testing/sqlite';
import { migrate } from './db';
import { loadDailyMetrics } from './daily-metrics-repository';

describe('loadDailyMetrics', () => {
  let db: TestDatabase;
  beforeEach(async () => {
    db = createTestDatabase();
    await migrate(db);
  });
  afterEach(() => db.close());

  it('reads strain, resting HR, and energy back after a rollup', async () => {
    await importCapturedFrameBatch(db, [
      { evidenceId: 'a', source: 'ble', capturedAt: '2026-05-28T08:00:00.000Z', deviceModel: 'W', frameHex: loadHex('synthetic/goose_v5_k10_motion_summary_short.hex'), sensitivity: 's' },
      { evidenceId: 'b', source: 'ble', capturedAt: '2026-05-28T08:05:00.000Z', deviceModel: 'W', frameHex: loadHex('synthetic/goose_v5_historical_k18_packet.hex'), sensitivity: 's' },
    ]);
    await db.runAsync("UPDATE decoded_frames SET created_at = '2026-05-28T08:00:00.000Z' WHERE frame_id = 'a.frame.0'");
    await db.runAsync("UPDATE decoded_frames SET created_at = '2026-05-28T08:05:00.000Z' WHERE frame_id = 'b.frame.0'");
    await runDailyRollup(db, {
      dateKey: '2026-05-28',
      startIso: '2026-05-28T00:00:00.000Z',
      endIso: '2026-05-29T00:00:00.000Z',
      timezone: 'UTC',
      profile: { weightKg: 75 },
    });

    const summary = await loadDailyMetrics(db, '2026-05-28');
    expect(summary.restingHrBpm).toBeGreaterThan(0);
    expect(summary.strainScore0To21).toBeGreaterThanOrEqual(0);
    expect(summary.totalKcal).toBeGreaterThan(0);
    expect(summary.recoveryAvailable).toBe(false);
  });

  it('returns nulls for a day with no data', async () => {
    const summary = await loadDailyMetrics(db, '2099-01-01');
    expect(summary.sleepScore0To100).toBeNull();
    expect(summary.strainScore0To21).toBeNull();
    expect(summary.restingHrBpm).toBeNull();
  });
});
