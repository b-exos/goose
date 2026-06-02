/**
 * Notification setup helpers (permissions + foreground behavior).
 *
 * The Android workout fallback (ongoing notification) and any sync alerts route through
 * expo-notifications; this centralizes permission requests and the foreground handler.
 * Imported lazily so non-native/test paths never load the native module.
 */
import { Platform } from 'react-native';

/** Request notification permission. Returns true when granted (always true on web/no-op). */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const Notifications = await import('expo-notifications');
  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted) return true;
  const request = await Notifications.requestPermissionsAsync();
  return request.granted;
}

/** Show foreground notifications as banners (call once at app start). */
export async function configureForegroundNotifications(): Promise<void> {
  if (Platform.OS === 'web') return;
  const Notifications = await import('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}
