/**
 * Cross-platform workout "live status" controller.
 *
 * iOS: drives the expo-widgets Live Activity (`WorkoutActivity`). Android (which has no Live
 * Activities): shows/updates an ongoing foreground notification via expo-notifications.
 * Replaces the Swift `WorkoutLiveActivityController`.
 */
import { Platform } from 'react-native';
import WorkoutActivity, { type WorkoutActivityProps } from '../../widgets/workout-activity';

type ActivityInstance = ReturnType<typeof WorkoutActivity.start>;

let iosInstance: ActivityInstance | null = null;
let androidNotificationId: string | null = null;

function androidBody(props: WorkoutActivityProps): string {
  const parts = [props.status];
  if (props.currentHeartRate != null) parts.push(`${props.currentHeartRate} bpm`);
  if (props.distanceMeters != null) parts.push(`${(props.distanceMeters / 1000).toFixed(2)} km`);
  return parts.join(' · ');
}

async function presentAndroidOngoing(props: WorkoutActivityProps): Promise<void> {
  const Notifications = await import('expo-notifications');
  androidNotificationId = await Notifications.scheduleNotificationAsync({
    identifier: androidNotificationId ?? undefined,
    content: { title: props.activityName, body: androidBody(props), sticky: true, autoDismiss: false },
    trigger: null,
  });
}

/** Begin a workout live status. Safe to call on any platform. */
export async function startWorkout(props: WorkoutActivityProps): Promise<void> {
  if (Platform.OS === 'ios') {
    iosInstance = WorkoutActivity.start(props, 'goose://workout/active');
  } else if (Platform.OS === 'android') {
    await presentAndroidOngoing(props);
  }
}

/** Update the live status with the latest workout state. */
export async function updateWorkout(props: WorkoutActivityProps): Promise<void> {
  if (Platform.OS === 'ios') {
    iosInstance?.update(props);
  } else if (Platform.OS === 'android' && androidNotificationId) {
    await presentAndroidOngoing(props);
  }
}

/** End the workout live status, with a final snapshot. */
export async function endWorkout(finalProps: WorkoutActivityProps): Promise<void> {
  if (Platform.OS === 'ios') {
    await iosInstance?.end('default', finalProps);
    iosInstance = null;
  } else if (Platform.OS === 'android' && androidNotificationId) {
    const Notifications = await import('expo-notifications');
    await Notifications.dismissNotificationAsync(androidNotificationId);
    androidNotificationId = null;
  }
}
