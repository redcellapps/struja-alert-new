import { belgradeLocal, belgradeLocalToUtc } from '@struja/parser';
import { DEFAULT_QUIET_HOURS, URGENT_WITHIN_HOURS } from '@struja/shared';

// Quiet hours (BRIEF §5): no notifications between 22:00 and 07:00 (user-editable), unless the
// outage starts within 2 hours. A notification planned in quiet hours is held until they end.
export interface QuietHours {
  start: string; // "22:00", Europe/Belgrade
  end: string; // "07:00"
}

const minutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export function parseQuietHours(value: unknown): QuietHours {
  const v = value as Partial<QuietHours> | null;
  if (v && typeof v.start === 'string' && typeof v.end === 'string') {
    return { start: v.start, end: v.end };
  }
  return { start: DEFAULT_QUIET_HOURS.start, end: DEFAULT_QUIET_HOURS.end };
}

export function isQuiet(at: Date, q: QuietHours): boolean {
  const l = belgradeLocal(at);
  const m = l.hour * 60 + l.minute;
  const [s, e] = [minutes(q.start), minutes(q.end)];
  if (s === e) return false; // no quiet window
  return s < e ? m >= s && m < e : m >= s || m < e; // the usual case wraps midnight
}

// The next moment (UTC) the quiet window ends, for an instant inside it.
export function quietEnd(at: Date, q: QuietHours): Date {
  const l = belgradeLocal(at);
  const m = l.hour * 60 + l.minute;
  const [s, e] = [minutes(q.start), minutes(q.end)];
  const endsNextDay = s > e && m >= s; // after midnight-wrapping start: ends tomorrow
  const day = l.day + (endsNextDay ? 1 : 0);
  return belgradeLocalToUtc(l.year, l.month, day, Math.floor(e / 60), e % 60);
}

export interface Delivery {
  deliverAt: Date;
  // Starts within 2 hours: delivered right away, on the urgent channel / time-sensitive level.
  urgent: boolean;
}

export function planDelivery(now: Date, startsAt: Date, quiet: QuietHours): Delivery {
  const urgent = startsAt.getTime() - now.getTime() <= URGENT_WITHIN_HOURS * 3600_000;
  if (urgent) return { deliverAt: now, urgent: true };
  return { deliverAt: isQuiet(now, quiet) ? quietEnd(now, quiet) : now, urgent: false };
}
