import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { belgradeParts, shiftDate, slotsOfDay } from './slots.ts';

// The collector's watchdog: did the last whole Belgrade day get enough slots? Run once a day after
// the 19 slot's window has had its chance (the workflow runs it in the small hours), it reports the
// day before: the slots that exist on the fixtures branch and the ones missing. Fewer than
// `MIN_SLOTS_PER_DAY` is the alarm (the owner's threshold, 30 Oct 2026).
export const MIN_SLOTS_PER_DAY = 2;

export interface DayReport {
  date: string;
  present: string[];
  missing: string[];
}

/** The last whole Belgrade day as of `now`: yesterday's date, in Belgrade time. */
export function dayToCheck(now: Date): string {
  return shiftDate(belgradeParts(now).date, -1);
}

/** Which of the day's three slots have a marker under `<fixturesDir>/eds/`. */
export function checkDay(fixturesDir: string, date: string): DayReport {
  const present: string[] = [];
  const missing: string[] = [];
  for (const key of slotsOfDay(date)) {
    (existsSync(join(fixturesDir, 'eds', key, '_slot.json')) ? present : missing).push(key);
  }
  return { date, present, missing };
}

/** True when the day calls for the alarm: fewer than `MIN_SLOTS_PER_DAY` slots collected. */
export const isAlarm = (r: DayReport): boolean => r.present.length < MIN_SLOTS_PER_DAY;

/** Human-readable lines for the log and the issue. */
export function describeDay(r: DayReport): string {
  if (r.present.length === 0) {
    return `No EDS fixtures were collected on ${r.date} (missing: ${r.missing.join(', ')}).`;
  }
  const verdict = isAlarm(r) ? `fewer than ${MIN_SLOTS_PER_DAY}` : 'enough';
  return `${r.date}: ${r.present.length} of 3 slots collected (${r.present.join(', ')})${
    r.missing.length ? `; missing ${r.missing.join(', ')}` : ''
  }: ${verdict}.`;
}
