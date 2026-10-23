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

/**
 * How long is left, in hours and minutes: "1 h 12 min", "1 h", "45 min", and `lessThanMinute` under
 * a minute. Minutes are rounded up (an outage that ends in 12 min 10 s reads as 13 min), as the spoken
 * form is; the screens read it from a clock that ticks once a minute.
 */
export function remainingLabel(ms: number, lessThanMinute: string): string {
  if (ms < 60_000) return lessThanMinute;
  const { hours, minutes } = hoursAndMinutes(ms);
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}
