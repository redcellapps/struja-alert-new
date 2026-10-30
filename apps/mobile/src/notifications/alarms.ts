import * as Notifications from 'expo-notifications';
import { URGENT_CHANNEL, type AddressOutageDto } from '@struja/shared';
import type { T } from '../home/format';
import { storage, type KeyValueStorage } from '../store/storage';
import {
  activeContent,
  activeNotificationId,
  clearActive,
  endedNotificationId,
  type ActiveOutage,
} from './active';

// Fallback 1 of the "outage active" signal (docs/phase4-plan.md §3 step 3): the app does not rely
// on the server's data push alone. Whenever it learns of an outage for a saved address (a sync, a
// push, adding the address) it books two local notifications: "Bez struje" at `starts_at` and
// "Struja se vratila" at `ends_at`. They are alarms, so they fire with the app killed and in Doze
// (not after a force-stop). When the data push arrives first, the task cancels the alarm; when the
// alarm fires first, the push replaces the notification with the same identifier. A cancelled
// outage never keeps an alarm: that is the one thing this file must never get wrong.

// What the app knows about the outages it may have to announce, by outage id. Kept in MMKV so the
// background task (no React, no query cache) can read and write it.
export interface AlarmBook {
  [outageId: string]: ActiveOutage & { status: 'active' | 'changed' | 'cancelled' };
}

const BOOK_KEY = 'alarm-book';

export function readBook(kv: KeyValueStorage = storage()): AlarmBook {
  try {
    const raw = kv.getString(BOOK_KEY);
    return raw ? (JSON.parse(raw) as AlarmBook) : {};
  } catch {
    return {};
  }
}

export function writeBook(book: AlarmBook, kv: KeyValueStorage = storage()): void {
  kv.set(BOOK_KEY, JSON.stringify(book));
}

// The alarms carry the identifiers of the notifications they will show (see active.ts).
export const startAlarmId = activeNotificationId;
export const endAlarmId = endedNotificationId;

/**
 * The outages of a sync (Početna's data), with the address as the person sees it. The sync is the
 * whole truth: an outage the server no longer lists (replaced by a newer row, the address removed,
 * the window past) leaves the book, and with it its alarms. Carrying such entries over was tried
 * first and booked a "Bez struje" for a replaced outage (found on the phone, 30 Oct).
 */
export function bookFromSync(
  outages: AddressOutageDto[],
  addressOf: (subscriptionId: number) => string | undefined,
  previous: AlarmBook,
): AlarmBook {
  const book: AlarmBook = {};
  for (const o of outages) {
    const address = addressOf(o.subscriptionId) ?? previous[String(o.id)]?.address ?? '';
    book[String(o.id)] = {
      outageId: o.id,
      subscriptionId: o.subscriptionId,
      address,
      startsAt: o.startsAt,
      endsAt: o.endsAt,
      status: o.status,
    };
  }
  return book;
}

// The data of a `new` / `changed` / `cancelled` / `reinstated` / `evening_before` push
// (apps/server/src/notify/plan.ts) carries everything the alarm needs.
export interface OutagePushData {
  outageId: number;
  subscriptionId: number;
  kind: string;
  startsAt: string;
  endsAt: string;
  address: string;
}

const asInt = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v > 0
    ? v
    : typeof v === 'string' && /^\d+$/.test(v)
      ? Number(v)
      : null;

/** The push data as the alarm book needs it, or null when something essential is missing. */
export function outagePushData(data: Record<string, unknown>): OutagePushData | null {
  const outageId = asInt(data['outageId']);
  const subscriptionId = asInt(data['subscriptionId']);
  const { kind, startsAt, endsAt, address } = data;
  if (
    outageId === null ||
    subscriptionId === null ||
    typeof kind !== 'string' ||
    typeof startsAt !== 'string' ||
    typeof endsAt !== 'string' ||
    Number.isNaN(Date.parse(startsAt)) ||
    Number.isNaN(Date.parse(endsAt))
  ) {
    return null;
  }
  return {
    outageId,
    subscriptionId,
    kind,
    startsAt,
    endsAt,
    address: typeof address === 'string' ? address : '',
  };
}

/** The book after a push about an outage: cancelled means no alarm, anything else books it anew. */
export function bookFromPush(push: OutagePushData, previous: AlarmBook): AlarmBook {
  return {
    ...previous,
    [String(push.outageId)]: {
      outageId: push.outageId,
      subscriptionId: push.subscriptionId,
      address: push.address || previous[String(push.outageId)]?.address || '',
      startsAt: push.startsAt,
      endsAt: push.endsAt,
      status: push.kind === 'cancelled' ? 'cancelled' : 'active',
    },
  };
}

export interface PlannedAlarm {
  identifier: string;
  at: Date;
  outage: ActiveOutage;
  boundary: 'started' | 'ended';
}

/**
 * The alarms the book calls for at `now`: a start alarm for an outage that has not started, an end
 * alarm for one that has not ended; nothing for a cancelled one. An outage already running gets its
 * end alarm only: the start is shown by whoever noticed it (the push, or the app in the foreground).
 */
export function planAlarms(book: AlarmBook, now: Date): PlannedAlarm[] {
  const out: PlannedAlarm[] = [];
  for (const entry of Object.values(book)) {
    if (entry.status === 'cancelled') continue;
    const starts = new Date(entry.startsAt);
    const ends = new Date(entry.endsAt);
    if (ends.getTime() <= now.getTime()) continue;
    const outage: ActiveOutage = {
      outageId: entry.outageId,
      subscriptionId: entry.subscriptionId,
      address: entry.address,
      startsAt: entry.startsAt,
      endsAt: entry.endsAt,
    };
    if (starts.getTime() > now.getTime()) {
      out.push({
        identifier: startAlarmId(entry.outageId),
        at: starts,
        outage,
        boundary: 'started',
      });
    }
    out.push({ identifier: endAlarmId(entry.outageId), at: ends, outage, boundary: 'ended' });
  }
  return out;
}

const OURS = /^outage-\d+-(active|ended)$/;

/**
 * Makes the phone's scheduled notifications match the plan: ours that are not in the plan are
 * cancelled (a cancelled or changed outage), the planned ones that are missing or moved are
 * (re)scheduled. Idempotent; other scheduled notifications are left alone. A cancelled outage whose
 * "Bez struje" is already showing is taken down too.
 */
export async function syncAlarms(book: AlarmBook, t: T, now: Date): Promise<void> {
  const plan = planAlarms(book, now);
  const wanted = new Map(plan.map((p) => [p.identifier, p]));
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const have = new Map<string, Date | null>();
  for (const s of scheduled) {
    if (!OURS.test(s.identifier)) continue;
    const trigger = s.trigger as { type?: string; value?: number } | null;
    have.set(
      s.identifier,
      trigger?.type === 'date' && typeof trigger.value === 'number'
        ? new Date(trigger.value)
        : null,
    );
  }
  for (const [identifier, at] of have) {
    const p = wanted.get(identifier);
    if (p && at && at.getTime() === p.at.getTime()) continue;
    await Notifications.cancelScheduledNotificationAsync(identifier);
    have.delete(identifier);
  }
  for (const p of plan) {
    if (have.has(p.identifier)) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: p.identifier,
      content: activeContent(p.outage, p.boundary, t),
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: p.at,
        channelId: p.boundary === 'started' ? URGENT_CHANNEL : 'changed',
      },
    });
  }
  for (const entry of Object.values(book)) {
    if (entry.status === 'cancelled') await clearActive(entry.outageId);
  }
}
