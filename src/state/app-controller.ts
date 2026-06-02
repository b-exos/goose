/**
 * App-level controller wiring the BLE client to the Zustand stores.
 *
 * Owns a single `GooseBleClient`, created lazily (and only off web, where BLE is absent),
 * and pipes its events into `useBleStore`. Screens call these actions; they never touch the
 * native client directly. This is the composition point where, in a later pass, inbound
 * frames also flow to `importCapturedFrameBatch` with an open DB handle.
 */
import { Platform } from 'react-native';
import { GooseBleClient } from '../ble/client';
import { useBleStore } from './ble-store';

let client: GooseBleClient | null = null;

function getClient(): GooseBleClient {
  if (client) return client;
  if (Platform.OS === 'web') {
    throw new Error('Bluetooth is not available on web');
  }
  const store = useBleStore.getState();
  client = new GooseBleClient({
    onStateChange: store.setConnectionState,
    onDeviceDiscovered: store.deviceDiscovered,
    onFrame: store.ingestFrame,
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
