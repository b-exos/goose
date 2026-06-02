/**
 * End-to-end test for the capture frame-batch import: raw hex frames -> evidence + decoded
 * frames in the store, with idempotency and content-addressing (sha256) checks.
 */
import { sha256Hex } from '../hash/sha256';
import { decodeHexWithWhitespace } from '../protocol';
import { listDecodedFramesForEvidence } from '../store/capture-repository';
import { migrate } from '../store/db';
import { loadHex } from '../testing/fixtures';
import { createTestDatabase, type TestDatabase } from '../testing/sqlite';
import { importCapturedFrameBatch, type CapturedFrameInput } from './import';

describe('importCapturedFrameBatch', () => {
  let db: TestDatabase;
  beforeEach(async () => {
    db = createTestDatabase();
    await migrate(db);
  });
  afterEach(() => db.close());

  function frames(): CapturedFrameInput[] {
    return [
      {
        evidenceId: 'ev-hello',
        source: 'ble',
        capturedAt: '2026-05-28T00:00:00.000Z',
        deviceModel: 'WHOOP 5.0 Goose',
        frameHex: loadHex('synthetic/goose_v5_get_hello_frame.hex'),
        sensitivity: 'synthetic-no-user-data',
      },
      {
        evidenceId: 'ev-k10',
        source: 'ble',
        capturedAt: '2026-05-28T00:00:01.000Z',
        deviceModel: 'WHOOP 5.0 Goose',
        frameHex: loadHex('synthetic/goose_v5_k10_motion_summary_short.hex'),
        sensitivity: 'synthetic-no-user-data',
      },
      {
        evidenceId: 'ev-bad',
        source: 'ble',
        capturedAt: '2026-05-28T00:00:02.000Z',
        deviceModel: 'WHOOP 5.0 Goose',
        frameHex: 'bbccddee', // does not start with 0xaa -> parse fails, raw still stored
        sensitivity: 'synthetic-no-user-data',
      },
    ];
  }

  it('imports frames into evidence + decoded frames', async () => {
    const report = await importCapturedFrameBatch(db, frames());
    expect(report.frameCount).toBe(3);
    expect(report.rawInserted).toBe(3);
    expect(report.framesInserted).toBe(2);
    expect(report.pass).toBe(false); // the bad frame contributes an issue

    const hello = report.results.find((r) => r.evidenceId === 'ev-hello')!;
    expect(hello.parseOk).toBe(true);
    expect(hello.packetType).toBe(35);
    expect(hello.parsedPayloadKind).toBe('command');

    const bad = report.results.find((r) => r.evidenceId === 'ev-bad')!;
    expect(bad.importedRaw).toBe(true);
    expect(bad.parseOk).toBe(false);

    const decoded = await listDecodedFramesForEvidence(db, 'ev-k10');
    expect(decoded).toHaveLength(1);
    expect(decoded[0].packet_type).toBe(43);
  });

  it('content-addresses raw evidence with sha256 of the full frame', async () => {
    await importCapturedFrameBatch(db, frames());
    const row = await db.getFirstAsync<{ sha256: string }>(
      'SELECT sha256 FROM raw_evidence WHERE evidence_id = ?',
      ['ev-hello'],
    );
    const expected = sha256Hex(decodeHexWithWhitespace(loadHex('synthetic/goose_v5_get_hello_frame.hex')));
    expect(row?.sha256).toBe(expected);
  });

  it('is idempotent across repeated imports', async () => {
    await importCapturedFrameBatch(db, frames());
    const second = await importCapturedFrameBatch(db, frames());
    expect(second.rawInserted).toBe(0);
    expect(second.rawExisting).toBe(3);
    expect(second.framesInserted).toBe(0);
    expect(second.framesExisting).toBe(2);
  });
});
