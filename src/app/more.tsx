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
  runHistoricalSync,
  sendGetHello,
  startScan,
  stopScan,
  toggleRealtimeHr,
} from '@/state/app-controller';
import { useBleStore } from '@/state/ble-store';

export default function MoreScreen() {
  const connectionState = useBleStore((s) => s.connectionState);
  const devices = useBleStore((s) => s.discoveredDevices);
  const lastError = useBleStore((s) => s.lastError);
  const recentFrames = useBleStore((s) => s.recentFrames);
  const framesSeen = useBleStore((s) => s.framesSeen);
  const syncStatus = useBleStore((s) => s.syncStatus);
  const lastSyncSummary = useBleStore((s) => s.lastSyncSummary);
  const isConnected = connectionState === 'connected';
  const isScanning = connectionState === 'scanning';

  const primaryLabel = isConnected ? 'Disconnect' : isScanning ? 'Stop scan' : 'Scan for WHOOP';
  const onPrimary = isConnected ? disconnect : isScanning ? stopScan : startScan;

  return (
    <ScreenScaffold title="More">
      <SectionCard title="Device" subtitle={`Status: ${connectionState}`}>
        <UiButton label={primaryLabel} onPress={onPrimary} />
        {isConnected ? (
          <>
            <UiButton label="Send GET_HELLO" variant="outlined" onPress={sendGetHello} />
            <UiButton label="Start live HR" variant="outlined" onPress={() => toggleRealtimeHr(true)} />
            <UiButton label="Stop live HR" variant="text" onPress={() => toggleRealtimeHr(false)} />
            <UiButton
              label={syncStatus === 'syncing' ? 'Syncing history…' : 'Sync history'}
              onPress={runHistoricalSync}
            />
            {lastSyncSummary ? (
              <ThemedText type="small">Last sync ({syncStatus}): {lastSyncSummary}</ThemedText>
            ) : null}
          </>
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

      <SectionCard title="Debug · inbound frames" subtitle={`${framesSeen} frame(s) received`}>
        {recentFrames.length === 0 ? (
          <ThemedText type="small">
            Parsed BLE frames will appear here. Connect, then tap Send GET_HELLO or Start live HR.
          </ThemedText>
        ) : (
          recentFrames.map((f) => (
            <ThemedView key={f.seq} type="backgroundSelected" style={styles.frameRow}>
              <ThemedText type="smallBold">
                #{f.seq} · {f.packetTypeName ?? `type ${f.packetType ?? '?'}`} · {f.payloadKind ?? '—'}
              </ThemedText>
              <ThemedText type="small">
                {f.role} · {f.payloadHex || '(empty)'}
              </ThemedText>
            </ThemedView>
          ))
        )}
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
  frameRow: { gap: Spacing.half, padding: Spacing.two, borderRadius: Spacing.two },
});
