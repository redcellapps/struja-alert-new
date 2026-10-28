import * as Notifications from 'expo-notifications';
import {
  NOTIFICATION_ACTIONS,
  NOTIFICATION_CHANNELS,
  OUTAGE_CATEGORY,
  type NotificationChannelId,
} from '@struja/shared';
import type { T } from '../home/format';

// What each channel is for (BRIEF §5): one per kind, "hitno" high. The names and descriptions are
// what the person sees in the system settings, in their script; the importance is fixed at creation
// (Android), so it is never changed here: a different importance would need a new channel id.
const CHANNEL_SPEC: Record<
  NotificationChannelId,
  { importance: Notifications.AndroidImportance; vibrate: boolean }
> = {
  new: { importance: Notifications.AndroidImportance.DEFAULT, vibrate: true },
  evening_before: { importance: Notifications.AndroidImportance.DEFAULT, vibrate: true },
  changed: { importance: Notifications.AndroidImportance.DEFAULT, vibrate: true },
  cancelled: { importance: Notifications.AndroidImportance.DEFAULT, vibrate: true },
  // Starts within 2 hours: heads-up, sound, but Do Not Disturb is respected (no bypassDnd).
  hitno: { importance: Notifications.AndroidImportance.HIGH, vibrate: true },
};

/** The channel definitions in the given language and script (the i18n keys `push.channel.<id>`). */
export function channelDefinitions(t: T): {
  id: NotificationChannelId;
  input: Notifications.NotificationChannelInput;
}[] {
  return NOTIFICATION_CHANNELS.map((id) => ({
    id,
    input: {
      name: t(`push.channel.${id}.name`),
      description: t(`push.channel.${id}.description`),
      importance: CHANNEL_SPEC[id].importance,
      vibrationPattern: CHANNEL_SPEC[id].vibrate ? [0, 250, 250, 250] : null,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      // no `sound`: the system's default notification sound (a name here means a bundled file)
      bypassDnd: false,
      showBadge: true,
    },
  }));
}

/**
 * Creates the channels (or renames them when the script or language changed: name and description are
 * the only fields Android lets a channel change). Must run before the push token is requested: on
 * Android 13+ the permission prompt needs a channel to exist.
 */
export async function ensureChannels(t: T): Promise<void> {
  for (const { id, input } of channelDefinitions(t)) {
    await Notifications.setNotificationChannelAsync(id, input);
  }
}

/** The "outage" category: the two buttons under every notification (BRIEF §5). */
export function categoryActions(t: T): Notifications.NotificationAction[] {
  return [
    {
      identifier: NOTIFICATION_ACTIONS.details,
      buttonTitle: t('push.actionDetails'),
      options: { opensAppToForeground: true },
    },
    {
      // The calendar needs an activity (the system add-event screen), so this one opens the app too:
      // the detail comes up with the calendar sheet over it.
      identifier: NOTIFICATION_ACTIONS.calendar,
      buttonTitle: t('push.actionCalendar'),
      options: { opensAppToForeground: true },
    },
  ];
}

export async function ensureCategories(t: T): Promise<void> {
  await Notifications.setNotificationCategoryAsync(OUTAGE_CATEGORY, categoryActions(t));
}

/** Channels and categories, in the current language and script; called at start and on each change. */
export async function setupNotifications(t: T): Promise<void> {
  await ensureChannels(t);
  await ensureCategories(t);
}

/** A notification that arrives while the app is open is shown like any other (the server decided it is due). */
export function installForegroundHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}
