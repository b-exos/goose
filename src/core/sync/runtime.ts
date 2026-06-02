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
  maxIdleRetries?: number;
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
  private readonly schedule: (ms: number, fn: () => void) => Cancel;
  private quietTimer: Cancel | null = null;
  private sawFirstFrame = false;
  private resolve: ((result: HistoricalSyncResult) => void) | null = null;

  constructor(
    private readonly client: HistoricalSyncClient,
    private readonly options: HistoricalSyncRunnerOptions = {},
  ) {
    this.machine = new HistoricalSync({ maxIdleRetries: options.maxIdleRetries });
    this.quietPeriodMs = options.quietPeriodMs ?? 3000;
    this.ackTimeoutMs = options.ackTimeoutMs ?? 10000;
    this.schedule = options.schedule ?? defaultSchedule;
  }

  /** Begin the sync; resolves when the machine reaches a terminal state. */
  run(): Promise<HistoricalSyncResult> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      void this.perform(this.machine.dispatch({ type: 'start', withRange: this.options.withRange }));
    });
  }

  /** Feed an inbound parsed frame (called for every notification during a sync). */
  onFrame(frame: ParsedFrame): void {
    if (this.machine.isTerminal) return;
    if (!this.sawFirstFrame) {
      this.sawFirstFrame = true;
      void this.perform(this.machine.dispatch({ type: 'history_start' }));
    }
    const event = classifyHistoricalFrame(frame);
    if (event) void this.perform(this.machine.dispatch(event));
    if (this.machine.state === 'transferring') this.armQuietTimer();
  }

  private armQuietTimer(): void {
    this.quietTimer?.();
    this.quietTimer = this.schedule(this.quietPeriodMs, () => {
      // No frames for the quiet period ⇒ transfer finished. Ack, then complete.
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
          this.quietTimer = null;
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
