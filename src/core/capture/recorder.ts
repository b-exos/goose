/**
 * Buffers inbound BLE frames during a connection and persists them durably.
 *
 * Opens a capture session on `start()`, batches raw frames (flushing every N frames), and
 * finalizes the session on `finish()`. Built on `importCapturedFrameBatch` (raw_evidence +
 * decoded_frames) and the capture repository. Frame bytes arrive from the BLE notification
 * callback; flushing is async and de-duplicated so callbacks never block.
 */
import { encodeHex } from '../protocol';
import {
  finishCaptureSession,
  insertCaptureSession,
} from '../store/capture-repository';
import type { GooseDatabase } from '../store/db';
import { importCapturedFrameBatch, type CapturedFrameInput } from './import';

const FLUSH_THRESHOLD = 20;

export class CaptureRecorder {
  private buffer: CapturedFrameInput[] = [];
  private counter = 0;
  private flushChain: Promise<void> = Promise.resolve();
  private started = false;

  constructor(
    private readonly db: GooseDatabase,
    private readonly sessionId: string,
    private readonly deviceModel: string,
  ) {}

  /** Create the capture session row. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await insertCaptureSession(this.db, {
      sessionId: this.sessionId,
      source: 'ble',
      startedAtUnixMs: Date.now(),
      deviceModel: this.deviceModel,
      status: 'recording',
    });
  }

  /** Queue a raw frame for persistence; flushes when the buffer fills. */
  record(raw: Uint8Array): void {
    this.counter += 1;
    this.buffer.push({
      evidenceId: `${this.sessionId}.ev.${this.counter}`,
      source: 'ble',
      capturedAt: new Date().toISOString(),
      deviceModel: this.deviceModel,
      frameHex: encodeHex(raw),
      sensitivity: 'user-owned-capture',
      captureSessionId: this.sessionId,
    });
    if (this.buffer.length >= FLUSH_THRESHOLD) void this.flush();
  }

  /**
   * Persist any buffered frames. Flushes are serialized on a promise chain so concurrent
   * callers (auto-flush + `finish`) run in order and `finish` can await all in-flight work.
   */
  flush(): Promise<void> {
    this.flushChain = this.flushChain.then(() => this.doFlush());
    return this.flushChain;
  }

  private async doFlush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await importCapturedFrameBatch(this.db, batch);
    } catch {
      // Re-queue on failure so frames aren't lost.
      this.buffer = batch.concat(this.buffer);
    }
  }

  /** Flush remaining frames and mark the session finished. */
  async finish(): Promise<void> {
    await this.flush();
    if (this.started) {
      await finishCaptureSession(this.db, this.sessionId, Date.now());
    }
  }
}
