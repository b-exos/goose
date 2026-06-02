/** Tests for the activity-session CRUD repository (sessions, metrics, intervals). */
import { createTestDatabase, type TestDatabase } from '../testing/sqlite';
import { migrate } from './db';
import {
  activitySessionsBetween,
  activitySessionsByType,
  deleteActivitySession,
  getActivitySession,
  insertActivityInterval,
  insertActivityMetric,
  insertActivitySession,
  listActivityIntervals,
  listActivityMetrics,
  updateActivitySession,
  type ActivitySessionInput,
} from './activity-repository';

const baseSession: ActivitySessionInput = {
  sessionId: 'act-1',
  source: 'goose',
  startTimeUnixMs: 1_000,
  endTimeUnixMs: 61_000,
  activityType: 'running',
  confidence: 0.9,
  detectionMethod: 'heuristic_hr_motion',
  syncStatus: 'candidate',
  provenanceJson: '{}',
};

describe('activity repository', () => {
  let db: TestDatabase;
  beforeEach(async () => {
    db = createTestDatabase();
    await migrate(db);
  });
  afterEach(() => db.close());

  it('inserts a session and derives duration', async () => {
    expect(await insertActivitySession(db, baseSession)).toBe(true);
    const row = await getActivitySession(db, 'act-1');
    expect(row?.activity_type).toBe('running');
    expect(row?.duration_ms).toBe(60_000);
  });

  it('treats re-insert of an identical session as a no-op', async () => {
    await insertActivitySession(db, baseSession);
    expect(await insertActivitySession(db, baseSession)).toBe(false);
  });

  it('rejects a session with an unknown activity type', async () => {
    await expect(
      insertActivitySession(db, { ...baseSession, activityType: 'teleporting' }),
    ).rejects.toThrow(/activity_type must be one of/);
  });

  it('updates and deletes sessions', async () => {
    await insertActivitySession(db, baseSession);
    expect(await updateActivitySession(db, { ...baseSession, confidence: 0.5 })).toBe(true);
    expect((await getActivitySession(db, 'act-1'))?.confidence).toBe(0.5);
    expect(await deleteActivitySession(db, 'act-1')).toBe(true);
    expect(await getActivitySession(db, 'act-1')).toBeNull();
  });

  it('queries sessions by window and type', async () => {
    await insertActivitySession(db, baseSession);
    await insertActivitySession(db, {
      ...baseSession,
      sessionId: 'act-2',
      activityType: 'cycling',
      startTimeUnixMs: 200_000,
      endTimeUnixMs: 260_000,
    });
    expect((await activitySessionsBetween(db, 0, 100_000)).map((r) => r.session_id)).toEqual(['act-1']);
    expect((await activitySessionsByType(db, 'cycling')).map((r) => r.session_id)).toEqual(['act-2']);
  });

  it('attaches metrics and intervals and rejects orphans', async () => {
    await insertActivitySession(db, baseSession);
    await insertActivityMetric(db, {
      metricId: 'm-1',
      activitySessionId: 'act-1',
      metricName: 'average_hr',
      value: 142,
      unit: 'bpm',
      startTimeUnixMs: 1_000,
      endTimeUnixMs: 61_000,
      provenanceJson: '{}',
    });
    await insertActivityInterval(db, {
      intervalId: 'i-1',
      activitySessionId: 'act-1',
      intervalType: 'lap',
      startTimeUnixMs: 1_000,
      endTimeUnixMs: 31_000,
      sequence: 0,
      provenanceJson: '{}',
    });

    expect(await listActivityMetrics(db, 'act-1')).toEqual([
      { metric_name: 'average_hr', value: 142, unit: 'bpm' },
    ]);
    expect(await listActivityIntervals(db, 'act-1')).toEqual([
      { interval_type: 'lap', sequence: 0, duration_ms: 30_000 },
    ]);

    await expect(
      insertActivityMetric(db, {
        metricId: 'm-x',
        activitySessionId: 'missing',
        metricName: 'x',
        value: 1,
        unit: 'bpm',
        startTimeUnixMs: 1,
        endTimeUnixMs: 2,
        provenanceJson: '{}',
      }),
    ).rejects.toThrow(/activity session missing not found/);
  });
});
