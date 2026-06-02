/**
 * Algorithm-definition seeding and per-family preference selection.
 *
 * Ported from `set_algorithm_preference` / `algorithm_preference(s)` and the built-in
 * seeding in `docs/rust-reference/src/store.rs` + `metrics.rs`. A preference may only
 * point at a definition that exists and whose metric family matches.
 */
import {
  BUILT_IN_ALGORITHMS,
  DEFAULT_SCOPE,
  defaultPreferencesForScope,
  type AlgorithmPreference,
} from '../metrics/registry';
import { upsertAlgorithmDefinition } from './algorithm-run-repository';
import type { GooseDatabase } from './db';
import { StoreValidationError, validateRequired } from './validation';

/** Seed all built-in algorithm definitions (idempotent upsert). */
export async function seedBuiltInDefinitions(db: GooseDatabase): Promise<void> {
  for (const algorithm of BUILT_IN_ALGORITHMS) {
    await upsertAlgorithmDefinition(db, algorithm.definition);
  }
}

/** Seed the default per-family preferences for a scope (definitions must be seeded first). */
export async function seedDefaultPreferences(
  db: GooseDatabase,
  scope: string = DEFAULT_SCOPE,
): Promise<void> {
  for (const preference of defaultPreferencesForScope(scope)) {
    await setAlgorithmPreference(db, preference);
  }
}

/**
 * Select an algorithm for a metric family. The referenced definition must already exist
 * and its family must match (mirrors the Rust guard). Upserts on (scope, metric_family).
 */
export async function setAlgorithmPreference(
  db: GooseDatabase,
  preference: AlgorithmPreference,
): Promise<void> {
  validateRequired('scope', preference.scope);
  validateRequired('metric_family', preference.metricFamily);
  validateRequired('algorithm_id', preference.algorithmId);
  validateRequired('version', preference.version);

  const definition = await db.getFirstAsync<{ metric_family: string }>(
    'SELECT metric_family FROM algorithm_definitions WHERE algorithm_id = ? AND version = ?',
    [preference.algorithmId, preference.version],
  );
  if (!definition) {
    throw new StoreValidationError(
      `algorithm definition ${preference.algorithmId}@${preference.version} must exist before it can be selected`,
    );
  }
  if (definition.metric_family !== preference.metricFamily) {
    throw new StoreValidationError(
      `algorithm ${preference.algorithmId}@${preference.version} belongs to metric family ${definition.metric_family}, not ${preference.metricFamily}`,
    );
  }

  await db.runAsync(
    `INSERT INTO algorithm_preferences (scope, metric_family, algorithm_id, version)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(scope, metric_family) DO UPDATE SET
       algorithm_id = excluded.algorithm_id,
       version = excluded.version,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    [preference.scope, preference.metricFamily, preference.algorithmId, preference.version],
  );
}

/** Get the selected algorithm for a (scope, family), or null. */
export function getAlgorithmPreference(
  db: GooseDatabase,
  scope: string,
  metricFamily: string,
): Promise<AlgorithmPreferenceRow | null> {
  validateRequired('scope', scope);
  validateRequired('metric_family', metricFamily);
  return db.getFirstAsync<AlgorithmPreferenceRow>(
    `SELECT scope, metric_family, algorithm_id, version
       FROM algorithm_preferences WHERE scope = ? AND metric_family = ?`,
    [scope, metricFamily],
  );
}

/** List preferences, optionally scoped, ordered for stable display. */
export function listAlgorithmPreferences(
  db: GooseDatabase,
  scope?: string,
): Promise<AlgorithmPreferenceRow[]> {
  if (scope !== undefined) {
    validateRequired('scope', scope);
    return db.getAllAsync<AlgorithmPreferenceRow>(
      `SELECT scope, metric_family, algorithm_id, version FROM algorithm_preferences
        WHERE scope = ? ORDER BY metric_family`,
      [scope],
    );
  }
  return db.getAllAsync<AlgorithmPreferenceRow>(
    `SELECT scope, metric_family, algorithm_id, version FROM algorithm_preferences
      ORDER BY scope, metric_family`,
  );
}

export interface AlgorithmPreferenceRow {
  scope: string;
  metric_family: string;
  algorithm_id: string;
  version: string;
}
