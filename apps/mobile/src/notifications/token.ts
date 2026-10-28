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
