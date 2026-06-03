/**
 * Runtime that drives the historical-sync state machine against the BLE client.
 *
 * Sends the commands the machine asks for, feeds inbound frames in as events, and detects
 * transfer boundaries with a quiet-period heuristic (no frames for `quietPeriodMs` ⇒
 * HistoryEnd → ack → complete) so it works without yet knowing the exact marker bytes.
 * Timers are injected for testability.
 */
import type { ParsedFrame } from '../protocol';
import { classifyHistoricalFrame } from './classify';
import {
  HistoricalSync,
  type HistoricalSyncAction,
  type HistoricalSyncCounts,
} from './historical-sync';

/** The subset of the BLE client the runner needs. */
export interface HistoricalSyncClient {
  sendGetDataRange(): Promise<void>;
  sendHistoricalData(): Promise<void>;
  sendHistoricalDataResult(success: boolean): Promise<void>;
  sendAbortHistorical(): Promise<void>;
}

type Cancel = () => void;

export interface HistoricalSyncRunnerOptions {
  withRange?: boolean;
  quietPeriodMs?: number;
  ackTimeoutMs?: number;
  /** How long to wait for the first inbound frame before treating it as an idle timeout. */
  firstFrameTimeoutMs?: number;
  /** Hard cap on the whole session; cancels if exceeded. */
  transferTimeoutMs?: number;
  maxIdleRetries?: number;
  /**
   * Drain paged history: on a mid-transfer lull, if readings arrived since the last request,
   * re-issue `send_historical_data` to pull the next chunk instead of finishing. The band
   * sends a chunk then waits (pinging metadata) for the next request. Finishes when a request
   * yields no new readings.
   */
  drain?: boolean;
  /** Safety cap on `send_historical_data` continuations when draining. */
  maxContinues?: number;
  /** Schedule `fn` after `ms`; returns a cancel function. Defaults to setTimeout. */
  schedule?: (ms: number, fn: () => void) => Cancel;
}

export interface HistoricalSyncResult {
  status: 'complete' | 'failed';
  counts: HistoricalSyncCounts;
  failureReason: string | null;
}

const defaultSchedule = (ms: number, fn: () => void): Cancel => {
  const handle = setTimeout(fn, ms);
  return () => clearTimeout(handle);
};

export class HistoricalSyncRunner {
  private readonly machine: HistoricalSync;
  private readonly quietPeriodMs: number;
  private readonly ackTimeoutMs: number;
  private readonly firstFrameTimeoutMs: number;
  private readonly transferTimeoutMs: number;
  private readonly drain: boolean;
  private readonly maxContinues: number;
  private readonly schedule: (ms: number, fn: () => void) => Cancel;
  private quietTimer: Cancel | null = null;
  private firstFrameTimer: Cancel | null = null;
  private overallTimer: Cancel | null = null;
  private sawFirstFrame = false;
  private readingsSinceContinue = 0;
  private continuesSent = 0;
  private resolve: ((result: HistoricalSyncResult) => void) | null = null;

  constructor(
    private readonly client: HistoricalSyncClient,
    private readonly options: HistoricalSyncRunnerOptions = {},
  ) {
    this.machine = new HistoricalSync({ maxIdleRetries: options.maxIdleRetries });
    this.quietPeriodMs = options.quietPeriodMs ?? 3000;
    this.ackTimeoutMs = options.ackTimeoutMs ?? 10000;
    this.firstFrameTimeoutMs = options.firstFrameTimeoutMs ?? 15000;
    this.transferTimeoutMs = options.transferTimeoutMs ?? 120000;
    this.drain = options.drain ?? false;
    this.maxContinues = options.maxContinues ?? 500;
    this.schedule = options.schedule ?? defaultSchedule;
  }

  /** Begin the sync; resolves when the machine reaches a terminal state. */
  run(): Promise<HistoricalSyncResult> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      void this.perform(this.machine.dispatch({ type: 'start', withRange: this.options.withRange }));
      this.armFirstFrameTimeout();
      // Hard cap: cancel the whole session if it runs too long.
      this.overallTimer = this.schedule(this.transferTimeoutMs, () => {
        if (!this.machine.isTerminal) void this.perform(this.machine.dispatch({ type: 'cancel' }));
      });
    });
  }

  /** If no first frame arrives in time, treat as an idle timeout (retry once, then fail). */
  private armFirstFrameTimeout(): void {
    this.firstFrameTimer?.();
    this.firstFrameTimer = this.schedule(this.firstFrameTimeoutMs, () => {
      if (this.sawFirstFrame || this.machine.isTerminal) return;
      void this.perform(this.machine.dispatch({ type: 'idle_timeout' }));
      if (!this.machine.isTerminal && !this.sawFirstFrame) this.armFirstFrameTimeout();
    });
  }

  /** Feed an inbound parsed frame (called for every notification during a sync). */
  onFrame(frame: ParsedFrame): void {
    if (this.machine.isTerminal) return;

    // The reply to get_data_range is not data — it advances us to actually request the data.
    if (this.machine.state === 'range_requested') {
      void this.perform(this.machine.dispatch({ type: 'range_response' }));
      this.armFirstFrameTimeout(); // now wait for the historical data stream
      return;
    }

    if (!this.sawFirstFrame && this.machine.state === 'awaiting_start') {
      this.sawFirstFrame = true;
      this.firstFrameTimer?.();
      this.firstFrameTimer = null;
      void this.perform(this.machine.dispatch({ type: 'history_start' }));
    }
    const event = classifyHistoricalFrame(frame);
    if (event) {
      if (event.type === 'reading') this.readingsSinceContinue += 1;
      void this.perform(this.machine.dispatch(event));
    }
    // Only readings keep the transfer "alive": the band pings metadata every ~2.5s while
    // waiting for the next request, so the lull must be measured by absence of readings.
    if (this.machine.state === 'transferring' && event?.type === 'reading') this.armQuietTimer();
  }

  private armQuietTimer(): void {
    this.quietTimer?.();
    this.quietTimer = this.schedule(this.quietPeriodMs, () => {
      // Draining: a lull with readings still flowing means the band sent a chunk and is waiting
      // for the next request. Pull the next chunk instead of ending.
      if (this.drain && this.readingsSinceContinue > 0 && this.continuesSent < this.maxContinues) {
        this.readingsSinceContinue = 0;
        this.continuesSent += 1;
        void this.client.sendHistoricalData();
        this.armQuietTimer();
        return;
      }
      // No new readings across a full quiet period ⇒ transfer finished. Ack, then complete.
      void this.perform(this.machine.dispatch({ type: 'history_end' }));
      this.schedule(this.ackTimeoutMs, () => {
        void this.perform(this.machine.dispatch({ type: 'history_complete' }));
      });
    });
  }

  private async perform(actions: HistoricalSyncAction[]): Promise<void> {
    for (const action of actions) {
      switch (action.type) {
        case 'send_get_data_range':
          await this.client.sendGetDataRange();
          break;
        case 'send_historical_data':
          await this.client.sendHistoricalData();
          break;
        case 'send_ack':
          await this.client.sendHistoricalDataResult(action.success);
          break;
        case 'send_abort':
          await this.client.sendAbortHistorical();
          break;
        case 'done':
          this.quietTimer?.();
          this.firstFrameTimer?.();
          this.overallTimer?.();
          this.quietTimer = null;
          this.firstFrameTimer = null;
          this.overallTimer = null;
          this.resolve?.({
            status: action.status,
            counts: this.machine.counts,
            failureReason: this.machine.failureReason,
          });
          this.resolve = null;
          break;
      }
    }
  }
}
