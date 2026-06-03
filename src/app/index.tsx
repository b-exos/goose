/** Home tab — today's overview: device, live HR, daily scores (rings), and workout. */
import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { recoveryColor, sleepColor, strainColor } from '@/features/charts/colors';
import { ScoreRing } from '@/features/charts/score-ring';
import { MetricReadout, SectionCard } from '@/features/components/section-card';
import { ScreenScaffold } from '@/features/components/screen-scaffold';
import { UiButton } from '@/features/components/ui-button';
import { useBleStore } from '@/state/ble-store';
import { useDatabase } from '@/state/db-provider';
import { dateKeyOf, useHealthStore } from '@/state/health-store';
import { useWorkoutStore } from '@/state/workout-store';

const CONNECTION_LABEL: Record<string, string> = {
  idle: 'Not connected',
  scanning: 'Scanning…',
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Disconnected',
};

function formatElapsed(seconds: number): string {
  const m = `${Math.floor(seconds / 60)}`.padStart(2, '0');
  const s = `${seconds % 60}`.padStart(2, '0');
  return `${m}:${s}`;
}

export default function HomeScreen() {
  const connectionState = useBleStore((s) => s.connectionState);
  const liveHeartRate = useBleStore((s) => s.liveHeartRate);
  const isRecording = useWorkoutStore((s) => s.isRecording);
  const elapsedSeconds = useWorkoutStore((s) => s.elapsedSeconds);
  const distanceMeters = useWorkoutStore((s) => s.distanceMeters);
  const startWorkout = useWorkoutStore((s) => s.start);
  const stopWorkout = useWorkoutStore((s) => s.stop);

  const { db, ready } = useDatabase();
  const today = useHealthStore((s) => s.today);
  const loadMetrics = useHealthStore((s) => s.load);

  // Re-load on every focus so the day's metrics stay current (e.g. across the midnight rollover,
  // and after a sync/monitor recompute) rather than showing a stale snapshot from mount time.
  useFocusEffect(
    useCallback(() => {
      if (ready && db) void loadMetrics(db, dateKeyOf(new Date()));
    }, [ready, db, loadMetrics]),
  );

  const sleepScore = today?.sleepScore0To100 ?? null;
  const strainScore = today?.strainScore0To21 ?? null;
  const recoveryScore = today?.recoveryScore0To100 ?? null;
  const recoveryStatus = today?.recoveryStatus ?? 'unavailable';
  const hrvRmssd = today?.hrvRmssdMs ?? null;
  const recoveryDisplay = recoveryStatus === 'calibrating' ? 'cal' : recoveryStatus === 'available' ? undefined : 'n/a';

  return (
    <ScreenScaffold title="Today">
      <SectionCard title="Band" subtitle={CONNECTION_LABEL[connectionState] ?? connectionState}>
        <MetricReadout
          value={liveHeartRate != null ? `${liveHeartRate}` : '—'}
          caption="Live heart rate (bpm)"
        />
        {connectionState !== 'connected' ? (
          <ThemedText type="small">Connect your WHOOP 5.0 in the More tab to start syncing.</ThemedText>
        ) : null}
      </SectionCard>

      <View style={styles.ringRow}>
        {/* Recovery shows once RR intervals (optical R17) were decoded for the day. */}
        <ScoreRing
          value={recoveryScore}
          max={100}
          label="Recovery"
          color={recoveryColor(recoveryScore)}
          display={recoveryDisplay}
        />
        <ScoreRing value={sleepScore} max={100} label="Sleep" color={sleepColor(sleepScore)} />
        <ScoreRing value={strainScore} max={21} label="Strain" color={strainColor(strainScore)} />
      </View>

      <SectionCard title="Recovery vitals">
        <MetricReadout
          value={today?.restingHrBpm != null ? `${Math.round(today.restingHrBpm)}` : '—'}
          caption="Resting heart rate (bpm)"
        />
        <MetricReadout
          value={hrvRmssd != null ? `${Math.round(hrvRmssd)}` : '—'}
          caption="HRV (ms RMSSD)"
        />
        <ThemedText type="small" themeColor="textSecondary">
          {recoveryStatus === 'available'
            ? 'Recovery is HRV/RHR-driven vs your baseline; respiratory rate & skin temp use neutral placeholders until decoded.'
            : recoveryStatus === 'calibrating'
              ? 'Recovery is calibrating — HRV is recording, but it needs several nights of baseline (worn overnight) before the score is meaningful.'
              : 'Recovery needs optical RR — wear the band and Start monitor to record HRV.'}
        </ThemedText>
      </SectionCard>

      <SectionCard
        title="Workout"
        subtitle={isRecording ? `${formatElapsed(elapsedSeconds)} · ${(distanceMeters / 1000).toFixed(2)} km` : 'Not recording'}>
        <UiButton
          label={isRecording ? 'End workout' : 'Record workout'}
          variant={isRecording ? 'outlined' : 'filled'}
          onPress={isRecording ? stopWorkout : () => startWorkout('Workout')}
        />
      </SectionCard>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  ringRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
});
