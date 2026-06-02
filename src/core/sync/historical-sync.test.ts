/** Tests for the historical-sync state machine reducer. */
import { HistoricalSync, type HistoricalSyncAction } from './historical-sync';

function actions(machine: HistoricalSync, ...events: Parameters<HistoricalSync['dispatch']>[0][]): HistoricalSyncAction[] {
  return events.flatMap((e) => machine.dispatch(e));
}

describe('HistoricalSync', () => {
  it('runs the happy path: range → data → readings → end → ack → complete', () => {
    const m = new HistoricalSync();
    expect(m.dispatch({ type: 'start', withRange: true })).toEqual([{ type: 'send_get_data_range' }]);
    expect(m.state).toBe('range_requested');
    expect(m.dispatch({ type: 'range_response' })).toEqual([{ type: 'send_historical_data' }]);
    expect(m.state).toBe('awaiting_start');
    m.dispatch({ type: 'history_start' });
    expect(m.state).toBe('transferring');

    actions(m,
      { type: 'reading', family: 'k18' },
      { type: 'reading', family: 'k24' },
      { type: 'reading', family: 'k18' },
      { type: 'metadata', name: 'marker' },
    );
    expect(m.counts.readings).toBe(3);
    expect(m.counts.metadata).toBe(1);
    expect(m.counts.byFamily).toEqual({ k18: 2, k24: 1 });

    expect(m.dispatch({ type: 'history_end' })).toEqual([{ type: 'send_ack', success: true }]);
    expect(m.state).toBe('ack_pending');
    expect(m.dispatch({ type: 'history_complete' })).toEqual([{ type: 'done', status: 'complete' }]);
    expect(m.state).toBe('complete');
    expect(m.isTerminal).toBe(true);
  });

  it('starts directly with SendHistoricalData when no range requested', () => {
    const m = new HistoricalSync();
    expect(m.dispatch({ type: 'start' })).toEqual([{ type: 'send_historical_data' }]);
    expect(m.state).toBe('awaiting_start');
  });

  it('retries once on idle timeout, then fails', () => {
    const m = new HistoricalSync({ maxIdleRetries: 1 });
    m.dispatch({ type: 'start' });
    m.dispatch({ type: 'history_start' });
    // first idle timeout -> abort + resend
    expect(m.dispatch({ type: 'idle_timeout' })).toEqual([
      { type: 'send_abort' },
      { type: 'send_historical_data' },
    ]);
    expect(m.state).toBe('awaiting_start');
    // second idle timeout -> fail
    expect(m.dispatch({ type: 'idle_timeout' })).toEqual([{ type: 'done', status: 'failed' }]);
    expect(m.state).toBe('failed');
    expect(m.failureReason).toBe('idle_timeout');
  });

  it('fails on a malformed response and ignores further events', () => {
    const m = new HistoricalSync();
    m.dispatch({ type: 'start' });
    m.dispatch({ type: 'history_start' });
    expect(m.dispatch({ type: 'malformed', detail: 'bad_crc' })).toEqual([{ type: 'done', status: 'failed' }]);
    expect(m.failureReason).toBe('bad_crc');
    expect(m.dispatch({ type: 'history_complete' })).toEqual([]);
  });

  it('cancel aborts and fails', () => {
    const m = new HistoricalSync();
    m.dispatch({ type: 'start' });
    expect(m.dispatch({ type: 'cancel' })).toEqual([
      { type: 'send_abort' },
      { type: 'done', status: 'failed' },
    ]);
  });
});
