import { addDays, weekdayIndex } from '../format/time';
import { hoursAndMinutes } from '../format/duration';

// A translate function as the home screen uses it (react-i18next's `t` satisfies this).
export type T = (key: string, options?: Record<string, unknown>) => string;

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const weekdayKey = (isoDate: string) =>
  WEEKDAYS[weekdayIndex(isoDate)] as (typeof WEEKDAYS)[number];

/** "pre 12 min", "pre 3 h", "upravo": how old the data is. */
export function agoLabel(ms: number, t: T): string {
  const minutes = Math.floor(Math.max(ms, 0) / 60_000);
  if (minutes < 1) return t('home.ago.now');
  if (minutes < 60) return t('home.ago.minutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t('home.ago.hours', { count: hours });
  return t('home.ago.days', { count: Math.floor(hours / 24) });
}

/** "40 min", "5 h", "2 d": how long until something starts, rounded down to a whole unit. */
export function hoursUntil(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}

/** "4 h", "4 h 30 min", "45 min" (the units read the same in Serbian and English). */
export function durationShort(ms: number): string {
  const { hours, minutes } = hoursAndMinutes(ms);
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/** "1 čas 12 minuta": a whole sentence part for TalkBack and for the card summaries. */
export function spokenDuration(ms: number, t: T): string {
  const { hours, minutes } = hoursAndMinutes(ms);
  const parts: string[] = [];
  if (hours > 0) parts.push(t('duration.hours', { count: hours }));
  if (minutes > 0 || hours === 0) parts.push(t('duration.minutes', { count: minutes }));
  return parts.join(' ');
}

/** "Danas", "Sutra" or "pet 6.11." for a Belgrade calendar date, relative to `today`. */
export function dayCaption(date: string, today: string, t: T): string {
  if (date === today) return t('upcoming.today');
  if (date === addDays(today, 1)) return t('upcoming.tomorrow');
  return `${t(`weekday.${weekdayKey(date)}`)} ${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}.`;
}
