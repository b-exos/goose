/**
 * Activity-session persistence: sessions, metrics, and intervals.
 *
 * Ported from the activity methods in `docs/rust-reference/src/store.rs`
 * (`insert/update/delete/activity_session`, `activity_sessions_*`, `insert_activity_metric`,
 * `insert_activity_interval`). `duration_ms` is derived; inserts validate inputs and
 * existence the same way the Rust store did.
 */
import type { GooseDatabase } from './db';
import {
  ALLOWED_ACTIVITY_DETECTION_METHODS,
  ALLOWED_ACTIVITY_INTERVAL_TYPES,
  ALLOWED_ACTIVITY_METRIC_UNITS,
  ALLOWED_ACTIVITY_SYNC_STATUSES,
  ALLOWED_ACTIVITY_TYPES,
  StoreValidationError,
  validateAllowed,
  validateConfidence,
  validateJson,
  validateJsonObject,
  validateNonNegative,
  validateOptionalRequired,
  validateRequired,
  validateWindowOrder,
} from './validation';

export interface ActivitySessionInput {
  sessionId: string;
  source: string;
  startTimeUnixMs: number;
  endTimeUnixMs: number;
  activityType: string;
  externalActivityTypeCode?: string | null;
  externalActivityTypeName?: string | null;
  customLabel?: string | null;
  confidence: number;
  detectionMethod: string;
  syncStatus: string;
  provenanceJson: string;
}

export interface ActivitySessionRow {
  session_id: string;
  source: string;
  start_time_unix_ms: number;
  end_time_unix_ms: number;
  duration_ms: number;
  activity_type: string;
  external_activity_type_code: string | null;
  external_activity_type_name: string | null;
  custom_label: string | null;
  confidence: number;
  detection_method: string;
  sync_status: string;
  provenance_json: string;
}

export interface ActivityMetricInput {
  metricId: string;
  activitySessionId: string;
  metricName: string;
  value: number;
  unit: string;
  startTimeUnixMs: number;
  endTimeUnixMs: number;
  qualityFlagsJson?: string;
  provenanceJson: string;
}

export interface ActivityIntervalInput {
  intervalId: string;
  activitySessionId: string;
  intervalType: string;
  startTimeUnixMs: number;
  endTimeUnixMs: number;
  sequence: number;
  metadataJson?: string;
  provenanceJson: string;
}

const SESSION_COLUMNS = `
  session_id, source, start_time_unix_ms, end_time_unix_ms, duration_ms, activity_type,
  external_activity_type_code, external_activity_type_name, custom_label, confidence,
  detection_method, sync_status, provenance_json`;

function validateSession(input: ActivitySessionInput): void {
  validateRequired('session_id', input.sessionId);
  validateRequired('source', input.source);
  validateNonNegative('start_time_unix_ms', input.startTimeUnixMs);
  validateNonNegative('end_time_unix_ms', input.endTimeUnixMs);
  validateWindowOrder(input.startTimeUnixMs, input.endTimeUnixMs);
  validateRequired('activity_type', input.activityType);
  validateAllowed('activity_type', input.activityType, ALLOWED_ACTIVITY_TYPES);
  validateOptionalRequired('external_activity_type_code', input.externalActivityTypeCode);
  validateOptionalRequired('external_activity_type_name', input.externalActivityTypeName);
  validateOptionalRequired('custom_label', input.customLabel);
  validateConfidence('confidence', input.confidence);
  validateRequired('detection_method', input.detectionMethod);
  validateAllowed('detection_method', input.detectionMethod, ALLOWED_ACTIVITY_DETECTION_METHODS);
  validateRequired('sync_status', input.syncStatus);
  validateAllowed('sync_status', input.syncStatus, ALLOWED_ACTIVITY_SYNC_STATUSES);
  validateJsonObject('provenance_json', input.provenanceJson);
}

