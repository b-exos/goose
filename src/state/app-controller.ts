/**
 * App-level controller wiring the BLE client to the Zustand stores and durable capture.
 *
 * Owns a single `GooseBleClient`, created lazily (and only off web, where BLE is absent),
 * pipes its events into `useBleStore`, and — once a DB handle is provided — records inbound
 * frames into the store via a `CaptureRecorder` (session on connect, batched persistence,
 * finalize on disconnect). Screens call these actions; they never touch the native client.
 */
import { InteractionManager, Platform } from 'react-native';
import { GooseBleClient, type ConnectionState } from '../ble/client';
import { CaptureRecorder } from '../core/capture/recorder';
import { ppgWaveformDiagnostics, recoveryDiagnostics } from '../core/pipeline/diagnostics';
import type { GooseDatabase } from '../core/store/db';
import { HistoricalSyncRunner } from '../core/sync/runtime';
import { useBleStore } from './ble-store';
import { dateKeyOf, dayWindowIso, useHealthStore } from './health-store';

const DEVICE_MODEL = 'WHOOP 5.0 Goose';

let client: GooseBleClient | null = null;
let db: GooseDatabase | null = null;
let recorder: CaptureRecorder | null = null;
let activeSync: HistoricalSyncRunner | null = null;
let lastSyncFrameMs = 0;
let monitorTimer: ReturnType<typeof setInterval> | null = null;
let rollupRunning = false;

/** How often monitor mode rolls up the captured stream into today's metrics. The rollup scans
 * the day's captured frames (heavy), so keep it infrequent and defer it past user interactions. */
const MONITOR_ROLLUP_MS = 120_000;

/** Verbose per-frame / per-tick console diagnostics (BLE + PPG reverse-engineering). Off by
 * default; flip to true to stream `[goose:*]` debug lines to Metro during development. */
const VERBOSE_LOGS = false;

/** Always-on log of the band's control replies (command responses + events) with full hex —
 * the raw material for understanding the auth/handshake the band expects. Low volume. */
function logControlFrame(frame: { packetType: number | null; packetTypeName: string | null; payloadHex: string; commandOrEvent?: number | null }): void {
  if (!VERBOSE_LOGS) return;
  if (frame.packetType === 36 || frame.packetType === 48 || frame.packetType === 49) {
    console.log(
      `[goose:resp] ${frame.packetTypeName ?? frame.packetType} cmd/evt=${frame.commandOrEvent ?? '?'} hex=${frame.payloadHex}`,
    );
  }
}

/** Log each inbound frame during a sync with its family + inter-frame gap, to find where the
 * transfer stalls (premature quiet-period cutoff vs. a real end) and spot any end markers. */
function logSyncFrame(frame: { packetType: number | null; packetTypeName: string | null; payloadHex: string; parsedPayload: { kind: string; packetK?: number | null } | null }): void {
  if (!VERBOSE_LOGS) return;
  const now = Date.now();
  const gap = lastSyncFrameMs ? now - lastSyncFrameMs : 0;
  lastSyncFrameMs = now;
  const k = frame.parsedPayload && 'packetK' in frame.parsedPayload ? frame.parsedPayload.packetK : null;
  const fam = frame.parsedPayload?.kind === 'data_packet' ? `k${k}` : frame.parsedPayload?.kind ?? 'raw';
  // EVENT(48)/METADATA(49) may carry the real HistoryEnd marker — log their full payload.
  const isMeta = frame.packetType === 48 || frame.packetType === 49;
  console.log(
    `[goose:frame] ${fam} type=${frame.packetTypeName ?? frame.packetType} gap=${gap}ms` +
      (isMeta ? ` hex=${frame.payloadHex}` : ''),
  );
}

/** Provide the app database so connections persist captured frames (call once at startup). */
export function setDatabase(database: GooseDatabase): void {
  db = database;
}

