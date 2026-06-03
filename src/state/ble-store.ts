/**
 * Zustand store mirroring BLE connection state for the UI.
 *
 * Replaces the `@Published` fields of the Swift `GooseBLEClient`. The store is updated by
 * a `GooseBleClient` whose event callbacks call these actions; screens subscribe to slices.
 */
import { create } from 'zustand';
import type { ConnectionState, DiscoveredDevice } from '../ble/client';
import { liveHeartRateFromFrame, type InboundFrame } from '../ble/notifications';

export type SyncStatus = 'idle' | 'syncing' | 'complete' | 'failed';

interface BleState {
  connectionState: ConnectionState;
  discoveredDevices: DiscoveredDevice[];
  liveHeartRate: number | null;
  batteryLevel: number | null;
  lastError: string | null;
  syncStatus: SyncStatus;
  lastSyncSummary: string | null;
  lastSyncedAtMs: number | null;
  monitoring: boolean;

  setConnectionState: (state: ConnectionState) => void;
  setMonitoring: (monitoring: boolean) => void;
  deviceDiscovered: (device: DiscoveredDevice) => void;
  clearDiscoveredDevices: () => void;
  ingestFrame: (frame: InboundFrame) => void;
  setError: (message: string | null) => void;
  setSyncStatus: (status: SyncStatus, summary?: string | null) => void;
  reset: () => void;
}

const initialState = {
  connectionState: 'idle' as ConnectionState,
  discoveredDevices: [] as DiscoveredDevice[],
  liveHeartRate: null as number | null,
  batteryLevel: null as number | null,
  lastError: null as string | null,
  syncStatus: 'idle' as SyncStatus,
  lastSyncSummary: null as string | null,
  lastSyncedAtMs: null as number | null,
  monitoring: false,
};

export const useBleStore = create<BleState>((set) => ({
  ...initialState,

  setConnectionState: (connectionState) => set({ connectionState }),

  setMonitoring: (monitoring) => set({ monitoring }),

  deviceDiscovered: (device) =>
    set((state) =>
      state.discoveredDevices.some((d) => d.id === device.id)
        ? { discoveredDevices: state.discoveredDevices.map((d) => (d.id === device.id ? device : d)) }
        : { discoveredDevices: [...state.discoveredDevices, device] },
    ),

  clearDiscoveredDevices: () => set({ discoveredDevices: [] }),

  // Called for every inbound frame (optical streams at a high rate), so keep this cheap: only
  // touch the store when the live HR actually changes, to avoid a re-render storm while monitoring.
  ingestFrame: (frame) =>
    set((state) => {
      const hr = liveHeartRateFromFrame(frame.frame);
      if (hr === null || hr === state.liveHeartRate) return {};
      return { liveHeartRate: hr };
    }),

  setError: (lastError) => set({ lastError }),

  setSyncStatus: (syncStatus, summary) =>
    set({
      syncStatus,
      ...(summary === undefined ? null : { lastSyncSummary: summary }),
      // Stamp the completion time on terminal states.
      ...(syncStatus === 'complete' || syncStatus === 'failed' ? { lastSyncedAtMs: Date.now() } : null),
    }),

  reset: () => set(initialState),
}));