/** Insert an activity session. Returns false if an identical row already exists. */
export async function insertActivitySession(
  db: GooseDatabase,
  input: ActivitySessionInput,
): Promise<boolean> {
  validateSession(input);
  const existing = await getActivitySession(db, input.sessionId);
  if (existing) {
    if (sessionMatches(existing, input)) return false;
    throw new StoreValidationError(
      `activity session ${input.sessionId} already exists with different metadata`,
    );
  }
  await db.runAsync(
    `INSERT INTO activity_sessions (${SESSION_COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sessionParams(input),
  );
  return true;
}

/** Update an existing activity session. Returns false if unchanged; throws if missing. */
export async function updateActivitySession(
  db: GooseDatabase,
  input: ActivitySessionInput,
): Promise<boolean> {
  validateSession(input);
  const existing = await getActivitySession(db, input.sessionId);
  if (!existing) {
    throw new StoreValidationError(`activity session ${input.sessionId} not found`);
  }
  if (sessionMatches(existing, input)) return false;
  const result = await db.runAsync(
    `UPDATE activity_sessions SET
       source = ?, start_time_unix_ms = ?, end_time_unix_ms = ?, duration_ms = ?,
       activity_type = ?, external_activity_type_code = ?, external_activity_type_name = ?,
       custom_label = ?, confidence = ?, detection_method = ?, sync_status = ?,
       provenance_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE session_id = ?`,
    [...sessionParams(input).slice(1), input.sessionId],
  );
  return result.changes > 0;
}

/** Delete a session (and cascade its metrics/intervals). Returns true if a row was removed. */
export async function deleteActivitySession(db: GooseDatabase, sessionId: string): Promise<boolean> {
  validateRequired('session_id', sessionId);
  const result = await db.runAsync('DELETE FROM activity_sessions WHERE session_id = ?', [sessionId]);
  return result.changes > 0;
}

/** Fetch a session by id, or null. */
export function getActivitySession(
  db: GooseDatabase,
  sessionId: string,
): Promise<ActivitySessionRow | null> {
  validateRequired('session_id', sessionId);
  return db.getFirstAsync<ActivitySessionRow>(
    'SELECT * FROM activity_sessions WHERE session_id = ?',
    [sessionId],
  );
}

/** Sessions overlapping the [start, end) window, ordered by start then id. */
export function activitySessionsBetween(
  db: GooseDatabase,
  startMs: number,
  endMs: number,
): Promise<ActivitySessionRow[]> {
  validateNonNegative('start_time_unix_ms', startMs);
  validateNonNegative('end_time_unix_ms', endMs);
  validateWindowOrder(startMs, endMs);
  return db.getAllAsync<ActivitySessionRow>(
    `SELECT * FROM activity_sessions
      WHERE start_time_unix_ms < ? AND end_time_unix_ms > ?
      ORDER BY start_time_unix_ms, session_id`,
    [endMs, startMs],
  );
}

/** Sessions of a given (validated) activity type. */
export function activitySessionsByType(
  db: GooseDatabase,
  activityType: string,
): Promise<ActivitySessionRow[]> {
  validateRequired('activity_type', activityType);
  validateAllowed('activity_type', activityType, ALLOWED_ACTIVITY_TYPES);
  return db.getAllAsync<ActivitySessionRow>(
    'SELECT * FROM activity_sessions WHERE activity_type = ? ORDER BY start_time_unix_ms, session_id',
    [activityType],
  );
}

/** Insert a metric attached to an existing session. Returns false if it already exists. */
export async function insertActivityMetric(
  db: GooseDatabase,
  input: ActivityMetricInput,
): Promise<boolean> {
  validateRequired('metric_id', input.metricId);
  validateRequired('activity_session_id', input.activitySessionId);
  validateRequired('metric_name', input.metricName);
  if (!Number.isFinite(input.value)) throw new StoreValidationError('value must be finite');
  validateRequired('unit', input.unit);
  validateAllowed('unit', input.unit, ALLOWED_ACTIVITY_METRIC_UNITS);
  validateNonNegative('start_time_unix_ms', input.startTimeUnixMs);
  validateNonNegative('end_time_unix_ms', input.endTimeUnixMs);
  validateWindowOrder(input.startTimeUnixMs, input.endTimeUnixMs);
  validateJson('quality_flags_json', input.qualityFlagsJson ?? '[]');
  validateJsonObject('provenance_json', input.provenanceJson);
  if (!(await getActivitySession(db, input.activitySessionId))) {
    throw new StoreValidationError(`activity session ${input.activitySessionId} not found`);
  }
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO activity_metrics
       (metric_id, activity_session_id, metric_name, value, unit, start_time_unix_ms,
        end_time_unix_ms, quality_flags_json, provenance_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.metricId, input.activitySessionId, input.metricName, input.value, input.unit,
      input.startTimeUnixMs, input.endTimeUnixMs, input.qualityFlagsJson ?? '[]', input.provenanceJson,
    ],
  );
  return result.changes > 0;
}

/** Insert an interval attached to an existing session. Returns false if it already exists. */
export async function insertActivityInterval(
  db: GooseDatabase,
  input: ActivityIntervalInput,
): Promise<boolean> {
  validateRequired('interval_id', input.intervalId);
  validateRequired('activity_session_id', input.activitySessionId);
  validateRequired('interval_type', input.intervalType);
  validateAllowed('interval_type', input.intervalType, ALLOWED_ACTIVITY_INTERVAL_TYPES);
  validateNonNegative('start_time_unix_ms', input.startTimeUnixMs);
  validateNonNegative('end_time_unix_ms', input.endTimeUnixMs);
  validateWindowOrder(input.startTimeUnixMs, input.endTimeUnixMs);
  validateJsonObject('metadata_json', input.metadataJson ?? '{}');
  validateJsonObject('provenance_json', input.provenanceJson);
  if (!(await getActivitySession(db, input.activitySessionId))) {
    throw new StoreValidationError(`activity session ${input.activitySessionId} not found`);
  }
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO activity_intervals
       (interval_id, activity_session_id, interval_type, start_time_unix_ms, end_time_unix_ms,
        duration_ms, sequence, metadata_json, provenance_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.intervalId, input.activitySessionId, input.intervalType, input.startTimeUnixMs,
      input.endTimeUnixMs, input.endTimeUnixMs - input.startTimeUnixMs, input.sequence,
      input.metadataJson ?? '{}', input.provenanceJson,
    ],
  );
  return result.changes > 0;
}

/** Metrics for a session, ordered by start then name. */
export function listActivityMetrics(
  db: GooseDatabase,
  sessionId: string,
): Promise<{ metric_name: string; value: number; unit: string }[]> {
  return db.getAllAsync(
    `SELECT metric_name, value, unit FROM activity_metrics
      WHERE activity_session_id = ? ORDER BY start_time_unix_ms, metric_name`,
    [sessionId],
  );
}

/** Intervals for a session, ordered by sequence. */
export function listActivityIntervals(
  db: GooseDatabase,
  sessionId: string,
): Promise<{ interval_type: string; sequence: number; duration_ms: number }[]> {
  return db.getAllAsync(
    `SELECT interval_type, sequence, duration_ms FROM activity_intervals
      WHERE activity_session_id = ? ORDER BY sequence`,
    [sessionId],
  );
}

function sessionParams(input: ActivitySessionInput): (string | number | null)[] {
  return [
    input.sessionId,
    input.source,
    input.startTimeUnixMs,
    input.endTimeUnixMs,
    input.endTimeUnixMs - input.startTimeUnixMs,
    input.activityType,
    input.externalActivityTypeCode ?? null,
    input.externalActivityTypeName ?? null,
    input.customLabel ?? null,
    input.confidence,
    input.detectionMethod,
    input.syncStatus,
    input.provenanceJson,
  ];
}

function sessionMatches(row: ActivitySessionRow, input: ActivitySessionInput): boolean {
  return (
    row.source === input.source &&
    row.start_time_unix_ms === input.startTimeUnixMs &&
    row.end_time_unix_ms === input.endTimeUnixMs &&
    row.activity_type === input.activityType &&
    row.external_activity_type_code === (input.externalActivityTypeCode ?? null) &&
    row.external_activity_type_name === (input.externalActivityTypeName ?? null) &&
    row.custom_label === (input.customLabel ?? null) &&
    row.confidence === input.confidence &&
    row.detection_method === input.detectionMethod &&
    row.sync_status === input.syncStatus &&
    row.provenance_json === input.provenanceJson
  );
}
