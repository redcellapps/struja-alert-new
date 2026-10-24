import { useEffect } from 'react';
import type { Endpoints } from '../api/endpoints';
import { api } from '../api/runtime';
import { storage, type KeyValueStorage } from '../store/storage';
import { useSettings, type SettingsValues } from '../store/settings';

// What the server needs to know about the settings: the language of the notification text and which
// notifications to send when.
export type DeviceSettings = Pick<
  SettingsValues,
  'language' | 'script' | 'enabledKinds' | 'quietHours'
>;

export const deviceBody = (s: DeviceSettings) => ({
  locale: s.language,
  script: s.script,
  enabledKinds: s.enabledKinds,
  quietHours: s.quietHours,
});

const KEY = 'device-sync';

/**
 * Sends the settings to the server unless the server already has exactly these (remembered after the
 * last successful send). A failure is not an error: the next change or the next start tries again.
 */
export async function syncDevice(
  client: Pick<Endpoints, 'patchDevice'>,
  kv: KeyValueStorage,
  settings: DeviceSettings,
): Promise<boolean> {
  const body = deviceBody(settings);
  const text = JSON.stringify(body);
  if (kv.getString(KEY) === text) return false;
  try {
    await client.patchDevice(body);
    kv.set(KEY, text);
    return true;
  } catch {
    return false;
  }
}

/** Keeps the server's copy of the settings current, once the person is past onboarding. */
export function useDeviceSync(): void {
  const onboarded = useSettings((s) => s.onboarded);
  const language = useSettings((s) => s.language);
  const script = useSettings((s) => s.script);
  const enabledKinds = useSettings((s) => s.enabledKinds);
  const quietHours = useSettings((s) => s.quietHours);
  useEffect(() => {
    if (!onboarded) return;
    void syncDevice(api, storage(), { language, script, enabledKinds, quietHours });
  }, [onboarded, language, script, enabledKinds, quietHours]);
}

/** Forget what was sent (after "delete all my data" the next device starts from nothing). */
export const forgetSync = (kv: KeyValueStorage) => kv.remove(KEY);
