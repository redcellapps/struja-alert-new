// Collection slots in Europe/Belgrade local time. A run collects only while the local hour
// equals a slot hour, i.e. a one-hour window [slot, slot+1h), so a delayed GitHub cron run
// still counts. DST is handled by Intl, not by hand-picked UTC hours.
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

export interface Slot {
  key: string;
  hour: number;
}

export function currentSlot(now: Date): Slot | null {
  const { date, hour } = belgradeParts(now);
  const slot = SLOT_HOURS.find((h) => h === hour);
  if (slot === undefined) return null;
  return { key: `${date}-${String(slot).padStart(2, '0')}`, hour: slot };
}

// Manual runs (workflow_dispatch) bypass the window but get their own key, so they never
// suppress or duplicate a scheduled slot.
export function manualSlot(now: Date): Slot {
  const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 13);
  return { key: `manual-${stamp}Z`, hour: belgradeParts(now).hour };
}
