import type { T } from '../home/format';
import { WEEKDAYS } from '../home/format';
import type { AlarmBook } from '../notifications/alarms';
import { storage, type KeyValueStorage } from '../store/storage';

// What the home screen widget gets (modules/struja-widget): the saved addresses, their coming
// outages, and every label in the person's language and script. The native side decides what to
// show from the times and the clock, so the picture flips at a start or an end with the app
// process dead; the app only hands over a fresh snapshot whenever its data changed.

export interface WidgetAddress {
  id: number;
  name: string;
  primary: boolean;
}

const ADDRESSES_KEY = 'widget-addresses';

/** The saved addresses as the last sync saw them, kept for the headless paths. */
export function readWidgetAddresses(kv: KeyValueStorage = storage()): WidgetAddress[] {
  try {
    const raw = kv.getString(ADDRESSES_KEY);
    return raw ? (JSON.parse(raw) as WidgetAddress[]) : [];
  } catch {
    return [];
  }
}

export function writeWidgetAddresses(list: WidgetAddress[], kv: KeyValueStorage = storage()): void {
  kv.set(ADDRESSES_KEY, JSON.stringify(list));
}

export function clearWidgetAddresses(kv: KeyValueStorage = storage()): void {
  kv.remove(ADDRESSES_KEY);
}

export interface WidgetSnapshot {
  v: 1;
  updatedAt: number;
  labels: Record<string, string | string[]>;
  addresses: {
    id: number;
    name: string;
    primary: boolean;
    outages: { id: number; startsAt: number; endsAt: number; possible: boolean }[];
  }[];
}

/**
 * The snapshot from the addresses and the alarm book: cancelled and past outages are left out, the
 * rest sorted by start. An address without outages is "Sve u redu".
 */
export function buildWidgetSnapshot(
  addresses: readonly WidgetAddress[],
  book: AlarmBook,
  t: T,
  now: Date,
): WidgetSnapshot {
  const nowMs = now.getTime();
  return {
    v: 1,
    updatedAt: nowMs,
    labels: {
      clear: t('widget.clear'),
      today: t('widget.today'),
      tomorrow: t('widget.tomorrow'),
      later: t('widget.later'),
      active: t('widget.active'),
      startsAt: t('widget.startsAt'),
      backAt: t('widget.backAt'),
      possible: t('status.possible'),
      noAddress: t('widget.noAddress'),
      open: t('widget.open'),
      appName: 'Struja Alert',
      weekdays: WEEKDAYS.map((d) => t(`weekday.${d}`)),
    },
    addresses: addresses.map((a) => ({
      id: a.id,
      name: a.name,
      primary: a.primary,
      outages: Object.values(book)
        .filter(
          (e) =>
            e.subscriptionId === a.id &&
            e.status !== 'cancelled' &&
            new Date(e.endsAt).getTime() > nowMs,
        )
        .map((e) => ({
          id: e.outageId,
          startsAt: new Date(e.startsAt).getTime(),
          endsAt: new Date(e.endsAt).getTime(),
          possible: e.possible === true,
        }))
        .sort((x, y) => x.startsAt - y.startsAt),
    })),
  };
}
