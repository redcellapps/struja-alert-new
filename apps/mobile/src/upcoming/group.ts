import { cyrillicToLatin } from '@struja/parser/transliterate';
import { normalizeName } from '@struja/parser/normalize';
import type { cityOutageSchema } from '@struja/shared';
import type { z } from 'zod';
import { addDays } from '../format/time';
import { dateLong } from '../outage/actions';
import { dayCaption, type T } from '../home/format';

export type CityOutage = z.infer<typeof cityOutageSchema>;

/** A street or municipality name as published (Cyrillic), in the chosen script. */
export const inScript = (text: string, script: 'latn' | 'cyrl'): string =>
  script === 'cyrl' ? text : cyrillicToLatin(text);

/**
 * Does an outage match what was typed? Every typed word must start a word of one of its street names
 * or of its municipality, whatever the script, case or diacritics ("studen", "студеничка", "Čegar").
 */
export function matchesQuery(outage: CityOutage, query: string): boolean {
  const wanted = normalizeName(query);
  if (wanted === '') return true;
  const words = [...outage.streets, outage.municipality].flatMap((n) =>
    normalizeName(n).split(' '),
  );
  return wanted.split(' ').every((w) => words.some((x) => x.startsWith(w)));
}

export interface DayGroup {
  date: string;
  // "Danas · petak 23.", "Sutra · subota 24.", "nedelja 25."
  title: string;
  outages: CityOutage[];
}

/** The outages in chronological order, grouped by the Belgrade day they happen on. */
export function groupByDay(outages: readonly CityOutage[], today: string, t: T): DayGroup[] {
  const sorted = [...outages].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const groups = new Map<string, CityOutage[]>();
  for (const o of sorted) groups.set(o.outageDate, [...(groups.get(o.outageDate) ?? []), o]);
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => {
      const long = dateLong(date, t).replace(/^([^,]+), (\d+)\. .*$/, '$1 $2.');
      const near = date === today || date === addDays(today, 1);
      return {
        date,
        title: near ? `${dayCaption(date, today, t)} · ${long}` : long,
        outages: list,
      };
    });
}

/** The first `max` streets and how many more there are ("i još 2"). */
export function streetsSummary(
  streets: readonly string[],
  script: 'latn' | 'cyrl',
  max = 3,
): { shown: string[]; more: number } {
  return {
    shown: streets.slice(0, max).map((s) => inScript(s, script)),
    more: Math.max(0, streets.length - max),
  };
}
