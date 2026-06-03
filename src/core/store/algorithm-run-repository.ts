/**
 * Persistence for algorithm runs and their derived metric rows.
 *
 * Ported from `upsert_algorithm_definition` / `insert_algorithm_run` /
 * `insert_metric_rows_for_algorithm_run` in `docs/rust-reference/src/store.rs`.
 *
 * Note: the engine is now pure-TS, so `output_json` is stored with the TS (camelCase)
 * field names — the local DB is read back only by this app. The metric *values* are what
 * the golden tests pin; here we verify they round-trip into `metric_values`/`metric_components`.
 */
import type { AlgorithmRunResult } from '../types';
import type { GooseDatabase } from './db';

/** Minimal definition needed to satisfy the algorithm_runs foreign key. */
export interface AlgorithmDefinitionInput {
  algorithmId: string;
  version: string;
  metricFamily: string;
  displayName?: string;
  inputSchema?: string;
  outputSchema?: string;
  paramsJson?: string;
}

/** A component row to persist (covers plain MetricComponent and weighted ScoreComponent). */
interface PersistableComponent {
  name: string;
  value: number;
  unit: string;
  score0To100?: number;
  weight?: number;
  contribution?: number;
}

/** Upsert an algorithm definition (mirrors the Rust ON CONFLICT upsert). */
export async function upsertAlgorithmDefinition(
  db: GooseDatabase,
  def: AlgorithmDefinitionInput,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO algorithm_definitions
       (algorithm_id, version, metric_family, display_name, input_schema, output_schema, params_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(algorithm_id, version) DO UPDATE SET
       metric_family = excluded.metric_family,
       display_name = excluded.display_name,
       input_schema = excluded.input_schema,
       output_schema = excluded.output_schema,
       params_json = excluded.params_json`,
    [
      def.algorithmId,
      def.version,
      def.metricFamily,
      def.displayName ?? def.algorithmId,
      def.inputSchema ?? `goose.${def.metricFamily}-input.v1`,
      def.outputSchema ?? `goose.${def.metricFamily}-output.v1`,
      def.paramsJson ?? '{}',
    ],
  );
}

/** Pull persistable components out of an algorithm result's output, if any. */
function componentsOf(output: Record<string, unknown> | null): PersistableComponent[] {
  const raw = output?.components;
  if (!Array.isArray(raw)) return [];
  return raw as PersistableComponent[];
}

/** Top-level numeric output fields, excluding ids and the components array. */
function numericFieldsOf(output: Record<string, unknown> | null): [string, number][] {
  if (!output) return [];
  const skip = new Set(['algorithmId', 'algorithmVersion', 'components']);
  const out: [string, number][] = [];
  for (const [name, value] of Object.entries(output)) {
    if (skip.has(name)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) out.push([name, value]);
  }
  return out;
}

/**
 * Persist an algorithm run plus its metric_values and metric_components.
 * Auto-upserts a minimal definition (FK target) from the result's family.
 * Returns the `runId`. Uses INSERT OR REPLACE so re-persisting a run (a recompute over more
 * data) refreshes the stored run + its metric rows.
 */
export async function persistAlgorithmRun<T>(
  db: GooseDatabase,
  runId: string,
  result: AlgorithmRunResult<T>,
): Promise<string> {
  await upsertAlgorithmDefinition(db, {
    algorithmId: result.algorithmId,
    version: result.algorithmVersion,
    metricFamily: result.family,
  });

  // OR REPLACE so a recompute (e.g. live monitor accumulating more data) refreshes the run.
  // Replacing the run cascades to its metric_values/components, which we re-insert below.
  await db.runAsync(
    `INSERT OR REPLACE INTO algorithm_runs
       (run_id, algorithm_id, version, start_time, end_time, output_json, quality_flags_json, provenance_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      runId,
      result.algorithmId,
      result.algorithmVersion,
      result.startTime,
      result.endTime,
      JSON.stringify(result.output),
      JSON.stringify(result.qualityFlags),
      JSON.stringify(result.provenance),
    ],
  );

  const output = (result.output ?? null) as Record<string, unknown> | null;

  for (const [name, value] of numericFieldsOf(output)) {
    await db.runAsync(
      `INSERT OR REPLACE INTO metric_values
         (metric_value_id, run_id, metric_family, name, value, unit, start_time, end_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [`${runId}.${name}`, runId, result.family, name, value, 'raw', result.startTime, result.endTime],
    );
  }

  const components = componentsOf(output);
  for (let index = 0; index < components.length; index++) {
    const c = components[index];
    const contributionJson = JSON.stringify({
      score0To100: c.score0To100 ?? null,
      weight: c.weight ?? null,
      contribution: c.contribution ?? null,
    });
    await db.runAsync(
      `INSERT OR REPLACE INTO metric_components
         (metric_component_id, run_id, component_name, value, unit, contribution_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [`${runId}.component.${index}.${c.name}`, runId, c.name, c.value, c.unit, contributionJson],
    );
  }

  return runId;
}

export interface MetricValueRow {
  name: string;
  value: number;
  unit: string;
  metric_family: string;
}

export interface MetricComponentRow {
  component_name: string;
  value: number;
  unit: string;
  contribution_json: string;
}

/** Read metric_values for a run, ordered by name. */
export function metricValuesForRun(db: GooseDatabase, runId: string): Promise<MetricValueRow[]> {
  return db.getAllAsync<MetricValueRow>(
    'SELECT name, value, unit, metric_family FROM metric_values WHERE run_id = ? ORDER BY name',
    [runId],
  );
}

/** Read metric_components for a run, in insertion order. */
export function metricComponentsForRun(
  db: GooseDatabase,
  runId: string,
): Promise<MetricComponentRow[]> {
  return db.getAllAsync<MetricComponentRow>(
    'SELECT component_name, value, unit, contribution_json FROM metric_components WHERE run_id = ? ORDER BY rowid ASC',
    [runId],
  );
}
