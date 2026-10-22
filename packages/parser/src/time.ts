// Europe/Belgrade <-> UTC without Intl (so it runs the same on Node and Hermes).
// EU rule: summer time (UTC+2) from 01:00 UTC on the last Sunday of March until 01:00 UTC on
// the last Sunday of October; otherwise UTC+1.
function lastSundayUtc(year: number, monthIndex: number): number {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));
  return Date.UTC(year, monthIndex, lastDay.getUTCDate() - lastDay.getUTCDay(), 1, 0, 0);
}

export function belgradeOffsetMinutes(utcMs: number): 60 | 120 {
  const year = new Date(utcMs).getUTCFullYear();
  return utcMs >= lastSundayUtc(year, 2) && utcMs < lastSundayUtc(year, 9) ? 120 : 60;
}

export function belgradeLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  const summer = asUtc - 120 * 60_000;
  return new Date(belgradeOffsetMinutes(summer) === 120 ? summer : asUtc - 60 * 60_000);
}

export interface BelgradeLocal {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  // 0 = Sunday ... 6 = Saturday
  weekday: number;
  // YYYY-MM-DD
  date: string;
}

// The Europe/Belgrade wall clock for an instant.
export function belgradeLocal(at: Date): BelgradeLocal {
  const local = new Date(at.getTime() + belgradeOffsetMinutes(at.getTime()) * 60_000);
  const [year, month, day] = [local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate()];
  return {
    year,
    month,
    day,
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    weekday: local.getUTCDay(),
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

export interface PageDate {
  year: number;
  month: number;
  day: number;
}

// `22.10.2026.` or ISO `2026-10-22`, anywhere in the text.
export function parsePageDate(text: string): PageDate | null {
  const dmy = /(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/.exec(text);
  if (dmy) return { day: Number(dmy[1]), month: Number(dmy[2]), year: Number(dmy[3]) };
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  return null;
}

// `08:30 - 12:30` (hyphen or dash). A window that ends before it starts runs past midnight.
export function parseTimeWindow(
  text: string,
  date: PageDate,
): { startsAt: Date; endsAt: Date } | null {
  const m = /(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})/.exec(text);
  if (!m) return null;
  const [sh, sm, eh, em] = [m[1], m[2], m[3], m[4]].map(Number) as [number, number, number, number];
  const startsAt = belgradeLocalToUtc(date.year, date.month, date.day, sh, sm);
  let endsAt = belgradeLocalToUtc(date.year, date.month, date.day, eh, em);
  if (endsAt.getTime() <= startsAt.getTime()) {
    endsAt = belgradeLocalToUtc(date.year, date.month, date.day + 1, eh, em);
  }
  return { startsAt, endsAt };
}
