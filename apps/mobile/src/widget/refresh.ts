import type { T } from '../home/format';
import { clearWidgetSnapshot, setWidgetSnapshot } from '../../modules/struja-widget';
import { readBook } from '../notifications/alarms';
import { storage, type KeyValueStorage } from '../store/storage';
import { buildWidgetSnapshot, clearWidgetAddresses, readWidgetAddresses } from './snapshot';

/**
 * Hands the widgets what the app knows right now: the saved addresses and the alarm book. Called
 * from every path that changes them (the sync in the running app, the push task, the 15-minute
 * refresh), so the widget never polls on its own. Never throws; false where there is no widget.
 */
export async function refreshWidget(
  t: T,
  now: Date = new Date(),
  kv: KeyValueStorage = storage(),
  send: (json: string) => Promise<boolean> = setWidgetSnapshot,
): Promise<boolean> {
  try {
    const snapshot = buildWidgetSnapshot(readWidgetAddresses(kv), readBook(kv), t, now);
    return await send(JSON.stringify(snapshot));
  } catch {
    return false;
  }
}

/** After "delete all my data": the widgets fall back to their empty state. */
export async function forgetWidget(kv: KeyValueStorage = storage()): Promise<void> {
  clearWidgetAddresses(kv);
  await clearWidgetSnapshot();
}
