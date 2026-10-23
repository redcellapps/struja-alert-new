import type { AddressOutageDto } from '@struja/shared';
import { belgradeDate } from '../format/time';
import type { StatusKey } from '../design/tokens';

const HOUR = 3_600_000;

// What one saved address looks like right now, from the outages that concern it.
export interface Outlook {
  status: StatusKey;
  // The outage the status is about (null when `clear`). For `past` it is the cancelled one.
  outage: AddressOutageDto | null;
  startsMs: number;
  endsMs: number;
  // "Moguće pogođeno": the address may be affected but we cannot be sure.
  possible: boolean;
}

const CLEAR: Outlook = { status: 'clear', outage: null, startsMs: 0, endsMs: 0, possible: false };

function describe(outage: AddressOutageDto, status: StatusKey): Outlook {
  return {
    status,
    outage,
    startsMs: Date.parse(outage.startsAt),
    endsMs: Date.parse(outage.endsAt),
    possible: outage.match === 'possible',
  };
}

const byStart = (a: AddressOutageDto, b: AddressOutageDto) =>
  Date.parse(a.startsAt) - Date.parse(b.startsAt);

/** The status of an announced (not cancelled) outage at `now`. */
export function statusAt(startsMs: number, endsMs: number, now: Date): StatusKey {
  const t = now.getTime();
  if (t >= startsMs && t < endsMs) return 'active';
  return startsMs - t < 24 * HOUR ? 'imminent' : 'upcoming';
}

/**
 * The next thing that matters for an address, from now on: an outage in progress, the next announced
 * one (`imminent` inside 24 h, otherwise `upcoming`), a cancelled one that has not passed yet
 * (`past`: shown struck through), or `clear`. Outages that already ended are ignored.
 */
export function outlookFromNow(outages: readonly AddressOutageDto[], now: Date): Outlook {
  const t = now.getTime();
  const open = [...outages].filter((o) => Date.parse(o.endsAt) > t).sort(byStart);
  const live = open.find((o) => o.status !== 'cancelled');
  if (live)
    return describe(live, statusAt(Date.parse(live.startsAt), Date.parse(live.endsAt), now));
  const cancelled = open[0];
  return cancelled ? describe(cancelled, 'past') : CLEAR;
}

/** The same for one Belgrade calendar day (YYYY-MM-DD), as the day strip shows it. */
export function outlookForDay(
  outages: readonly AddressOutageDto[],
  day: string,
  now: Date,
): Outlook {
  if (day === belgradeDate(now)) return outlookFromNow(outages, now);
  const that = [...outages].filter((o) => o.outageDate === day).sort(byStart);
  const live = that.find((o) => o.status !== 'cancelled');
  if (live)
    return describe(live, statusAt(Date.parse(live.startsAt), Date.parse(live.endsAt), now));
  const cancelled = that[0];
  return cancelled ? describe(cancelled, 'past') : CLEAR;
}

/** Days (of the next four) on which at least one of the outages is announced and not cancelled. */
export function daysWithOutage(
  outages: readonly AddressOutageDto[],
  days: readonly string[],
): Set<string> {
  const found = new Set<string>();
  for (const o of outages)
    if (o.status !== 'cancelled' && days.includes(o.outageDate)) found.add(o.outageDate);
  return found;
}
