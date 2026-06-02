/** Tests the historical-sync runtime orchestration with a fake client + manual timers. */
import { parseFrameHex } from '../protocol';
import { loadHex } from '../testing/fixtures';
import { HistoricalSyncRunner, type HistoricalSyncClient } from './runtime';

function fakeClient() {
  const calls: string[] = [];
  const client: HistoricalSyncClient = {
    sendGetDataRange: async () => void calls.push('range'),
    sendHistoricalData: async () => void calls.push('data'),
    sendHistoricalDataResult: async (s) => void calls.push(`ack:${s}`),
    sendAbortHistorical: async () => void calls.push('abort'),
  };
  return { client, calls };
}

/** Controllable scheduler: timers fire only when `fireAll` is called. */
function manualScheduler() {
  const pending: { fn: () => void; done: boolean }[] = [];
  const schedule = (_ms: number, fn: () => void) => {
    const timer = { fn, done: false };
    pending.push(timer);
    return () => {
      timer.done = true;
    };
  };
  const fireAll = () => {
    for (;;) {
      const next = pending.find((t) => !t.done);
      if (!next) break;
      next.done = true;
      next.fn();
    }
  };
  return { schedule, fireAll };
}

describe('HistoricalSyncRunner', () => {
  it('runs a transfer to completion via the quiet-period heuristic', async () => {
    const { client, calls } = fakeClient();
    const sched = manualScheduler();
    const runner = new HistoricalSyncRunner(client, {
      quietPeriodMs: 3000,
      ackTimeoutMs: 10000,
      schedule: sched.schedule,
    });

    const promise = runner.run();
    const k18 = parseFrameHex('GOOSE', loadHex('synthetic/goose_v5_historical_k18_packet.hex'));
    runner.onFrame(k18);
    runner.onFrame(k18);
    runner.onFrame(k18);

    sched.fireAll(); // quiet period elapses → ack → ack timeout → complete
    const result = await promise;

    expect(result.status).toBe('complete');
    expect(result.counts.readings).toBe(3);
    expect(result.counts.byFamily).toEqual({ k18: 3 });
    expect(calls).toContain('data');
    expect(calls).toContain('ack:true');
  });

  it('requests the data range first when withRange is set', async () => {
    const { client, calls } = fakeClient();
    const sched = manualScheduler();
    const runner = new HistoricalSyncRunner(client, { withRange: true, schedule: sched.schedule });
    void runner.run();
    expect(calls[0]).toBe('range');
  });
});
