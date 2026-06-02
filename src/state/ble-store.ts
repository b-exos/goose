/**
 * Zustand store mirroring BLE connection state for the UI.
 *
 * Replaces the `@Published` fields of the Swift `GooseBLEClient`. The store is updated by
 * a `GooseBleClient` whose event callbacks call these actions; screens subscribe to slices.
 */
import { create } from 'zustand';
import type { ConnectionState, DiscoveredDevice } from '../ble/client';
import { liveHeartRateFromFrame, type InboundFrame } from '../ble/notifications';

interface BleState {
  connectionState: ConnectionState;
  discoveredDevices: DiscoveredDevice[];
  liveHeartRate: number | null;
  batteryLevel: number | null;
  lastError: string | null;

  setConnectionState: (state: ConnectionState) => void;
  deviceDiscovered: (device: DiscoveredDevice) => void;
  clearDiscoveredDevices: () => void;
  ingestFrame: (frame: InboundFrame) => void;
  setError: (message: string | null) => void;
  reset: () => void;
}

const initialState = {
  connectionState: 'idle' as ConnectionState,
  discoveredDevices: [] as DiscoveredDevice[],
  liveHeartRate: null as number | null,
  batteryLevel: null as number | null,
  lastError: null as string | null,
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

  ingestFrame: (frame) => {
    const hr = liveHeartRateFromFrame(frame.frame);
    if (hr !== null) set({ liveHeartRate: hr });
  },

  setError: (lastError) => set({ lastError }),

  reset: () => set(initialState),
}));
