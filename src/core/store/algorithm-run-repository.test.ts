/**
 * Verifies that real algorithm results persist into algorithm_runs / metric_values /
 * metric_components and read back with the same values the golden tests pin.
 */
import { gooseHrvV0 } from '../metrics/hrv';
import { gooseStrainV0 } from '../metrics/strain';
import { createTestDatabase, type TestDatabase } from '../testing/sqlite';
import { migrate } from './db';
import {
  metricComponentsForRun,
  metricValuesForRun,
  persistAlgorithmRun,
} from './algorithm-run-repository';

describe('persistAlgorithmRun', () => {
  let db: TestDatabase;
  beforeEach(async () => {
    db = createTestDatabase();
    await migrate(db);
  });
  afterEach(() => db.close());

  it('persists an HRV run with metric values and components', async () => {
    const result = gooseHrvV0({
      startTime: '2026-05-27T00:00:00Z',
      endTime: '2026-05-27T00:01:00Z',
      rrIntervalsMs: [800, 810, 790, 800],
      inputIds: ['t'],
    });
    await persistAlgorithmRun(db, 'run-hrv', result);

    const values = await metricValuesForRun(db, 'run-hrv');
    const rmssd = values.find((v) => v.name === 'rmssdMs');
    expect(rmssd?.value).toBeCloseTo(14.142135623730951, 9);
    expect(values.every((v) => v.metric_family === 'hrv')).toBe(true);

    const components = await metricComponentsForRun(db, 'run-hrv');
    expect(components.map((c) => c.component_name)).toEqual(['mean_nn', 'rmssd', 'sdnn', 'pnn50']);
    expect(components.find((c) => c.component_name === 'rmssd')?.value).toBeCloseTo(14.142135623730951, 9);
  });

  it('persists a strain run with weighted component contributions', async () => {
    const result = gooseStrainV0({
      startTime: '2026-05-28T12:00:00Z',
      endTime: '2026-05-28T13:00:00Z',
      durationMinutes: 60,
      restingHrBpm: 60,
      averageHrBpm: 120,
      maxHrBpm: 180,
      hrZoneMinutes: [10, 20, 30, 0, 0],
      inputIds: ['t'],
    });
    await persistAlgorithmRun(db, 'run-strain', result);

    const components = await metricComponentsForRun(db, 'run-strain');
    expect(components).toHaveLength(2);
    const zone = components.find((c) => c.component_name === 'zone_load');
    expect(zone?.value).toBeCloseTo(140, 9);
    expect(JSON.parse(zone!.contribution_json).contribution).toBeCloseTo(4.9, 9);

    const values = await metricValuesForRun(db, 'run-strain');
    expect(values.find((v) => v.name === 'score0To21')?.value).toBeCloseTo(8.05, 9);
  });

  it('is idempotent on repeated persistence of the same run id', async () => {
    const result = gooseHrvV0({
      startTime: 'a',
      endTime: 'b',
      rrIntervalsMs: [800, 810, 790, 800],
      inputIds: [],
    });
    await persistAlgorithmRun(db, 'dup', result);
    await persistAlgorithmRun(db, 'dup', result);
    const components = await metricComponentsForRun(db, 'dup');
    expect(components).toHaveLength(4);
  });
});
