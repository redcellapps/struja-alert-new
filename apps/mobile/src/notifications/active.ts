import * as Notifications from 'expo-notifications';
import { OUTAGE_CATEGORY, URGENT_CHANNEL } from '@struja/shared';
import { hhmm } from '../format/time';
import type { T } from '../home/format';

// The "outage active" surface on the phone (BRIEF §5, docs/phase4-plan.md §3 step 3): at `starts_at`
// a "Bez struje" notification with the time the power comes back, at `ends_at` "Struja se vratila".
// Both are plain notifications here; step 5 puts the Live Update (Android 16+) in front of the start
// one on phones that have it. Everything that calls this works the same whether the signal came from
// the server's data push (the background task) or from the app's own alarm (alarms.ts).

export interface ActiveOutage {
  outageId: number;
  subscriptionId: number;
  address: string;
  startsAt: string;
  endsAt: string;
}

// The identifiers (Android: the tag) of the two notifications of an outage. The push task and the
// local alarm (alarms.ts) use the same ones, so whichever comes second replaces the first instead of
// adding a line to the shade.
export const activeNotificationId = (outageId: number) => `outage-${outageId}-active`;
export const endedNotificationId = (outageId: number) => `outage-${outageId}-ended`;

const data = (o: ActiveOutage, boundary: 'started' | 'ended') => ({
  outageId: o.outageId,
  subscriptionId: o.subscriptionId,
  kind: boundary,
  link: `strujaalert://outage/${o.outageId}`,
  address: o.address,
  startsAt: o.startsAt,
  endsAt: o.endsAt,
});

/** What the two notifications say, in the current language and script. */
export function activeContent(
  o: ActiveOutage,
  boundary: 'started' | 'ended',
  t: T,
): Notifications.NotificationContentInput {
  const title =
    boundary === 'started' ? t('push.active.title', { address: o.address }) : t('push.ended.title');
  const body = boundary === 'started' ? t('push.active.body', { time: hhmm(o.endsAt) }) : o.address;
  return {
    title,
    body,
    categoryIdentifier: OUTAGE_CATEGORY,
    threadIdentifier: `address-${o.subscriptionId}`,
    data: data(o, boundary),
    // The start keeps the notification in the shade until the power is back (it still can be swiped
    // away); the end one is ordinary news.
    sticky: boundary === 'started',
    autoDismiss: boundary === 'ended',
  };
}

/** Shows "Bez struje" now (replacing an earlier one for the same outage). */
export async function showActive(o: ActiveOutage, t: T): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier: activeNotificationId(o.outageId),
    content: activeContent(o, 'started', t),
    // No moment given: shown now, on the "hitno" channel.
    trigger: { channelId: URGENT_CHANNEL },
  });
}

/** Takes "Bez struje" down and shows "Struja se vratila" in its place. */
export async function showEnded(o: ActiveOutage, t: T): Promise<void> {
  await Notifications.dismissNotificationAsync(activeNotificationId(o.outageId));
  await Notifications.scheduleNotificationAsync({
    identifier: endedNotificationId(o.outageId),
    content: activeContent(o, 'ended', t),
    trigger: { channelId: 'changed' },
  });
}

/** Takes "Bez struje" down without a word (the outage was cancelled or replaced). */
export async function clearActive(outageId: number): Promise<void> {
  await Notifications.dismissNotificationAsync(activeNotificationId(outageId));
}
