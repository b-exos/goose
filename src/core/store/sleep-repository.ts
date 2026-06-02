/**
 * External-sleep persistence: imported sleep sessions and their stages
 * (e.g. from HealthKit / Health Connect / manual import).
 *
 * Ported from the external-sleep methods in `docs/rust-reference/src/store.rs`
 * (`insert_external_sleep_session`, `insert_external_sleep_stage`, lookups). `duration_ms`
 * is derived; stages must fall within their parent session's window.
 */
import type { GooseDatabase } from './db';
import {
  ALLOWED_EXTERNAL_SLEEP_PLATFORMS,
  ALLOWED_EXTERNAL_SLEEP_STAGE_KINDS,
  StoreValidationError,
  validateAllowed,
  validateConfidence,
  validateJsonObject,
  validateNonNegative,
  validateOptionalRequired,
  validateRequired,
  validateWindowOrder,
} from './validation';

export interface ExternalSleepSessionInput {
  sleepId: string;
  source: string;
  platform: string;
  platformRecordId?: string | null;
  startTimeUnixMs: number;
  endTimeUnixMs: number;
  timezone?: string | null;
  stageSummaryJson?: string;
  confidence: number;
  provenanceJson: string;
}

export interface ExternalSleepSessionRow {
  sleep_id: string;
  source: string;
  platform: string;
  platform_record_id: string | null;
  start_time_unix_ms: number;
  end_time_unix_ms: number;
  duration_ms: number;
  timezone: string | null;
  stage_summary_json: string;
  confidence: number;
  provenance_json: string;
}

export interface ExternalSleepStageInput {
  stageId: string;
  sleepId: string;
  stageKind: string;
  startTimeUnixMs: number;
  endTimeUnixMs: number;
  confidence: number;
  provenanceJson: string;
}

/** Insert an external sleep session. Returns false if an identical row already exists. */
export async function insertExternalSleepSession(
  db: GooseDatabase,
  input: ExternalSleepSessionInput,
): Promise<boolean> {
  validateRequired('sleep_id', input.sleepId);
  validateRequired('source', input.source);
  validateRequired('platform', input.platform);
  validateAllowed('platform', input.platform, ALLOWED_EXTERNAL_SLEEP_PLATFORMS);
  validateOptionalRequired('platform_record_id', input.platformRecordId);
  validateNonNegative('start_time_unix_ms', input.startTimeUnixMs);
  validateNonNegative('end_time_unix_ms', input.endTimeUnixMs);
  validateWindowOrder(input.startTimeUnixMs, input.endTimeUnixMs);
  validateOptionalRequired('timezone', input.timezone);
  validateJsonObject('stage_summary_json', input.stageSummaryJson ?? '{}');
  validateConfidence('confidence', input.confidence);
  validateJsonObject('provenance_json', input.provenanceJson);

  const existing = await getExternalSleepSession(db, input.sleepId);
  if (existing) {
    if (sessionMatches(existing, input)) return false;
    throw new StoreValidationError(
      `external sleep session ${input.sleepId} already exists with different metadata`,
    );
  }
  await db.runAsync(
    `INSERT INTO external_sleep_sessions
       (sleep_id, source, platform, platform_record_id, start_time_unix_ms, end_time_unix_ms,
        duration_ms, timezone, stage_summary_json, confidence, provenance_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.sleepId, input.source, input.platform, input.platformRecordId ?? null,
      input.startTimeUnixMs, input.endTimeUnixMs, input.endTimeUnixMs - input.startTimeUnixMs,
      input.timezone ?? null, input.stageSummaryJson ?? '{}', input.confidence, input.provenanceJson,
    ],
  );
  return true;
}

/** Fetch an external sleep session by id, or null. */
export function getExternalSleepSession(
  db: GooseDatabase,
  sleepId: string,
): Promise<ExternalSleepSessionRow | null> {
  validateRequired('sleep_id', sleepId);
  return db.getFirstAsync<ExternalSleepSessionRow>(
    'SELECT * FROM external_sleep_sessions WHERE sleep_id = ?',
    [sleepId],
  );
}

/** External sleep sessions overlapping [start, end), ordered by start then id. */
export function externalSleepSessionsBetween(
  db: GooseDatabase,
  startMs: number,
  endMs: number,
): Promise<ExternalSleepSessionRow[]> {
  validateNonNegative('start_time_unix_ms', startMs);
  validateNonNegative('end_time_unix_ms', endMs);
  validateWindowOrder(startMs, endMs);
  return db.getAllAsync<ExternalSleepSessionRow>(
    `SELECT * FROM external_sleep_sessions
      WHERE start_time_unix_ms < ? AND end_time_unix_ms > ?
      ORDER BY start_time_unix_ms, sleep_id`,
    [endMs, startMs],
  );
}

/** Insert a stage within an existing sleep session. Returns false if identical row exists. */
export async function insertExternalSleepStage(
  db: GooseDatabase,
  input: ExternalSleepStageInput,
): Promise<boolean> {
  validateRequired('stage_id', input.stageId);
  validateRequired('sleep_id', input.sleepId);
  const session = await getExternalSleepSession(db, input.sleepId);
  if (!session) {
    throw new StoreValidationError(`external sleep session ${input.sleepId} not found`);
  }
  validateRequired('stage_kind', input.stageKind);
  validateAllowed('stage_kind', input.stageKind, ALLOWED_EXTERNAL_SLEEP_STAGE_KINDS);
  validateNonNegative('start_time_unix_ms', input.startTimeUnixMs);
  validateNonNegative('end_time_unix_ms', input.endTimeUnixMs);
  validateWindowOrder(input.startTimeUnixMs, input.endTimeUnixMs);
  if (
    input.startTimeUnixMs < session.start_time_unix_ms ||
    input.endTimeUnixMs > session.end_time_unix_ms
  ) {
    throw new StoreValidationError(
      `external sleep stage ${input.stageId} must be within parent sleep session ${input.sleepId}`,
    );
  }
  validateConfidence('confidence', input.confidence);
  validateJsonObject('provenance_json', input.provenanceJson);

  const result = await db.runAsync(
    `INSERT OR IGNORE INTO external_sleep_stages
       (stage_id, sleep_id, stage_kind, start_time_unix_ms, end_time_unix_ms, duration_ms,
        confidence, provenance_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.stageId, input.sleepId, input.stageKind, input.startTimeUnixMs, input.endTimeUnixMs,
      input.endTimeUnixMs - input.startTimeUnixMs, input.confidence, input.provenanceJson,
    ],
  );
  return result.changes > 0;
}

/** Stages for a sleep session, ordered by start time. */
export function externalSleepStagesForSession(
  db: GooseDatabase,
  sleepId: string,
): Promise<{ stage_kind: string; duration_ms: number; start_time_unix_ms: number }[]> {
  return db.getAllAsync(
    `SELECT stage_kind, duration_ms, start_time_unix_ms FROM external_sleep_stages
      WHERE sleep_id = ? ORDER BY start_time_unix_ms`,
    [sleepId],
  );
}

function sessionMatches(
  row: ExternalSleepSessionRow,
  input: ExternalSleepSessionInput,
): boolean {
  return (
    row.source === input.source &&
    row.platform === input.platform &&
    row.platform_record_id === (input.platformRecordId ?? null) &&
    row.start_time_unix_ms === input.startTimeUnixMs &&
    row.end_time_unix_ms === input.endTimeUnixMs &&
    row.timezone === (input.timezone ?? null) &&
    row.stage_summary_json === (input.stageSummaryJson ?? '{}') &&
    row.confidence === input.confidence &&
    row.provenance_json === input.provenanceJson
  );
}
