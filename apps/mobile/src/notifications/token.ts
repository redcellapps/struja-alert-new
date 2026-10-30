import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/** The EAS project id from the app config, or null when the app was built without one. */
export function easProjectId(): string | null {
  const fromConfig = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  return fromConfig ?? Constants.easConfig?.projectId ?? null;
}

/**
 * The device's own FCM registration token (Android), for the server's direct FCM path of the outage
 * start and end signals (docs/phase4-plan.md §3 step 3, fallback 2). Null when there is none (no
 * Google Play services, no EAS project, iOS until Phase 6 [MAC]). Never throws.
 */
export async function nativePushToken(): Promise<string | null> {
  if (Platform.OS !== 'android' || !easProjectId()) return null;
  try {
    const token = await Notifications.getDevicePushTokenAsync();
    return typeof token.data === 'string' && token.data ? token.data : null;
  } catch {
    return null;
  }
}

/**
 * The real Expo push token (`ExponentPushToken[...]`), when the app can have one: an EAS project id
 * in the config (set by `eas init`, docs/phase4-plan.md §0 C), Android with Google Play services, and
 * a network. Otherwise null, and the device registers with its development token instead, as before.
 * Never throws: a failure here must not stop the registration.
 */
export async function realPushToken(): Promise<string | null> {
  if (Platform.OS !== 'android') return null; // iOS push is Phase 6 [MAC]
  const projectId = easProjectId();
  if (!projectId) return null;
  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return token.data || null;
  } catch {
    return null;
  }
}
