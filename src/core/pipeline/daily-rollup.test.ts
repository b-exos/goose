/** Tests the pure daily-metrics computation + the persistence orchestrator. */
import { importCapturedFrameBatch } from '../capture/import';
import type { HeartRateSample } from '../features/resting-hr';
import { migrate } from '../store/db';
import { loadHex } from '../testing/fixtures';
import { createTestDatabase, type TestDatabase } from '../testing/sqlite';
import { computeDailyMetrics, hrZoneMinutes, runDailyRollup } from './daily-rollup';

const hr = (minute: number, bpm: number): HeartRateSample => ({
  id: `${minute}`,
  timeUnixMs: minute * 60_000,
  heartRateBpm: bpm,
});

describe('daily rollup compute', () => {
  it('buckets HR-zone minutes by %reserve using inter-sample gaps', () => {
    // resting 60, max 160 -> reserve 100. fracs: 60→0(z0), 110→0.5(z2), 140→0.8(z4)
    const zones = hrZoneMinutes([hr(0, 60), hr(1, 110), hr(2, 140)], 60, 160);
    expect(zones[0]).toBeCloseTo(1, 9); // 60bpm gap -> zone 0
    expect(zones[2]).toBeCloseTo(1, 9); // 110bpm gap -> zone 2
    expect(zones[4]).toBe(0); // last sample has no following gap
  });

  it('computes resting HR, strain, and energy from a day of HR samples', () => {
    const samples = [hr(0, 60), hr(1, 62), hr(2, 140), hr(3, 150), hr(4, 100), hr(5, 64)];
    const metrics = computeDailyMetrics(samples, [], '2026-05-28T00:00:00Z', '2026-05-29T00:00:00Z', {
      weightKg: 75,
    });

    expect(metrics.hrSampleCount).toBe(6);
    expect(metrics.restingHrBpm).toBeCloseTo(61, 6); // low-quartile mean of [60,62]
    expect(metrics.strain?.output?.score0To21).toBeGreaterThan(0);
    expect(metrics.energy?.totalKcal).toBeGreaterThan(0);
    expect(metrics.recoveryUnavailable).toBe(true);
  });

  it('produces no strain when there are too few samples', () => {
    const metrics = computeDailyMetrics([hr(0, 60)], [], 'a', 'b');
    expect(metrics.strain).toBeNull();
    expect(metrics.energy).toBeNull();
  });
});

describe('runDailyRollup (persistence)', () => {
  let db: TestDatabase;
  beforeEach(async () => {
    db = createTestDatabase();
    await migrate(db);
  });
  afterEach(() => db.close());

  it('imports frames, computes, and persists daily rows + strain run', async () => {
    await importCapturedFrameBatch(db, [
      { evidenceId: 'ev-k10', source: 'ble', capturedAt: '2026-05-28T08:00:00.000Z', deviceModel: 'WHOOP', frameHex: loadHex('synthetic/goose_v5_k10_motion_summary_short.hex'), sensitivity: 's' },
      { evidenceId: 'ev-k18', source: 'ble', capturedAt: '2026-05-28T08:05:00.000Z', deviceModel: 'WHOOP', frameHex: loadHex('synthetic/goose_v5_historical_k18_packet.hex'), sensitivity: 's' },
    ]);
    // Spread decoded_frames.created_at so there's a 5-min gap (drives HR-zone minutes).
    await db.runAsync("UPDATE decoded_frames SET created_at = '2026-05-28T08:00:00.000Z' WHERE frame_id = 'ev-k10.frame.0'");
    await db.runAsync("UPDATE decoded_frames SET created_at = '2026-05-28T08:05:00.000Z' WHERE frame_id = 'ev-k18.frame.0'");

    const metrics = await runDailyRollup(db, {
      dateKey: '2026-05-28',
      startIso: '2026-05-28T00:00:00.000Z',
      endIso: '2026-05-29T00:00:00.000Z',
      timezone: 'UTC',
      profile: { weightKg: 75 },
    });

    expect(metrics.restingHrBpm).toBeGreaterThan(0);
    expect(metrics.strain?.output?.score0To21).toBeGreaterThanOrEqual(0);

    const rec = await db.getFirstAsync<{ resting_hr_bpm: number }>(
      'SELECT resting_hr_bpm FROM daily_recovery_metrics WHERE daily_metric_id = ?',
      ['rec-2026-05-28'],
    );
    expect(rec?.resting_hr_bpm).toBeGreaterThan(0);

    const act = await db.getFirstAsync<{ total_kcal: number }>(
      'SELECT total_kcal FROM daily_activity_metrics WHERE daily_metric_id = ?',
      ['act-2026-05-28'],
    );
    expect(act?.total_kcal).toBeGreaterThan(0);

    const run = await db.getFirstAsync<{ run_id: string }>(
      'SELECT run_id FROM algorithm_runs WHERE run_id = ?',
      ['2026-05-28.strain'],
    );
    expect(run?.run_id).toBe('2026-05-28.strain');
  });
});
