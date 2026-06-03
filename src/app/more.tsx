/** More tab — device connection, capture controls, and settings. Drives the BLE client. */
import { useState } from 'react';
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
  startMonitor,
  startScan,
  stopMonitor,
  stopScan,
} from '@/state/app-controller';
import { useBleStore } from '@/state/ble-store';
import { useDatabase } from '@/state/db-provider';
import { dateKeyOf, useHealthStore } from '@/state/health-store';

export default function MoreScreen() {
  const connectionState = useBleStore((s) => s.connectionState);
  const devices = useBleStore((s) => s.discoveredDevices);
  const lastError = useBleStore((s) => s.lastError);
  const liveHeartRate = useBleStore((s) => s.liveHeartRate);
  const syncStatus = useBleStore((s) => s.syncStatus);
  const lastSyncSummary = useBleStore((s) => s.lastSyncSummary);
  const lastSyncedAtMs = useBleStore((s) => s.lastSyncedAtMs);
  const monitoring = useBleStore((s) => s.monitoring);
  const { db } = useDatabase();
  const healthLoading = useHealthStore((s) => s.loading);
  const today = useHealthStore((s) => s.today);
  const healthDebug = useHealthStore((s) => s.debug);
  const refreshMetrics = useHealthStore((s) => s.refresh);
  const isConnected = connectionState === 'connected';
  const isScanning = connectionState === 'scanning';

  const [recomputedAt, setRecomputedAt] = useState<string | null>(null);
  const [recomputeError, setRecomputeError] = useState<string | null>(null);

  const recompute = async () => {
    if (!db) {
      setRecomputeError('No database (still starting up?)');
      return;
    }
    setRecomputeError(null);
    try {
      await refreshMetrics(db, dateKeyOf(new Date()));
      setRecomputedAt(new Date().toLocaleTimeString());
    } catch (error) {
      setRecomputeError(error instanceof Error ? error.message : String(error));
    }
  };

  const primaryLabel = isConnected ? 'Disconnect' : isScanning ? 'Stop scan' : 'Scan for WHOOP';
  const onPrimary = isConnected ? disconnect : isScanning ? stopScan : startScan;

  return (
    <ScreenScaffold title="More">
      <SectionCard title="Device" subtitle={`Status: ${connectionState}`}>
        <UiButton label={primaryLabel} onPress={onPrimary} />
        {isConnected ? (
          <>
            <UiButton
              label={monitoring ? 'Stop monitoring' : 'Start monitoring'}
              variant={monitoring ? 'outlined' : 'filled'}
              onPress={monitoring ? stopMonitor : startMonitor}
            />
            <ThemedText type="small" themeColor="textSecondary">
              {monitoring
                ? `Recording HR + motion + optical${liveHeartRate != null ? ` · ${liveHeartRate} bpm` : ''}. Wear it overnight for sleep + recovery.`
                : 'Start monitoring to record heart rate, motion, and optical (HRV) while worn.'}
            </ThemedText>
            <UiButton
              label={syncStatus === 'syncing' ? 'Syncing…' : 'Sync history'}
              variant="outlined"
              onPress={runHistoricalSync}
            />
            <ThemedText type="small" themeColor="textSecondary">
              {lastSyncedAtMs ? `Last synced ${new Date(lastSyncedAtMs).toLocaleString()}` : 'Never synced'}
            </ThemedText>
            {lastSyncSummary ? (
              <ThemedText type="small">Last sync ({syncStatus}): {lastSyncSummary}</ThemedText>
            ) : null}
          </>
        ) : null}
        {!isConnected && devices.length === 0 ? (
          <ThemedText type="small">No bands found yet. Tap “Scan for WHOOP”.</ThemedText>
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

      <SectionCard title="Metrics" subtitle={healthLoading ? 'Computing…' : "Today's metrics"}>
        <UiButton
          label={healthLoading ? 'Computing…' : 'Recompute today'}
          variant="outlined"
          onPress={recompute}
        />
        <ThemedText type="small">
          Sleep {today?.sleepScore0To100 != null ? Math.round(today.sleepScore0To100) : '—'} ·
          {' '}Strain {today?.strainScore0To21 != null ? today.strainScore0To21.toFixed(1) : '—'} ·
          {' '}Resting HR {today?.restingHrBpm != null ? Math.round(today.restingHrBpm) : '—'} ·
          {' '}Recovery {today?.recoveryStatus === 'available'
            ? Math.round(today.recoveryScore0To100 ?? 0)
            : today?.recoveryStatus === 'calibrating'
              ? 'calibrating'
              : '—'}
        </ThemedText>
        {recomputedAt ? (
          <ThemedText type="small" themeColor="textSecondary">
            Updated {recomputedAt} · {healthDebug?.hrSamples ?? 0} HR / {healthDebug?.motionSamples ?? 0} motion samples today
          </ThemedText>
        ) : null}
        {recomputeError ? <ThemedText type="small">Recompute error: {recomputeError}</ThemedText> : null}
      </SectionCard>

      <SectionCard title="Settings">
        <ThemedText type="small">Algorithm preferences and profile (coming soon).</ThemedText>
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
