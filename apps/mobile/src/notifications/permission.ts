import { PermissionsAndroid, Platform } from 'react-native';
import type { NotificationPermission } from '../store/settings';

/**
 * Asks the system for the notification permission (Android 13+; older Android grants it on install).
 * The answer is final for the screen that asked: "denied" is shown as the "notifications off" banner
 * with a link to the system settings (Phase 4 wires that link). iOS asks through expo-notifications,
 * which arrives with the rest of notifications in Phase 4 **[MAC]**; until then it reports undetermined.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (Platform.OS !== 'android') return 'undetermined';
  if (Number(Platform.Version) < 33) return 'granted';
  const result = await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS');
  return result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
}
