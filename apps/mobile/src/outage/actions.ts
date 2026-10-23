import { startActivityAsync } from 'expo-intent-launcher';
import { Linking, Platform, Share } from 'react-native';
import type { OutageDetailDto } from '@struja/shared';
import { belgradeDate, hhmm } from '../format/time';
import { dayCaption, weekdayKey, type T } from '../home/format';

/** "utorak, 3. novembar": the long date of a Belgrade calendar day. */
export function dateLong(isoDate: string, t: T): string {
  return `${t(`home.weekdayLong.${weekdayKey(isoDate)}`)}, ${Number(isoDate.slice(8, 10))}. ${t(`months.${Number(isoDate.slice(5, 7))}`)}`;
}

/** "08:30–12:30" of an outage. */
export const windowText = (detail: Pick<OutageDetailDto, 'startsAt' | 'endsAt'>): string =>
  `${hhmm(detail.startsAt)}–${hhmm(detail.endsAt)}`;

export interface CalendarEvent {
  title: string;
  // Milliseconds since the epoch.
  begin: number;
  end: number;
  description: string;
  location: string;
}

/** The event the system "add event" screen is opened with. */
export function calendarEvent(detail: OutageDetailDto, where: string, t: T): CalendarEvent {
  return {
    title: t('detail.calendarTitle'),
    begin: Date.parse(detail.startsAt),
    end: Date.parse(detail.endsAt),
    description: `${where}\n${t('home.source')}\n${detail.source.url}`,
    location: where,
  };
}

/**
 * Opens the system calendar's "add event" screen with the event filled in (an Android intent). The
 * app never asks for calendar permission: the person saves the event in their own calendar app.
 * iOS uses the system event editor through expo-calendar's write-only flow **[MAC]**, added with the
 * iOS polish; until then the button is not shown there.
 */
export async function addToCalendar(event: CalendarEvent): Promise<void> {
  if (Platform.OS !== 'android') return;
  await startActivityAsync('android.intent.action.INSERT', {
    data: 'content://com.android.calendar/events',
    extra: {
      title: event.title,
      beginTime: event.begin,
      endTime: event.end,
      description: event.description,
      eventLocation: event.location,
    },
  });
}

export const calendarAvailable = Platform.OS === 'android';

/** The text shared from the detail sheet: when, where, and the source. */
export function shareMessage(detail: OutageDetailDto, where: string, today: string, t: T): string {
  const day = dayCaption(detail.outageDate, today, t);
  return t('detail.shareText', {
    when: `${dateLong(detail.outageDate, t)} (${day}) ${windowText(detail)}`,
    where,
    source: `${detail.source.name}, ${detail.source.url}`,
  });
}

export const shareOutage = (message: string) => Share.share({ message });
export const openSource = (url: string) => Linking.openURL(url);
export const todayInBelgrade = () => belgradeDate(new Date());
