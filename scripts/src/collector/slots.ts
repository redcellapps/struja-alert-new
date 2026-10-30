// Collection slots in Europe/Belgrade local time. The three slots are 07, 13 and 19; a run
// belongs to the latest slot that has begun, i.e. the window of a slot is [slot, next slot):
// 07:00–12:59 is the 07 slot, 13:00–18:59 the 13 slot, 19:00–06:59 the 19 slot (of the day it
// started on). So the first successful run after a slot begins collects it, however late GitHub's
// cron fires (runs were seen 1 to 5 hours late, which the earlier one-hour window missed), and
// the slot marker keeps later runs in the same window from collecting twice. DST is handled by
// Intl, not by hand-picked UTC hours.
export const SLOT_HOURS = [7, 13, 19] as const;
const TZ = 'Europe/Belgrade';

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function belgradeParts(now: Date): { date: string; hour: number } {
  const p = Object.fromEntries(formatter.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

/** The Belgrade calendar date `days` days before (or after) the given date, as YYYY-MM-DD. */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export interface Slot {
  key: string;
  hour: number;
}

export const slotKey = (date: string, hour: number) => `${date}-${String(hour).padStart(2, '0')}`;

/** The slot a run at `now` belongs to: never null, every moment is inside one window. */
export function currentSlot(now: Date): Slot {
  const { date, hour } = belgradeParts(now);
  const begun = [...SLOT_HOURS].filter((h) => h <= hour);
  const slot = begun[begun.length - 1];
  // Before 07:00 the running slot is the previous evening's 19.
  if (slot === undefined) return { key: slotKey(shiftDate(date, -1), 19), hour: 19 };
  return { key: slotKey(date, slot), hour: slot };
}

/** The keys of the three slots of a Belgrade date. */
export function slotsOfDay(date: string): string[] {
  return SLOT_HOURS.map((h) => slotKey(date, h));
}

// Manual runs (workflow_dispatch) bypass the slot rule but get their own key, so they never
// suppress or duplicate a scheduled slot.
export function manualSlot(now: Date): Slot {
  const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 13);
  return { key: `manual-${stamp}Z`, hour: belgradeParts(now).hour };
}
