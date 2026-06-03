/**
 * Historical (overnight) sync state machine.
 *
 * Models the band's buffered-data transfer, ported from the states/events in
 * `docs/rust-reference/src/historical_sync.rs`:
 *   start → [GetDataRange] → SendHistoricalData → HistoryStart → (readings + metadata) →
 *   HistoryEnd → HistoricalDataResult(ack) → HistoryComplete.
 * With idle-timeout retry (default 1) and abort/fail paths. The reducer is pure and fully
 * unit-tested; the runtime (`runtime.ts`) drives it against the BLE client + timers and
 * classifies inbound frames into these events.
 */

export type HistoricalSyncState =
  | 'idle'
  | 'range_requested'
  | 'awaiting_start'
  | 'transferring'
  | 'ack_pending'
  | 'complete'
  | 'failed';

export type HistoricalSyncEvent =
  | { type: 'start'; withRange?: boolean }
  | { type: 'range_response' }
  | { type: 'history_start' }
  | { type: 'reading'; family?: string }
  | { type: 'metadata'; name?: string }
  | { type: 'history_end' }
  | { type: 'history_complete' }
  | { type: 'idle_timeout' }
  | { type: 'cancel' }
  | { type: 'malformed'; detail?: string };

export type HistoricalSyncAction =
  | { type: 'send_get_data_range' }
  | { type: 'send_historical_data' }
  | { type: 'send_ack'; success: boolean }
  | { type: 'send_abort' }
  | { type: 'done'; status: 'complete' | 'failed' };

export interface HistoricalSyncCounts {
  readings: number;
  metadata: number;
  byFamily: Record<string, number>;
}

export interface HistoricalSyncOptions {
  maxIdleRetries?: number;
}

/** Deterministic driver for one historical-sync session. `dispatch` returns actions to perform. */
export class HistoricalSync {
  state: HistoricalSyncState = 'idle';
  counts: HistoricalSyncCounts = { readings: 0, metadata: 0, byFamily: {} };
  failureReason: string | null = null;
  private retriesUsed = 0;
  private readonly maxIdleRetries: number;

  constructor(options: HistoricalSyncOptions = {}) {
    this.maxIdleRetries = options.maxIdleRetries ?? 1;
  }

  get isTerminal(): boolean {
    return this.state === 'complete' || this.state === 'failed';
  }

  dispatch(event: HistoricalSyncEvent): HistoricalSyncAction[] {
    switch (event.type) {
      case 'start':
        if (this.state !== 'idle') return [];
        if (event.withRange) {
          this.state = 'range_requested';
          return [{ type: 'send_get_data_range' }];
        }
        this.state = 'awaiting_start';
        return [{ type: 'send_historical_data' }];

      case 'range_response':
        if (this.state !== 'range_requested') return [];
        this.state = 'awaiting_start';
        return [{ type: 'send_historical_data' }];

      case 'history_start':
        // Only the data stream starts the transfer — never the get_data_range reply.
        if (this.state === 'awaiting_start') this.state = 'transferring';
        return [];

      case 'reading':
        if (this.state === 'transferring') {
          this.counts.readings += 1;
          if (event.family) {
            this.counts.byFamily[event.family] = (this.counts.byFamily[event.family] ?? 0) + 1;
          }
        }
        return [];

      case 'metadata':
        if (this.state === 'transferring') this.counts.metadata += 1;
        return [];

      case 'history_end':
        if (this.state !== 'transferring') return [];
        this.state = 'ack_pending';
        return [{ type: 'send_ack', success: true }];

      case 'history_complete':
        if (this.state !== 'ack_pending') return [];
        this.state = 'complete';
        return [{ type: 'done', status: 'complete' }];

      case 'idle_timeout':
        if (this.isTerminal) return [];
        if (this.retriesUsed < this.maxIdleRetries) {
          this.retriesUsed += 1;
          this.state = 'awaiting_start';
          return [{ type: 'send_abort' }, { type: 'send_historical_data' }];
        }
        this.fail('idle_timeout');
        return [{ type: 'done', status: 'failed' }];

      case 'cancel':
        if (this.isTerminal) return [];
        this.fail('cancelled');
        return [{ type: 'send_abort' }, { type: 'done', status: 'failed' }];

      case 'malformed':
        if (this.isTerminal) return [];
        this.fail(event.detail ?? 'malformed_response');
        return [{ type: 'done', status: 'failed' }];

      default:
        return [];
    }
  }

  private fail(reason: string): void {
    this.state = 'failed';
    this.failureReason = reason;
  }
}
