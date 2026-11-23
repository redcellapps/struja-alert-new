import { requireOptionalNativeModule } from 'expo';

// The home screen widget (Android, Jetpack Glance; see android/). The app hands over a snapshot
// (src/widget/snapshot.ts) and the native side draws, keeps it for the dead-process case and
// re-renders itself at the next outage start or end.
interface StrujaWidgetNative {
  setSnapshot(json: string): Promise<void>;
  clearSnapshot(): Promise<void>;
}

const native = requireOptionalNativeModule<StrujaWidgetNative>('StrujaWidget');

/** True where the widget exists (Android with the module built in). */
export const widgetAvailable = (): boolean => native !== null;

/** Hands the widgets a new snapshot; nothing happens where there is no widget. Never throws. */
export async function setWidgetSnapshot(json: string): Promise<boolean> {
  if (!native) return false;
  try {
    await native.setSnapshot(json);
    return true;
  } catch {
    return false;
  }
}

/** Forgets the snapshot (after "delete all my data"): the widgets show the empty state. */
export async function clearWidgetSnapshot(): Promise<void> {
  try {
    await native?.clearSnapshot();
  } catch {
    // nothing to clear
  }
}
