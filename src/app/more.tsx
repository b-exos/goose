/** More tab — device connection, settings, and diagnostics. Drives the BLE client. */
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { ScreenScaffold } from '@/features/components/screen-scaffold';
import { SectionCard } from '@/features/components/section-card';
import { UiButton } from '@/features/components/ui-button';
import {
  connectToDevice,
  disconnect,
  sendGetHello,
  startScan,
  stopScan,
} from '@/state/app-controller';
import { useBleStore } from '@/state/ble-store';

export default function MoreScreen() {
  const connectionState = useBleStore((s) => s.connectionState);
  const devices = useBleStore((s) => s.discoveredDevices);
  const lastError = useBleStore((s) => s.lastError);
  const isConnected = connectionState === 'connected';
  const isScanning = connectionState === 'scanning';

  const primaryLabel = isConnected ? 'Disconnect' : isScanning ? 'Stop scan' : 'Scan for WHOOP';
  const onPrimary = isConnected ? disconnect : isScanning ? stopScan : startScan;

  return (
    <ScreenScaffold title="More">
      <SectionCard title="Device" subtitle={`Status: ${connectionState}`}>
        <UiButton label={primaryLabel} onPress={onPrimary} />
        {isConnected ? (
          <UiButton label="Send GET_HELLO" variant="outlined" onPress={sendGetHello} />
        ) : null}
        {devices.length === 0 ? (
          <ThemedText type="small">No bands found yet.</ThemedText>
        ) : (
          devices.map((device) => (
            <Pressable key={device.id} onPress={() => connectToDevice(device.id)}>
              <ThemedView type="backgroundSelected" style={styles.deviceRow}>
                <ThemedText type="smallBold">{device.name ?? 'WHOOP band'}</ThemedText>
                <ThemedText type="small">
                  {device.id}
                  {device.rssi != null ? ` · ${device.rssi} dBm` : ''}
                </ThemedText>
              </ThemedView>
            </Pressable>
          ))
        )}
        {lastError ? <ThemedText type="small">Error: {lastError}</ThemedText> : null}
      </SectionCard>

      <SectionCard title="Settings">
        <ThemedText type="small">Algorithm preferences and profile (coming next).</ThemedText>
      </SectionCard>

      <SectionCard title="About">
        <ThemedText type="small">Goose · local-first WHOOP companion · Expo SDK 56</ThemedText>
      </SectionCard>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  deviceRow: { gap: Spacing.half, padding: Spacing.two, borderRadius: Spacing.two },
});
