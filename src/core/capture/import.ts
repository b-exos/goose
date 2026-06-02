/**
 * Capture frame-batch import: decode raw frames, store them as evidence, parse, and
 * persist decoded frames. This is the BLE/capture ingest path.
 *
 * Ported from `import_captured_frame_batch` in `docs/rust-reference/src/capture_import.rs`.
 * Raw evidence stores the *full frame* bytes (hex + sha256), matching the Rust store.
 */
import { sha256Hex } from '../hash/sha256';
import { decodeHexWithWhitespace, encodeHex, parseFrame, type DeviceType } from '../protocol';
import {
  insertDecodedFrame,
  insertRawEvidence,
  PARSER_VERSION,
} from '../store/capture-repository';
import type { GooseDatabase } from '../store/db';

/** One captured frame to import. Mirrors Rust `CapturedFrameInput`. */
export interface CapturedFrameInput {
  evidenceId: string;
  frameId?: string;
  source: string;
  capturedAt: string;
  deviceModel: string;
  frameHex: string;
  sensitivity: string;
  captureSessionId?: string | null;
  deviceType?: DeviceType;
}

/** Outcome for a single imported frame. */
export interface CapturedFrameImportResult {
  evidenceId: string;
  frameId: string;
  importedRaw: boolean;
  importedFrame: boolean;
  parseOk: boolean;
  packetType: number | null;
  packetTypeName: string | null;
  parsedPayloadKind: string | null;
  issues: string[];
}

/** Aggregate report for a batch import. Mirrors Rust `CapturedFrameBatchImportReport`. */
export interface CapturedFrameBatchImportReport {
  schema: string;
  generatedBy: string;
  pass: boolean;
  frameCount: number;
  rawInserted: number;
  rawExisting: number;
  framesInserted: number;
  framesExisting: number;
  results: CapturedFrameImportResult[];
  issues: string[];
}

/** Import one captured frame: store raw evidence, parse, store decoded frame. */
async function importOne(
  db: GooseDatabase,
  frame: CapturedFrameInput,
): Promise<CapturedFrameImportResult> {
  const frameId = frame.frameId ?? `${frame.evidenceId}.frame.0`;
  const deviceType = frame.deviceType ?? 'GOOSE';
  const issues: string[] = [];

  let rawBytes: Uint8Array;
  try {
    rawBytes = decodeHexWithWhitespace(frame.frameHex);
  } catch (error) {
    return {
      evidenceId: frame.evidenceId,
      frameId,
      importedRaw: false,
      importedFrame: false,
      parseOk: false,
      packetType: null,
      packetTypeName: null,
      parsedPayloadKind: null,
      issues: [String(error)],
    };
  }

  const importedRaw = await insertRawEvidence(db, {
    evidenceId: frame.evidenceId,
    source: frame.source,
    capturedAt: frame.capturedAt,
    deviceModel: frame.deviceModel,
    payloadHex: encodeHex(rawBytes),
    sha256: sha256Hex(rawBytes),
    sensitivity: frame.sensitivity,
    captureSessionId: frame.captureSessionId ?? null,
  });

  try {
    const parsed = parseFrame(deviceType, rawBytes);
    const importedFrame = await insertDecodedFrame(db, frameId, frame.evidenceId, parsed);
    return {
      evidenceId: frame.evidenceId,
      frameId,
      importedRaw,
      importedFrame,
      parseOk: true,
      packetType: parsed.packetType,
      packetTypeName: parsed.packetTypeName,
      parsedPayloadKind: parsed.parsedPayload?.kind ?? null,
      issues,
    };
  } catch (error) {
    issues.push(String(error));
    return {
      evidenceId: frame.evidenceId,
      frameId,
      importedRaw,
      importedFrame: false,
      parseOk: false,
      packetType: null,
      packetTypeName: null,
      parsedPayloadKind: null,
      issues,
    };
  }
}

/**
 * Import a batch of captured frames. Each frame is stored as raw evidence and (if it
 * parses) a decoded frame. Inserts are idempotent, so re-importing is a no-op.
 */
export async function importCapturedFrameBatch(
  db: GooseDatabase,
  frames: CapturedFrameInput[],
): Promise<CapturedFrameBatchImportReport> {
  const results: CapturedFrameImportResult[] = [];
  const issues: string[] = [];
  let rawInserted = 0;
  let rawExisting = 0;
  let framesInserted = 0;
  let framesExisting = 0;

  for (const frame of frames) {
    const result = await importOne(db, frame);
    if (result.importedRaw) rawInserted++;
    else rawExisting++;
    if (result.parseOk) {
      if (result.importedFrame) framesInserted++;
      else framesExisting++;
    }
    if (result.issues.length > 0) {
      issues.push(`${result.evidenceId}: ${result.issues.join('; ')}`);
    }
    results.push(result);
  }

  return {
    schema: 'goose.captured-frame-batch-import-report.v1',
    generatedBy: `goose-ts-capture-import/${PARSER_VERSION}`,
    pass: issues.length === 0,
    frameCount: frames.length,
    rawInserted,
    rawExisting,
    framesInserted,
    framesExisting,
    results,
    issues,
  };
}
