import { clock, hoursAndMinutes, splitMs, wholeMinutes } from '../src/format/duration';
import { addDays, belgradeDate, dayHour, dayOfMonth, hhmm, weekdayIndex } from '../src/format/time';

describe('duration', () => {
  it('splits milliseconds', () => {
    expect(splitMs(90_061_000)).toEqual({
      negative: false,
      days: 1,
      hours: 1,
      minutes: 1,
      seconds: 1,
    });
    expect(splitMs(-5000).negative).toBe(true);
  });

  it('formats a clock with hours only when there are any', () => {
    expect(clock((1 * 60 + 12) * 60_000 + 5000)).toBe('1:12:05');
    expect(clock(12 * 60_000 + 9000)).toBe('12:09');
    expect(clock(26 * 3600_000)).toBe('26:00:00');
    expect(clock(0)).toBe('00:00');
  });

  it('rounds minutes up and splits hours and minutes', () => {
    expect(wholeMinutes(12 * 60_000 + 10_000)).toBe(13);
    expect(wholeMinutes(-1)).toBe(0);
    expect(hoursAndMinutes(72 * 60_000)).toEqual({ hours: 1, minutes: 12 });
  });
});

describe('Belgrade time', () => {
  it('shows UTC instants in Europe/Belgrade, winter and summer', () => {
    expect(hhmm('2026-11-03T07:30:00Z')).toBe('08:30'); // CET
    expect(hhmm('2026-10-22T06:30:00Z')).toBe('08:30'); // CEST
    expect(dayHour('2026-11-03T07:30:00Z')).toBe(8.5);
  });

  it('knows the Belgrade date across midnight', () => {
    expect(belgradeDate(new Date('2026-11-03T23:30:00Z'))).toBe('2026-11-04');
  });

  it('adds days and finds weekdays (Monday = 0)', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(weekdayIndex('2026-11-03')).toBe(1); // Tuesday
    expect(weekdayIndex('2026-11-08')).toBe(6); // Sunday
    expect(dayOfMonth('2026-11-03')).toBe(3);
  });
});
