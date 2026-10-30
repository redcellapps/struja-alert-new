import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Exact alarms (docs/reports/2026-10-30-1430-phase4-step3-phone.md, finding A): the local
// "Bez struje" alarm fires on the minute only when Android lets the app schedule exact alarms.
// On Android 12+ that is the optional `SCHEDULE_EXACT_ALARM` permission (declared in app.json),
// which the person turns on in the system's "Alarms & reminders" screen; the battery allowlist
// grants it too. Without it the alarm is inexact (a window of up to an hour). The push is the
// primary path and does not need this; the row on Podešavanja offers it when it is missing.

export type ExactAlarms = 'allowed' | 'denied' | 'unknown';

// The platform, injectable for the tests (jest cannot replace Platform's getters).
export interface PlatformInfo {
  os: string;
  version: number;
}
const here = (): PlatformInfo => ({ os: Platform.OS, version: Number(Platform.Version) });

/** Whether the app may schedule exact alarms right now. Never throws. */
export async function exactAlarmsState(p: PlatformInfo = here()): Promise<ExactAlarms> {
  if (p.os !== 'android') return 'unknown';
  if (p.version < 31) return 'allowed'; // before Android 12 every app may
  try {
    const r = await Notifications.getExactAlarmPermissionsAsync();
    return r.granted ? 'allowed' : 'denied';
  } catch {
    return 'unknown';
  }
}

/**
 * Opens the system's "Alarms & reminders" screen for the app and reports the state afterwards.
 * Never throws (a build without the permission declared cannot ask: the state stays as it was).
 */
export async function requestExactAlarms(p: PlatformInfo = here()): Promise<ExactAlarms> {
  if (p.os !== 'android' || p.version < 31) return exactAlarmsState(p);
  try {
    const r = await Notifications.requestExactAlarmPermissionsAsync();
    return r.granted ? 'allowed' : 'denied';
  } catch {
    return exactAlarmsState(p);
  }
}
