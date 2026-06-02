/** Tests for the external-sleep repository (imported sessions + stages). */
import { createTestDatabase, type TestDatabase } from '../testing/sqlite';
import { migrate } from './db';
import {
  externalSleepSessionsBetween,
  externalSleepStagesForSession,
  getExternalSleepSession,
  insertExternalSleepSession,
  insertExternalSleepStage,
  type ExternalSleepSessionInput,
} from './sleep-repository';

const night: ExternalSleepSessionInput = {
  sleepId: 'sleep-1',
  source: 'healthkit-import',
  platform: 'healthkit',
  platformRecordId: 'hk-abc',
  startTimeUnixMs: 1_000_000,
  endTimeUnixMs: 1_000_000 + 8 * 3_600_000, // 8h
  timezone: 'America/Phoenix',
  confidence: 0.95,
  provenanceJson: '{}',
};

describe('external-sleep repository', () => {
  let db: TestDatabase;
  beforeEach(async () => {
    db = createTestDatabase();
    await migrate(db);
  });
  afterEach(() => db.close());

  it('inserts a session and derives duration', async () => {
    expect(await insertExternalSleepSession(db, night)).toBe(true);
    const row = await getExternalSleepSession(db, 'sleep-1');
    expect(row?.platform).toBe('healthkit');
    expect(row?.duration_ms).toBe(8 * 3_600_000);
  });

  it('rejects an unknown platform', async () => {
    await expect(
      insertExternalSleepSession(db, { ...night, platform: 'fitbit' }),
    ).rejects.toThrow(/platform must be one of/);
  });

  it('inserts stages within the session and rejects out-of-window stages', async () => {
    await insertExternalSleepSession(db, night);
    await insertExternalSleepStage(db, {
      stageId: 'stg-1',
      sleepId: 'sleep-1',
      stageKind: 'deep',
      startTimeUnixMs: night.startTimeUnixMs,
      endTimeUnixMs: night.startTimeUnixMs + 3_600_000,
      confidence: 0.9,
      provenanceJson: '{}',
    });

    const stages = await externalSleepStagesForSession(db, 'sleep-1');
    expect(stages).toEqual([
      { stage_kind: 'deep', duration_ms: 3_600_000, start_time_unix_ms: night.startTimeUnixMs },
    ]);

    await expect(
      insertExternalSleepStage(db, {
        stageId: 'stg-bad',
        sleepId: 'sleep-1',
        stageKind: 'rem',
        startTimeUnixMs: night.startTimeUnixMs - 1,
        endTimeUnixMs: night.startTimeUnixMs + 1000,
        confidence: 0.9,
        provenanceJson: '{}',
      }),
    ).rejects.toThrow(/must be within parent sleep session/);
  });

  it('rejects stages for a missing session', async () => {
    await expect(
      insertExternalSleepStage(db, {
        stageId: 'x',
        sleepId: 'nope',
        stageKind: 'deep',
        startTimeUnixMs: 1,
        endTimeUnixMs: 2,
        confidence: 0.5,
        provenanceJson: '{}',
      }),
    ).rejects.toThrow(/external sleep session nope not found/);
  });

  it('queries sessions by window', async () => {
    await insertExternalSleepSession(db, night);
    const overlap = await externalSleepSessionsBetween(db, night.startTimeUnixMs + 1000, night.endTimeUnixMs);
    expect(overlap.map((r) => r.sleep_id)).toEqual(['sleep-1']);
    const before = await externalSleepSessionsBetween(db, 1, 1000);
    expect(before).toEqual([]);
  });
});
