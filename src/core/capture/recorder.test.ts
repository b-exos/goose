/** Tests the CaptureRecorder lifecycle: session open, batched persistence, finalize. */
import { decodeHexWithWhitespace } from '../protocol';
import { getCaptureSession, listDecodedFramesForEvidence } from '../store/capture-repository';
import { migrate } from '../store/db';
import { loadHex } from '../testing/fixtures';
import { createTestDatabase, type TestDatabase } from '../testing/sqlite';
import { CaptureRecorder } from './recorder';

describe('CaptureRecorder', () => {
  let db: TestDatabase;
  beforeEach(async () => {
    db = createTestDatabase();
    await migrate(db);
  });
  afterEach(() => db.close());

  it('opens a session, persists recorded frames, and finalizes', async () => {
    const recorder = new CaptureRecorder(db, 'sess-1', 'WHOOP 5.0 Goose');
    await recorder.start();

    const hello = decodeHexWithWhitespace(loadHex('synthetic/goose_v5_get_hello_frame.hex'));
    recorder.record(hello);
    recorder.record(hello); // same bytes -> idempotent evidence id differs (counter), frame parsed

    await recorder.finish();

    const session = await getCaptureSession(db, 'sess-1');
    expect(session?.status).toBe('finished');
    expect(session?.ended_at_unix_ms).not.toBeNull();

    // Each recorded frame becomes its own evidence row -> decoded frame.
    const frames = await listDecodedFramesForEvidence(db, 'sess-1.ev.1');
    expect(frames).toHaveLength(1);
    expect(frames[0].packet_type).toBe(35);
  });

  it('flushes automatically once the buffer threshold is reached', async () => {
    const recorder = new CaptureRecorder(db, 'sess-2', 'WHOOP 5.0 Goose');
    await recorder.start();
    const hello = decodeHexWithWhitespace(loadHex('synthetic/goose_v5_get_hello_frame.hex'));
    for (let i = 0; i < 25; i++) recorder.record(hello);
    await recorder.finish();

    const rows = await db.getAllAsync<{ n: number }>('SELECT COUNT(*) as n FROM raw_evidence');
    expect(rows[0].n).toBe(25);
  });
});
