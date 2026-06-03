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

/** Controllable scheduler: timers fire only when `fireAll` is called, in ascending-delay order. */
function manualScheduler() {
  let seq = 0;
  const pending: { ms: number; order: number; fn: () => void; done: boolean }[] = [];
  const schedule = (ms: number, fn: () => void) => {
    const timer = { ms, order: seq++, fn, done: false };
    pending.push(timer);
    return () => {
      timer.done = true;
    };
  };
  const fireAll = () => {
    for (;;) {
      const ready = pending.filter((t) => !t.done).sort((a, b) => a.ms - b.ms || a.order - b.order);
      if (ready.length === 0) break;
      const next = ready[0];
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

  it('with range: the range reply triggers send_historical_data, then data is read', async () => {
    const { client, calls } = fakeClient();
    const sched = manualScheduler();
    const runner = new HistoricalSyncRunner(client, { withRange: true, schedule: sched.schedule });
    const promise = runner.run();
    expect(calls).toEqual(['range']);

    const k18 = parseFrameHex('GOOSE', loadHex('synthetic/goose_v5_historical_k18_packet.hex'));
    runner.onFrame(k18); // get_data_range reply → must now send_historical_data (the prior bug skipped this)
    expect(calls).toContain('data');

    runner.onFrame(k18); // actual historical data
    runner.onFrame(k18);
    sched.fireAll();
    const result = await promise;
    expect(result.status).toBe('complete');
    expect(result.counts.readings).toBe(2);
  });

  it('drains paged history: re-requests on a lull until a chunk yields no new readings', async () => {
    const { client, calls } = fakeClient();
    const sched = manualScheduler();
    const runner = new HistoricalSyncRunner(client, {
      quietPeriodMs: 3000,
      ackTimeoutMs: 10000,
      drain: true,
      schedule: sched.schedule,
    });
    const k18 = parseFrameHex('GOOSE', loadHex('synthetic/goose_v5_historical_k18_packet.hex'));

    const promise = runner.run();
    // Chunk 1: two readings. The lull should re-request (continue), not finish.
    runner.onFrame(k18);
    runner.onFrame(k18);
    // Simulate the band answering each re-request with another reading, then drying up.
    let chunksLeft = 2;
    client.sendHistoricalData = () => {
      calls.push('data');
      if (chunksLeft-- > 0) runner.onFrame(k18);
      return Promise.resolve();
    };

    sched.fireAll();
    const result = await promise;

    expect(result.status).toBe('complete');
    // initial data request + several continues (more than one ⇒ it kept draining)
    expect(calls.filter((c) => c === 'data').length).toBeGreaterThan(1);
    expect(result.counts.readings).toBeGreaterThan(2);
  });

  it('fails (does not hang) when the band never sends a frame', async () => {
    const { client, calls } = fakeClient();
    const sched = manualScheduler();
    const runner = new HistoricalSyncRunner(client, {
      firstFrameTimeoutMs: 15000,
      transferTimeoutMs: 120000,
      maxIdleRetries: 1,
      schedule: sched.schedule,
    });
    const promise = runner.run();
    sched.fireAll(); // first-frame timeout → retry → second timeout → fail
    const result = await promise;
    expect(result.status).toBe('failed');
    expect(calls.filter((c) => c === 'data').length).toBe(2); // initial + one retry
  });
});
