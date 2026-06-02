/**
 * Store round-trip test for the capture-ingest path, exercising protocol -> store.
 * Parses the GET_HELLO golden frame, persists session + evidence + decoded frame,
 * and reads them back through the repositories.
 */
import { parseFrameHex } from '../protocol';
import { loadHex } from '../testing/fixtures';
import { createTestDatabase, type TestDatabase } from '../testing/sqlite';
import { migrate, schemaVersion } from './db';
import {
  finishCaptureSession,
  getCaptureSession,
  insertCaptureSession,
  insertDecodedFrame,
  insertRawEvidence,
  listDecodedFramesForEvidence,
} from './capture-repository';

describe('store capture-ingest', () => {
  let db: TestDatabase;
  beforeEach(async () => {
    db = createTestDatabase();
    await migrate(db);
  });
  afterEach(() => db.close());

  it('migrates to schema version 14', async () => {
    expect(await schemaVersion(db)).toBe(14);
  });

  it('round-trips a capture session, evidence, and decoded frame', async () => {
    await insertCaptureSession(db, {
      sessionId: 'sess-1',
      source: 'ble',
      startedAtUnixMs: 1000,
      deviceModel: 'WHOOP 5.0 Goose',
      status: 'recording',
    });
    await finishCaptureSession(db, 'sess-1', 2000);

    const session = await getCaptureSession(db, 'sess-1');
    expect(session?.status).toBe('finished');
    expect(session?.ended_at_unix_ms).toBe(2000);

    const hex = loadHex('synthetic/goose_v5_get_hello_frame.hex');
    const frame = parseFrameHex('GOOSE', hex);

    await insertRawEvidence(db, {
      evidenceId: 'ev-1',
      source: 'ble',
      capturedAt: '2026-05-28T00:00:00.000Z',
      deviceModel: 'WHOOP 5.0 Goose',
      payloadHex: frame.payloadHex,
      sha256: 'deadbeef',
      sensitivity: 'user-owned-capture',
      captureSessionId: 'sess-1',
    });
    await insertDecodedFrame(db, 'frame-1', 'ev-1', frame);

    const frames = await listDecodedFramesForEvidence(db, 'ev-1');
    expect(frames).toHaveLength(1);
    expect(frames[0].packet_type).toBe(35);
    expect(frames[0].header_crc_valid).toBe(1);
    expect(frames[0].payload_crc_valid).toBe(1);
    expect(frames[0].payload_hex).toBe('23019101');
    expect(JSON.parse(frames[0].warnings_json)).toEqual([]);
  });
});
