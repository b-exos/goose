/**
 * Workout Live Activity (iOS) built with expo-widgets + Expo UI (SwiftUI).
 *
 * Replaces the Swift `GooseWorkoutLiveActivityWidget`. The `'widget'` directive marks this
 * function for extraction into the widget extension at build time; it renders lock-screen,
 * Dynamic Island (compact/minimal/expanded), and banner presentations from live workout
 * props. Control (start/update/end) lives in `features/workout/live-activity-controller.ts`.
 */
import { HStack, Image, Text, VStack } from '@expo/ui/swift-ui';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';

/** Live workout state pushed into the activity. */
export interface WorkoutActivityProps {
  activityName: string;
  status: string;
  elapsedSeconds: number;
  currentHeartRate: number | null;
  activeCalories: number | null;
  distanceMeters: number | null;
  isPaused: boolean;
}

function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = `${m}`.padStart(2, '0');
  const ss = `${s}`.padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function hr(props: WorkoutActivityProps): string {
  return props.currentHeartRate != null ? `${props.currentHeartRate} bpm` : '— bpm';
}

function distanceKm(props: WorkoutActivityProps): string {
  return props.distanceMeters != null ? `${(props.distanceMeters / 1000).toFixed(2)} km` : '—';
}

function calories(props: WorkoutActivityProps): string {
  return props.activeCalories != null ? `${Math.round(props.activeCalories)} kcal` : '—';
}

const WorkoutActivity = (props: WorkoutActivityProps, environment: LiveActivityEnvironment) => {
  'widget';
  const accent = environment.colorScheme === 'dark' ? '#FF375F' : '#FF2D55';
  const icon = props.isPaused ? 'pause.circle.fill' : 'figure.run';

  return {
    banner: (
      <HStack>
        <Image systemName={icon} color={accent} />
        <Text>{props.activityName}</Text>
        <Text>{formatElapsed(props.elapsedSeconds)}</Text>
      </HStack>
    ),
    compactLeading: <Image systemName={icon} color={accent} />,
    compactTrailing: <Text>{formatElapsed(props.elapsedSeconds)}</Text>,
    minimal: <Image systemName={icon} color={accent} />,
    expandedLeading: (
      <VStack>
        <Text>{props.activityName}</Text>
        <Text>{props.status}</Text>
      </VStack>
    ),
    expandedTrailing: (
      <VStack>
        <Text>{hr(props)}</Text>
        <Text>{formatElapsed(props.elapsedSeconds)}</Text>
      </VStack>
    ),
    expandedBottom: (
      <HStack>
        <Text>{calories(props)}</Text>
        <Text>{distanceKm(props)}</Text>
      </HStack>
    ),
  };
};

export default createLiveActivity('WorkoutActivity', WorkoutActivity);
