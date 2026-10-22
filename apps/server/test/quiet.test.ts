import { describe, expect, it } from 'vitest';
import { isQuiet, planDelivery, quietEnd, parseQuietHours } from '../src/notify/quiet.ts';

const Q = { start: '22:00', end: '07:00' };
// 22 Oct 2026 is CEST (UTC+2): 20:00Z = 22:00 local.
const local = (iso: string) => new Date(iso);

describe('isQuiet', () => {
  it('is quiet between 22:00 and 07:00 Belgrade time, which wraps midnight', () => {
    expect(isQuiet(local('2026-10-22T19:59:00Z'), Q)).toBe(false); // 21:59
    expect(isQuiet(local('2026-10-22T20:00:00Z'), Q)).toBe(true); // 22:00
    expect(isQuiet(local('2026-10-22T23:30:00Z'), Q)).toBe(true); // 01:30
    expect(isQuiet(local('2026-10-23T04:59:00Z'), Q)).toBe(true); // 06:59
    expect(isQuiet(local('2026-10-23T05:00:00Z'), Q)).toBe(false); // 07:00
  });
  it('follows winter time too (UTC+1)', () => {
    expect(isQuiet(local('2026-12-01T21:00:00Z'), Q)).toBe(true); // 22:00
    expect(isQuiet(local('2026-12-01T20:59:00Z'), Q)).toBe(false);
  });
  it('supports a user-edited window that does not wrap', () => {
    const noon = { start: '13:00', end: '15:00' };
    expect(isQuiet(local('2026-10-22T11:30:00Z'), noon)).toBe(true); // 13:30
    expect(isQuiet(local('2026-10-22T13:00:00Z'), noon)).toBe(false); // 15:00
  });
  it('an empty window (start = end) is never quiet', () => {
    expect(isQuiet(local('2026-10-22T23:00:00Z'), { start: '22:00', end: '22:00' })).toBe(false);
  });
});

describe('quietEnd', () => {
  it('before midnight, the window ends the next morning at 07:00', () => {
    expect(quietEnd(local('2026-10-22T21:00:00Z'), Q).toISOString()).toBe(
      '2026-10-23T05:00:00.000Z',
    );
  });
  it('after midnight, the window ends the same morning at 07:00', () => {
    expect(quietEnd(local('2026-10-22T23:30:00Z'), Q).toISOString()).toBe(
      '2026-10-23T05:00:00.000Z',
    );
  });
  it('across the autumn clock change the end is 07:00 local on the new offset', () => {
    // 24 Oct 21:00Z = 23:00 CEST; the next 07:00 is on 25 Oct (still CEST until 01:00Z)... 05:00Z
    expect(quietEnd(local('2026-10-24T21:00:00Z'), Q).toISOString()).toBe(
      '2026-10-25T06:00:00.000Z',
    );
  });
});

describe('planDelivery', () => {
  const night = local('2026-10-22T21:30:00Z'); // 23:30 local
  it('holds a notification planned in quiet hours until they end', () => {
    const d = planDelivery(night, local('2026-10-23T08:00:00Z'), Q); // outage 10:00 tomorrow
    expect(d.urgent).toBe(false);
    expect(d.deliverAt.toISOString()).toBe('2026-10-23T05:00:00.000Z');
  });
  it('delivers right away outside quiet hours', () => {
    const noon = local('2026-10-22T10:00:00Z');
    expect(planDelivery(noon, local('2026-10-24T08:00:00Z'), Q)).toEqual({
      deliverAt: noon,
      urgent: false,
    });
  });
  it('an outage starting within 2 hours is urgent and ignores quiet hours', () => {
    const d = planDelivery(night, local('2026-10-22T23:00:00Z'), Q); // starts in 1.5h
    expect(d).toEqual({ deliverAt: night, urgent: true });
  });
  it('exactly 2 hours away is still urgent, 2h01 is not', () => {
    expect(planDelivery(night, new Date(night.getTime() + 2 * 3600_000), Q).urgent).toBe(true);
    expect(planDelivery(night, new Date(night.getTime() + 2 * 3600_000 + 60_000), Q).urgent).toBe(
      false,
    );
  });
});

describe('parseQuietHours', () => {
  it('falls back to the default 22:00-07:00', () => {
    expect(parseQuietHours(null)).toEqual(Q);
    expect(parseQuietHours({ nonsense: true })).toEqual(Q);
    expect(parseQuietHours({ start: '23:00', end: '06:30' })).toEqual({
      start: '23:00',
      end: '06:30',
    });
  });
});
