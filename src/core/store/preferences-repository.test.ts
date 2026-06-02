/** Tests for algorithm-definition seeding and per-family preference selection. */
import { GOOSE_HRV_V0_ID, GOOSE_HRV_V0_VERSION } from '../metrics/hrv';
import { GOOSE_STRESS_V0_ID, GOOSE_STRESS_V0_VERSION } from '../metrics/stress';
import { DEFAULT_SCOPE } from '../metrics/registry';
import { createTestDatabase, type TestDatabase } from '../testing/sqlite';
import { migrate } from './db';
import {
  getAlgorithmPreference,
  listAlgorithmPreferences,
  seedBuiltInDefinitions,
  seedDefaultPreferences,
  setAlgorithmPreference,
} from './preferences-repository';

describe('algorithm preferences', () => {
  let db: TestDatabase;
  beforeEach(async () => {
    db = createTestDatabase();
    await migrate(db);
    await seedBuiltInDefinitions(db);
  });
  afterEach(() => db.close());

  it('seeds one default preference per metric family', async () => {
    await seedDefaultPreferences(db);
    const prefs = await listAlgorithmPreferences(db, DEFAULT_SCOPE);
    expect(prefs.map((p) => p.metric_family)).toEqual(['hrv', 'recovery', 'sleep', 'strain', 'stress']);
    const hrv = await getAlgorithmPreference(db, DEFAULT_SCOPE, 'hrv');
    expect(hrv?.algorithm_id).toBe(GOOSE_HRV_V0_ID);
    expect(hrv?.version).toBe(GOOSE_HRV_V0_VERSION);
  });

  it('upserts a preference for a scope', async () => {
    await setAlgorithmPreference(db, {
      scope: 'user',
      metricFamily: 'stress',
      algorithmId: GOOSE_STRESS_V0_ID,
      version: GOOSE_STRESS_V0_VERSION,
    });
    expect((await getAlgorithmPreference(db, 'user', 'stress'))?.algorithm_id).toBe(GOOSE_STRESS_V0_ID);
  });

  it('rejects a preference for a definition that does not exist', async () => {
    await expect(
      setAlgorithmPreference(db, {
        scope: DEFAULT_SCOPE,
        metricFamily: 'hrv',
        algorithmId: 'goose.hrv.v99',
        version: '9.9.9',
      }),
    ).rejects.toThrow(/must exist before it can be selected/);
  });

  it('rejects a preference whose family does not match the definition', async () => {
    await expect(
      setAlgorithmPreference(db, {
        scope: DEFAULT_SCOPE,
        metricFamily: 'sleep', // hrv algorithm declared under sleep family
        algorithmId: GOOSE_HRV_V0_ID,
        version: GOOSE_HRV_V0_VERSION,
      }),
    ).rejects.toThrow(/belongs to metric family hrv, not sleep/);
  });
});