function handleStateChange(state: ConnectionState): void {
  useBleStore.getState().setConnectionState(state);
  if (state === 'connected' && db && !recorder) {
    recorder = new CaptureRecorder(db, `sess-${Date.now()}`, DEVICE_MODEL);
    void recorder.start();
  } else if ((state === 'disconnected' || state === 'idle') && recorder) {
    if (monitorTimer) {
      clearInterval(monitorTimer);
      monitorTimer = null;
      useBleStore.getState().setMonitoring(false);
    }
    const finishing = recorder;
    recorder = null;
    void finishing.finish();
  }
}

function getClient(): GooseBleClient {
  if (client) return client;
  if (Platform.OS === 'web') {
    throw new Error('Bluetooth is not available on web');
  }
  const store = useBleStore.getState();
  client = new GooseBleClient({
    onStateChange: handleStateChange,
    onDeviceDiscovered: store.deviceDiscovered,
    onFrame: (frame) => {
      store.ingestFrame(frame);
      recorder?.record(frame.raw);
      logControlFrame(frame.frame);
      if (activeSync) logSyncFrame(frame.frame);
      activeSync?.onFrame(frame.frame);
    },
    onError: store.setError,
  });
  return client;
}

/** Begin scanning for WHOOP bands (clears the prior discovery list). */
export function startScan(): void {
  useBleStore.getState().clearDiscoveredDevices();
  try {
    getClient().startScan();
  } catch (error) {
    useBleStore.getState().setError(error instanceof Error ? error.message : String(error));
  }
}

export function stopScan(): void {
  client?.stopScan();
}

/** Connect to a discovered device by id. */
export async function connectToDevice(deviceId: string): Promise<void> {
  try {
    await getClient().connect(deviceId);
  } catch (error) {
    useBleStore.getState().setError(error instanceof Error ? error.message : String(error));
  }
}

export async function disconnect(): Promise<void> {
  await client?.disconnect();
}

/**
 * Run a historical/overnight sync: pull the band's buffered data. Inbound frames are routed
 * to the runner (and still recorded), and a summary is written to the store on completion.
 */
export async function runHistoricalSync(): Promise<void> {
  if (!client || activeSync) return;
  const store = useBleStore.getState();
  store.setSyncStatus('syncing', null);
  // Ask the band to include buffered motion (IMU) + optical (R17 → RR/HRV) families so the
  // sync can drive sleep and recovery, not just HR. Best-effort; a band that ignores these
  // simply streams what it has.
  try {
    await getClient().sendEnterHighFreqSync();
    await getClient().sendToggleImuModeHistorical(true);
    await getClient().sendEnableOptical(true);
  } catch {
    // non-fatal — proceed with whatever the band streams
  }
  if (VERBOSE_LOGS) console.log('[goose:sync] starting (optical+IMU enabled)');
  lastSyncFrameMs = 0;
  // Drain paged history: the band sends a chunk (~30 readings) then waits, pinging metadata,
  // for the next request. Re-request on each lull until the buffer is empty.
  const runner = new HistoricalSyncRunner(getClient(), {
    withRange: true,
    quietPeriodMs: 4000,
    drain: true,
    transferTimeoutMs: 600000,
  });
  activeSync = runner;
  try {
    const result = await runner.run();
    const summary =
      result.status === 'complete'
        ? `${result.counts.readings} readings (${Object.entries(result.counts.byFamily)
            .map(([k, n]) => `${k}:${n}`)
            .join(', ')})`
        : `failed: ${result.failureReason ?? 'unknown'}`;
    store.setSyncStatus(result.status, summary);
    if (VERBOSE_LOGS) console.log(`[goose:sync] ${result.status} — ${summary}`);
    // Autonomy: once a sync lands new frames, recompute today's metrics and refresh the UI.
    if (result.status === 'complete' && db) {
      await recorder?.flush();
      const dateKey = dateKeyOf(new Date());
      await useHealthStore.getState().refresh(db, dateKey);
      await logRecoveryDiagnostics(dateKey);
    }
  } catch (error) {
    store.setSyncStatus('failed', error instanceof Error ? error.message : String(error));
    if (VERBOSE_LOGS) console.log('[goose:sync] error', error instanceof Error ? error.message : String(error));
  } finally {
    try {
      await client?.sendExitHighFreqSync();
    } catch {
      // best-effort
    }
    activeSync = null;
  }
}

