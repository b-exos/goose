/**
 * Capture-ingest persistence: capture sessions, raw evidence, and decoded frames.
 *
 * Ported from the corresponding `GooseStore` methods in
 * `docs/rust-reference/src/store.rs`. Pure data access over a `GooseDatabase`; callers
 * supply already-computed values (e.g. content `sha256`) so these stay testable in node.
 */
import type { ParsedFrame } from '../protocol';
import type { GooseDatabase } from './db';

/** Parser identity recorded on each decoded frame row. */
export const PARSER_VERSION = 'goose-ts.protocol.v1';

export interface CaptureSessionInput {
  sessionId: string;
  source: string;
  startedAtUnixMs: number;
  deviceModel: string;
  activeDeviceId?: string | null;
  status: string;
  provenanceJson?: string;
}

export interface CaptureSessionRow {
  session_id: string;
  source: string;
  started_at_unix_ms: number;
  ended_at_unix_ms: number | null;
  device_model: string;
  active_device_id: string | null;
  status: string;
  frame_count: number;
  provenance_json: string;
}

export interface RawEvidenceInput {
  evidenceId: string;
  source: string;
  capturedAt: string;
  deviceModel: string;
  payloadHex: string;
  sha256: string;
  sensitivity: string;
  captureSessionId?: string | null;
}

/** Insert a capture session row. */
export async function insertCaptureSession(
  db: GooseDatabase,
  input: CaptureSessionInput,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO capture_sessions
       (session_id, source, started_at_unix_ms, device_model, active_device_id, status, provenance_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.sessionId,
      input.source,
      input.startedAtUnixMs,
      input.deviceModel,
      input.activeDeviceId ?? null,
      input.status,
      input.provenanceJson ?? '{}',
    ],
  );
}

/** Mark a capture session finished at the given time, setting its final status. */
export async function finishCaptureSession(
  db: GooseDatabase,
  sessionId: string,
  endedAtUnixMs: number,
  status = 'finished',
): Promise<void> {
  await db.runAsync(
    `UPDATE capture_sessions
        SET ended_at_unix_ms = ?, status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE session_id = ?`,
    [endedAtUnixMs, status, sessionId],
  );
}

/** Fetch a capture session by id, or null. */
export function getCaptureSession(
  db: GooseDatabase,
  sessionId: string,
): Promise<CaptureSessionRow | null> {
  return db.getFirstAsync<CaptureSessionRow>(
    'SELECT * FROM capture_sessions WHERE session_id = ?',
    [sessionId],
  );
}

/** List capture sessions, most recently started first. */
export function listCaptureSessions(db: GooseDatabase): Promise<CaptureSessionRow[]> {
  return db.getAllAsync<CaptureSessionRow>(
    'SELECT * FROM capture_sessions ORDER BY started_at_unix_ms DESC',
  );
}

/** Insert a raw-evidence row (one captured frame). Returns true if newly inserted. */
export async function insertRawEvidence(
  db: GooseDatabase,
  input: RawEvidenceInput,
): Promise<boolean> {
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO raw_evidence
       (evidence_id, source, captured_at, device_model, payload_hex, sha256, sensitivity, capture_session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.evidenceId,
      input.source,
      input.capturedAt,
      input.deviceModel,
      input.payloadHex,
      input.sha256,
      input.sensitivity,
      input.captureSessionId ?? null,
    ],
  );
  return result.changes > 0;
}

/**
 * Insert a decoded-frame row derived from a `ParsedFrame`. Booleans are stored as 0/1
 * and the parsed payload + warnings are JSON-encoded, matching the Rust schema.
 */
export async function insertDecodedFrame(
  db: GooseDatabase,
  frameId: string,
  evidenceId: string,
  frame: ParsedFrame,
): Promise<boolean> {
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO decoded_frames
       (frame_id, evidence_id, device_type, raw_len, header_len, declared_len,
        payload_hex, payload_crc_hex, header_crc_valid, payload_crc_valid,
        packet_type, packet_type_name, sequence, command_or_event,
        parsed_payload_json, parser_version, warnings_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      frameId,
      evidenceId,
      frame.deviceType,
      frame.rawLen,
      frame.headerLen,
      frame.declaredLen,
      frame.payloadHex,
      frame.payloadCrcHex,
      frame.headerCrcValid ? 1 : 0,
      frame.payloadCrcValid ? 1 : 0,
      frame.packetType,
      frame.packetTypeName,
      frame.sequence,
      frame.commandOrEvent,
      JSON.stringify(frame.parsedPayload),
      PARSER_VERSION,
      JSON.stringify(frame.warnings),
    ],
  );
  return result.changes > 0;
}

export interface DecodedFrameRow {
  frame_id: string;
  evidence_id: string;
  device_type: string;
  packet_type: number | null;
  packet_type_name: string | null;
  header_crc_valid: number;
  payload_crc_valid: number;
  payload_hex: string;
  warnings_json: string;
}

/** List decoded frames for a given evidence row, in insertion order. */
export function listDecodedFramesForEvidence(
  db: GooseDatabase,
  evidenceId: string,
): Promise<DecodedFrameRow[]> {
  return db.getAllAsync<DecodedFrameRow>(
    'SELECT * FROM decoded_frames WHERE evidence_id = ? ORDER BY rowid ASC',
    [evidenceId],
  );
}
