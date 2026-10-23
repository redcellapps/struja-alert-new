import type { AddressOutageDto } from '@struja/shared';
import { daysWithOutage, outlookForDay, outlookFromNow, statusAt } from '../src/home/outlook';

// Belgrade is UTC+1 in November (no summer time), so 08:30 local is 07:30Z.
const at = (iso: string) => new Date(iso);
const NOW = at('2026-11-03T05:00:00Z'); // 06:00 in Belgrade, Tuesday

let nextId = 1;
const outage = (
  startsAt: string,
  endsAt: string,
  extra: Partial<AddressOutageDto> = {},
): AddressOutageDto => ({
  id: nextId++,
  subscriptionId: 1,
  status: 'active',
  startsAt,
  endsAt,
  outageDate: startsAt.slice(0, 10),
  municipality: 'Медијана',
  revision: 0,
  match: 'affected',
  reason: null,
  ...extra,
});

describe('statusAt', () => {
  it('is active inside the window, imminent within 24 h, upcoming beyond', () => {
    const start = Date.parse('2026-11-03T07:30:00Z');
    const end = Date.parse('2026-11-03T11:30:00Z');
    expect(statusAt(start, end, at('2026-11-03T07:30:00Z'))).toBe('active');
    expect(statusAt(start, end, at('2026-11-03T11:29:59Z'))).toBe('active');
    expect(statusAt(start, end, at('2026-11-03T11:30:00Z'))).toBe('imminent'); // over, not handled here
    expect(statusAt(start, end, at('2026-11-02T07:31:00Z'))).toBe('imminent');
    expect(statusAt(start, end, at('2026-11-02T07:30:00Z'))).toBe('upcoming');
  });
});

describe('outlookFromNow', () => {
  it('is clear with no outages', () => {
    expect(outlookFromNow([], NOW)).toMatchObject({ status: 'clear', outage: null });
  });

  it('is imminent when the next outage starts within 24 hours', () => {
    const o = outage('2026-11-03T07:30:00Z', '2026-11-03T11:30:00Z');
    expect(outlookFromNow([o], NOW)).toMatchObject({ status: 'imminent', outage: o });
  });

  it('is upcoming when it starts more than 24 hours away', () => {
    const o = outage('2026-11-04T07:30:00Z', '2026-11-04T11:30:00Z');
    expect(outlookFromNow([o], NOW).status).toBe('upcoming');
  });

  it('is active while the window is running, and carries its end', () => {
    const o = outage('2026-11-03T04:00:00Z', '2026-11-03T08:00:00Z');
    const got = outlookFromNow([o], NOW);
    expect(got.status).toBe('active');
    expect(got.endsMs).toBe(Date.parse('2026-11-03T08:00:00Z'));
  });

  it('ignores outages that are over, and picks the earliest of those still ahead', () => {
    const over = outage('2026-11-02T07:30:00Z', '2026-11-02T11:30:00Z');
    const later = outage('2026-11-05T07:30:00Z', '2026-11-05T11:30:00Z');
    const sooner = outage('2026-11-04T07:30:00Z', '2026-11-04T11:30:00Z');
    expect(outlookFromNow([over, later, sooner], NOW).outage).toBe(sooner);
    expect(outlookFromNow([over], NOW).status).toBe('clear');
  });

  it('shows a cancelled outage as past only when nothing live is left', () => {
    const cancelled = outage('2026-11-03T07:30:00Z', '2026-11-03T11:30:00Z', {
      status: 'cancelled',
    });
    expect(outlookFromNow([cancelled], NOW)).toMatchObject({ status: 'past', outage: cancelled });
    const live = outage('2026-11-05T07:30:00Z', '2026-11-05T11:30:00Z');
    expect(outlookFromNow([cancelled, live], NOW).outage).toBe(live);
  });

  it('keeps a changed outage live, and flags "possible" matches', () => {
    const o = outage('2026-11-03T07:30:00Z', '2026-11-03T11:30:00Z', {
      status: 'changed',
      match: 'possible',
      reason: 'no_number',
    });
    expect(outlookFromNow([o], NOW)).toMatchObject({ status: 'imminent', possible: true });
  });
});

describe('outlookForDay', () => {
  const tomorrow = outage('2026-11-04T07:30:00Z', '2026-11-04T11:30:00Z');
  const friday = outage('2026-11-06T08:00:00Z', '2026-11-06T12:00:00Z');

  it('uses "from now" for today', () => {
    expect(outlookForDay([tomorrow], '2026-11-03', NOW).outage).toBe(tomorrow);
  });

  it('looks at one chosen day only, clear when it has none', () => {
    expect(outlookForDay([tomorrow, friday], '2026-11-06', NOW).outage).toBe(friday);
    expect(outlookForDay([tomorrow, friday], '2026-11-05', NOW).status).toBe('clear');
  });

  it('a chosen day with only a cancelled outage is past', () => {
    const cancelled = { ...friday, status: 'cancelled' as const };
    expect(outlookForDay([cancelled], '2026-11-06', NOW).status).toBe('past');
  });
});

describe('daysWithOutage', () => {
  it('marks days with an announced outage, not cancelled ones or days outside the strip', () => {
    const days = ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];
    const list = [
      outage('2026-11-04T07:30:00Z', '2026-11-04T11:30:00Z'),
      outage('2026-11-05T07:30:00Z', '2026-11-05T11:30:00Z', { status: 'cancelled' }),
      outage('2026-11-09T07:30:00Z', '2026-11-09T11:30:00Z'),
    ];
    expect([...daysWithOutage(list, days)]).toEqual(['2026-11-04']);
  });
});
