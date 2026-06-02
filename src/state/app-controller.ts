/**
 * App-level controller wiring the BLE client to the Zustand stores and durable capture.
 *
 * Owns a single `GooseBleClient`, created lazily (and only off web, where BLE is absent),
 * pipes its events into `useBleStore`, and — once a DB handle is provided — records inbound
 * frames into the store via a `CaptureRecorder` (session on connect, batched persistence,
 * finalize on disconnect). Screens call these actions; they never touch the native client.
 */
import { Platform } from 'react-native';
import { GooseBleClient, type ConnectionState } from '../ble/client';
import { CaptureRecorder } from '../core/capture/recorder';
import type { GooseDatabase } from '../core/store/db';
import { HistoricalSyncRunner } from '../core/sync/runtime';
import { useBleStore } from './ble-store';
import { dateKeyOf, useHealthStore } from './health-store';

const DEVICE_MODEL = 'WHOOP 5.0 Goose';

let client: GooseBleClient | null = null;
let db: GooseDatabase | null = null;
let recorder: CaptureRecorder | null = null;
let activeSync: HistoricalSyncRunner | null = null;

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

/** Send the GET_HELLO handshake to the connected band. */
export async function sendGetHello(): Promise<void> {
  try {
    await getClient().sendGetHello();
  } catch (error) {
    useBleStore.getState().setError(error instanceof Error ? error.message : String(error));
  }
}

/** Start or stop realtime heart-rate streaming from the band. */
export async function toggleRealtimeHr(enable: boolean): Promise<void> {
  try {
    await getClient().sendToggleRealtimeHr(enable);
  } catch (error) {
    useBleStore.getState().setError(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Run a historical/overnight sync: pull the band's buffered data. Inbound frames are routed
 * to the runner (and still recorded), and a summary is written to the store on completion.
 */
export async function runHistoricalSync(): Promise<void> {
  if (!client || activeSync) return;
  const store = useBleStore.getState();
  store.setSyncStatus('syncing', null);
  const runner = new HistoricalSyncRunner(getClient(), { withRange: true });
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
    // Autonomy: once a sync lands new frames, recompute today's metrics and refresh the UI.
    if (result.status === 'complete' && db) {
      await recorder?.flush();
      await useHealthStore.getState().refresh(db, dateKeyOf(new Date()));
    }
  } catch (error) {
    store.setSyncStatus('failed', error instanceof Error ? error.message : String(error));
  } finally {
    activeSync = null;
  }
}
