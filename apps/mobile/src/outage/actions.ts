import { startActivityAsync } from 'expo-intent-launcher';
import { Linking, Platform, Share } from 'react-native';
import type { OutageDetailDto } from '@struja/shared';
import { belgradeDate, hhmm } from '../format/time';
import { dayCaption, weekdayKey, type T } from '../home/format';
import { streetLine } from './ranges';

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

/**
 * Every street of the outage, once, in the chosen script: the outage's own list, never the person's saved
 * addresses (what is shared or put in a calendar must not say where else they live or follow).
 */
export function affectedStreets(
  detail: Pick<OutageDetailDto, 'segments'>,
  script: 'latn' | 'cyrl',
  t: T,
): { title: string; detail: string | null }[] {
  const seen = new Set<string>();
  return detail.segments
    .map((segment) => streetLine(segment, script, t))
    .filter((line) => {
      const key = `${line.title}|${line.detail ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * The event the system "add event" screen is opened with. `where` is the person's address this outage
 * concerns (the event is in their own calendar); the notes list every street of the outage with its ranges.
 */
export function calendarEvent(
  detail: OutageDetailDto,
  where: string,
  script: 'latn' | 'cyrl',
  t: T,
): CalendarEvent {
  const streets = affectedStreets(detail, script, t)
    .map((s) => (s.detail ? `${s.title}: ${s.detail}` : s.title))
    .join('\n');
  return {
    title: t('detail.calendarTitle'),
    begin: Date.parse(detail.startsAt),
    end: Date.parse(detail.endsAt),
    description: `${streets}\n${t('home.source')}\n${detail.source.url}`,
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

/** The text shared from the detail sheet: when, every street of the outage, and the source. */
export function shareMessage(
  detail: OutageDetailDto,
  today: string,
  script: 'latn' | 'cyrl',
  t: T,
): string {
  const day = dayCaption(detail.outageDate, today, t);
  return t('detail.shareText', {
    when: `${dateLong(detail.outageDate, t)} (${day}) ${windowText(detail)}`,
    where: affectedStreets(detail, script, t)
      .map((s) => s.title)
      .join(', '),
    source: `${detail.source.name}, ${detail.source.url}`,
  });
}

export const shareOutage = (message: string) => Share.share({ message });
export const openSource = (url: string) => Linking.openURL(url);
export const todayInBelgrade = () => belgradeDate(new Date());