/**
 * Continuous capture mode (the WHOOP-replacement path): keep a persistent connection streaming
 * realtime HR + IMU (motion) + optical (RR), persist every frame, and roll up today's metrics on
 * a timer so the UI updates live. Logs the family breakdown each tick so we can see which sensor
 * streams the band actually honors.
 */
export async function startMonitor(): Promise<void> {
  if (!client || useBleStore.getState().connectionState !== 'connected') {
    useBleStore.getState().setError('Connect a band before starting monitor mode.');
    return;
  }
  if (monitorTimer) return;
  try {
    // The WHOOP-app physiology-capture sequence (correct command set + [1,1] payloads + spacing)
    // is what actually streams motion/optical/pulse, not just HR.
    await getClient().startPhysiologyCapture();
  } catch (error) {
    console.log('[goose:monitor] enable error', error instanceof Error ? error.message : String(error));
  }
  useBleStore.getState().setMonitoring(true);
  // The rollup is JS-heavy (scans the day's frames). Defer it until interactions (scrolling/taps)
  // settle so it never blocks a gesture, and never overlap two rollups.
  const tick = () => {
    if (!db || rollupRunning) return;
    InteractionManager.runAfterInteractions(async () => {
      if (!db || rollupRunning) return;
      rollupRunning = true;
      try {
        await recorder?.flush();
        await useHealthStore.getState().refresh(db, dateKeyOf(new Date()));
        if (VERBOSE_LOGS) await logRecoveryDiagnostics(dateKeyOf(new Date()));
      } catch (error) {
        if (VERBOSE_LOGS) console.log('[goose:monitor] tick error', error instanceof Error ? error.message : String(error));
      } finally {
        rollupRunning = false;
      }
    });
  };
  tick();
  monitorTimer = setInterval(tick, MONITOR_ROLLUP_MS);
}

/** Stop continuous capture: cancel the rollup timer and turn the streams back off. */
export async function stopMonitor(): Promise<void> {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
  useBleStore.getState().setMonitoring(false);
  try {
    await client?.stopPhysiologyCapture();
  } catch {
    // best-effort
  }
}

/** Stream the recovery (RR/HRV) breakdown for a day to the Metro console for live debugging. */
export async function logRecoveryDiagnostics(dateKey: string): Promise<void> {
  if (!db || !VERBOSE_LOGS) return;
  const { startIso, endIso } = dayWindowIso(dateKey);
  const d = await recoveryDiagnostics(db, startIso, endIso);
  console.log(
    `[goose:recovery] frames=${d.totalFrames} R17=${d.r17FrameCount} RR-in-range=${d.rrIntervalsInRange}`,
  );
  console.log('[goose:recovery] families', JSON.stringify(d.byFamily));
  console.log(
    `[goose:hr] count=${d.hrStats.count} min=${d.hrStats.min} max=${d.hrStats.max} mean=${d.hrStats.mean.toFixed(1)} maxByFamily=${JSON.stringify(d.hrMaxByFamily)}`,
  );
  console.log('[goose:recovery] R17 samples', JSON.stringify(d.r17SamplePreview));
  // Sample payloads for the families we still need to decode (raw optical PPG + pulse/motion).
  for (const fam of ['raw_or_research_counted', 'raw_stream_counted', 'pulse_information_packet', 'raw_motion_stream_result']) {
    if (d.examplePayloads[fam]) console.log(`[goose:ppg] ${fam} example=${d.examplePayloads[fam]}`);
  }
  const w = await ppgWaveformDiagnostics(db, startIso, endIso);
  const bandHr = useBleStore.getState().liveHeartRate;
  console.log(
    `[goose:ppg-wave] k20frames=${w.k20FrameCount} channels=${w.channelCount} samples/ch=${w.totalSamplesPerChannel} rate=${w.sampleRateHz?.toFixed(1) ?? '?'}Hz bestCh=${w.bestChannel}`,
  );
  console.log(`[goose:ppg-validate] PPG-derived HR=${w.derivedHrBpm ?? '?'} bpm  vs  band HR=${bandHr ?? '?'} bpm  (rr=${w.rrCount})`);
}
