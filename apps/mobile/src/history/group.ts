import type { AddressOutageDto } from '@struja/shared';
import { belgradeDate } from '../format/time';
import type { T } from '../home/format';

export interface MonthGroup {
  // "2026-10"
  key: string;
  // "Oktobar 2026"
  title: string;
  outages: AddressOutageDto[];
}

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** "Oktobar 2026" for a Belgrade calendar date. */
export const monthTitle = (isoDate: string, t: T): string =>
  `${capitalize(t(`months.${Number(isoDate.slice(5, 7))}`))} ${isoDate.slice(0, 4)}`;

/** The past outages, newest first, grouped by the month they happened in. */
export function groupByMonth(outages: readonly AddressOutageDto[], t: T): MonthGroup[] {
  const sorted = [...outages].sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  const groups = new Map<string, AddressOutageDto[]>();
  for (const o of sorted) {
    const key = o.outageDate.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  return [...groups.entries()].map(([key, list]) => ({
    key,
    title: monthTitle(`${key}-01`, t),
    outages: list,
  }));
}

/**
 * The outages to show: only those of the addresses that are saved now. The outages of a deleted address
 * are kept in the saved copy and on the server, but neither listed nor counted in the year.
 */
export function ofSavedAddresses(
  outages: readonly AddressOutageDto[],
  addressIds: readonly number[],
): AddressOutageDto[] {
  const ids = new Set(addressIds);
  return outages.filter((o) => ids.has(o.subscriptionId));
}

export interface YearSummary {
  count: number;
  // Hours without power, rounded to a whole number.
  hours: number;
}

/** This year in numbers: outages that really happened (not cancelled) and the hours they took. */
export function yearSummary(outages: readonly AddressOutageDto[], year: string): YearSummary {
  let ms = 0;
  let count = 0;
  for (const o of outages) {
    if (o.status === 'cancelled' || o.outageDate.slice(0, 4) !== year) continue;
    count += 1;
    ms += Date.parse(o.endsAt) - Date.parse(o.startsAt);
  }
  return { count, hours: Math.round(ms / 3_600_000) };
}

export const yearOf = (now: Date): string => belgradeDate(now).slice(0, 4);
