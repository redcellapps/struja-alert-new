import { belgradeLocal } from '@struja/parser/time';

// Times arrive as UTC ISO strings and are always shown in Europe/Belgrade (no Intl: it behaves the
// same on every device and in tests).
export const hhmm = (iso: string): string => {
  const l = belgradeLocal(new Date(iso));
  return `${String(l.hour).padStart(2, '0')}:${String(l.minute).padStart(2, '0')}`;
};

/** Fractional hour of the Belgrade day, 0 <= h < 24. */
export const dayHour = (iso: string): number => {
  const l = belgradeLocal(new Date(iso));
  return l.hour + l.minute / 60;
};

export const belgradeDate = (at: Date): string => belgradeLocal(at).date;

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayIndex(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export const dayOfMonth = (isoDate: string): number => Number(isoDate.slice(8, 10));
