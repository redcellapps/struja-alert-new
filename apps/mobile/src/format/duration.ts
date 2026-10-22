// Countdown and duration helpers. Pure functions: the components pass in `now`.

export interface Parts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  negative: boolean;
}

export function splitMs(ms: number): Parts {
  const negative = ms < 0;
  const total = Math.floor(Math.abs(ms) / 1000);
  return {
    negative,
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "1:12:05" or "12:05" (with hours only when there are any), tabular-friendly digits only. */
export function clock(ms: number): string {
  const p = splitMs(ms);
  const h = p.days * 24 + p.hours;
  return h > 0 ? `${h}:${pad(p.minutes)}:${pad(p.seconds)}` : `${pad(p.minutes)}:${pad(p.seconds)}`;
}

/** Whole minutes, rounded up: an outage that ends in 12 min 10 s reads as 13 min. */
export function wholeMinutes(ms: number): number {
  return Math.max(0, Math.ceil(ms / 60_000));
}

export interface HourMinute {
  hours: number;
  minutes: number;
}

export function hoursAndMinutes(ms: number): HourMinute {
  const m = wholeMinutes(ms);
  return { hours: Math.floor(m / 60), minutes: m % 60 };
}
