/** Tests for the BLE Zustand store reducers. */
import { decodeHexWithWhitespace } from '../core/protocol';
import { loadHex } from '../core/testing/fixtures';
import { NotificationRouter } from '../ble/notifications';
import { useBleStore } from './ble-store';

describe('ble-store', () => {
  beforeEach(() => useBleStore.getState().reset());

  it('tracks connection state', () => {
    useBleStore.getState().setConnectionState('connecting');
    expect(useBleStore.getState().connectionState).toBe('connecting');
  });

  it('dedupes discovered devices by id and updates rssi', () => {
    const { deviceDiscovered } = useBleStore.getState();
    deviceDiscovered({ id: 'a', name: 'WHOOP', rssi: -60 });
    deviceDiscovered({ id: 'a', name: 'WHOOP', rssi: -55 });
    deviceDiscovered({ id: 'b', name: 'WHOOP 2', rssi: -70 });
    const devices = useBleStore.getState().discoveredDevices;
    expect(devices).toHaveLength(2);
    expect(devices.find((d) => d.id === 'a')?.rssi).toBe(-55);
  });

  it('updates live heart rate from an ingested K10 frame', () => {
    const k10 = decodeHexWithWhitespace(loadHex('synthetic/goose_v5_k10_motion_summary_short.hex'));
    const [frame] = new NotificationRouter('GOOSE').ingest('data_from_strap', k10);
    useBleStore.getState().ingestFrame(frame);
    expect(useBleStore.getState().liveHeartRate).toBe(72);
  });

  it('ignores frames without heart rate', () => {
    const hello = decodeHexWithWhitespace(loadHex('synthetic/goose_v5_get_hello_frame.hex'));
    const [frame] = new NotificationRouter('GOOSE').ingest('command_from_strap', hello);
    useBleStore.getState().ingestFrame(frame);
    expect(useBleStore.getState().liveHeartRate).toBeNull();
  });
});
