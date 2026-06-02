/** Home tab — today's overview: device connection, live heart rate, daily scores, workout. */
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { MetricReadout, SectionCard } from '@/features/components/section-card';
import { ScreenScaffold } from '@/features/components/screen-scaffold';
import { UiButton } from '@/features/components/ui-button';
import { useBleStore } from '@/state/ble-store';
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

      <SectionCard
        title="Workout"
        subtitle={isRecording ? `${formatElapsed(elapsedSeconds)} · ${(distanceMeters / 1000).toFixed(2)} km` : 'Not recording'}>
        <UiButton
          label={isRecording ? 'End workout' : 'Record workout'}
          variant={isRecording ? 'outlined' : 'filled'}
          onPress={isRecording ? stopWorkout : () => startWorkout('Workout')}
        />
      </SectionCard>

      <View style={styles.scoreRow}>
        <SectionCard title="Recovery">
          <MetricReadout value="—" caption="Today" />
        </SectionCard>
        <SectionCard title="Strain">
          <MetricReadout value="—" caption="Today" />
        </SectionCard>
      </View>

      <SectionCard title="Sleep" subtitle="Last night">
        <MetricReadout value="—" caption="Sleep score" />
        <ThemedText type="small">Scores populate once a sync completes.</ThemedText>
      </SectionCard>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  scoreRow: { flexDirection: 'row', gap: Spacing.three },
});
