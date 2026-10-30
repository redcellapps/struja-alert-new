import * as IntentLauncher from 'expo-intent-launcher';
import { Linking, Platform } from 'react-native';

// HONOR and Huawei phones (MagicOS / EMUI) manage app launching themselves: with "Manage
// automatically" on, the system may stop the app's background work. The measurements of 29–30 Oct
// 2026 (docs/reports/) showed every push still arrives with the default settings; what the
// settings buy is exact local alarms and background refresh. So the app advises, it does not
// insist: one card on Podešavanja and under the "notifications off" banner, on these phones only.

/** The phone's maker as Android reports it, lower-cased ("honor", "huawei", "samsung", ...). */
export function manufacturer(): string {
  if (Platform.OS !== 'android') return '';
  const c = Platform.constants as { Manufacturer?: unknown; Brand?: unknown };
  return String(c.Manufacturer ?? c.Brand ?? '').toLowerCase();
}

export const isHonorOrHuawei = (maker: string = manufacturer()): boolean =>
  /honor|huawei/.test(maker);

// The "App launch" screen of the system manager: HONOR's package first, then Huawei's.
const APP_LAUNCH_ACTIVITIES = [
  {
    packageName: 'com.hihonor.systemmanager',
    className: 'com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity',
  },
  {
    packageName: 'com.huawei.systemmanager',
    className: 'com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity',
  },
];

/**
 * Opens the system's "App launch" list when the phone has one, else the app's own settings page
 * (where "Battery" and the launch settings are a tap away). Resolves to where it ended up.
 */
export async function openAppLaunchSettings(
  start: (
    action: string,
    params: { packageName: string; className: string },
  ) => Promise<unknown> = (action, params) => IntentLauncher.startActivityAsync(action, params),
  fallback: () => Promise<unknown> = () => Linking.openSettings(),
): Promise<'app-launch' | 'app-settings'> {
  for (const target of APP_LAUNCH_ACTIVITIES) {
    try {
      await start('android.intent.action.MAIN', target);
      return 'app-launch';
    } catch {
      // not this maker's package: try the next
    }
  }
  await fallback();
  return 'app-settings';
}
