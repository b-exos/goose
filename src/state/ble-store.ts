/**
 * Zustand store mirroring BLE connection state for the UI.
 *
 * Replaces the `@Published` fields of the Swift `GooseBLEClient`. The store is updated by
 * a `GooseBleClient` whose event callbacks call these actions; screens subscribe to slices.
 */
import { create } from 'zustand';
import type { ConnectionState, DiscoveredDevice } from '../ble/client';
import { liveHeartRateFromFrame, type InboundFrame } from '../ble/notifications';

/** A compact log entry for an inbound parsed frame (for the debug surface). */
export interface FrameLogEntry {
  seq: number;
  role: string;
  packetType: number | null;
  packetTypeName: string | null;
  payloadKind: string | null;
  payloadHex: string;
}

const MAX_FRAME_LOG = 30;

export type SyncStatus = 'idle' | 'syncing' | 'complete' | 'failed';

interface BleState {
  connectionState: ConnectionState;
  discoveredDevices: DiscoveredDevice[];
  liveHeartRate: number | null;
  batteryLevel: number | null;
  lastError: string | null;
  recentFrames: FrameLogEntry[];
  framesSeen: number;
  syncStatus: SyncStatus;
  lastSyncSummary: string | null;

  setConnectionState: (state: ConnectionState) => void;
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
  recentFrames: [] as FrameLogEntry[],
  framesSeen: 0,
  syncStatus: 'idle' as SyncStatus,
  lastSyncSummary: null as string | null,
};

export const useBleStore = create<BleState>((set) => ({
  ...initialState,

  setConnectionState: (connectionState) => set({ connectionState }),

  deviceDiscovered: (device) =>
    set((state) =>
      state.discoveredDevices.some((d) => d.id === device.id)
        ? { discoveredDevices: state.discoveredDevices.map((d) => (d.id === device.id ? device : d)) }
        : { discoveredDevices: [...state.discoveredDevices, device] },
    ),

  clearDiscoveredDevices: () => set({ discoveredDevices: [] }),

  ingestFrame: (frame) =>
    set((state) => {
      const seq = state.framesSeen + 1;
      const entry: FrameLogEntry = {
        seq,
        role: frame.role,
        packetType: frame.frame.packetType,
        packetTypeName: frame.frame.packetTypeName,
        payloadKind: frame.frame.parsedPayload?.kind ?? null,
        payloadHex: frame.frame.payloadHex.slice(0, 48),
      };
      const hr = liveHeartRateFromFrame(frame.frame);
      return {
        framesSeen: seq,
        recentFrames: [entry, ...state.recentFrames].slice(0, MAX_FRAME_LOG),
        ...(hr !== null ? { liveHeartRate: hr } : null),
      };
    }),

  setError: (lastError) => set({ lastError }),

  setSyncStatus: (syncStatus, summary) =>
    set(summary === undefined ? { syncStatus } : { syncStatus, lastSyncSummary: summary }),

  reset: () => set(initialState),
}));
