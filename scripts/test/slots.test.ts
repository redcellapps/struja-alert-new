import { describe, expect, it } from 'vitest';
import { currentSlot, manualSlot, shiftDate, slotsOfDay } from '../src/collector/slots.ts';

const at = (iso: string) => currentSlot(new Date(iso));

describe('currentSlot', () => {
  it('summer (CEST, UTC+2): 05:05Z is 07:05 local, the 07 slot', () => {
    expect(at('2026-10-24T05:05:00Z')).toEqual({ key: '2026-10-24-07', hour: 7 });
  });
  it('winter (CET, UTC+1): 06:05Z is 07:05 local, the 07 slot', () => {
    expect(at('2026-10-26T06:05:00Z')).toEqual({ key: '2026-10-26-07', hour: 7 });
  });
  it('a slot lasts until the next one begins: a cron run hours late still collects it', () => {
    // GitHub fired the 07 run at 10:56 local on 26 Oct and the 13 run at 16:26 on 27 Oct.
    expect(at('2026-10-26T09:56:00Z')?.key).toBe('2026-10-26-07');
    expect(at('2026-10-27T15:26:00Z')?.key).toBe('2026-10-27-13');
    expect(at('2026-10-26T11:59:00Z')?.key).toBe('2026-10-26-07');
    expect(at('2026-10-26T12:00:00Z')?.key).toBe('2026-10-26-13');
    expect(at('2026-10-26T17:59:00Z')?.key).toBe('2026-10-26-13');
    expect(at('2026-10-26T18:00:00Z')?.key).toBe('2026-10-26-19');
  });
  it('before 07:00 the running slot is the previous evening’s 19', () => {
    expect(at('2026-10-26T05:05:00Z')).toEqual({ key: '2026-10-25-19', hour: 19 }); // 06:05 local
    expect(at('2026-10-26T22:30:00Z')?.key).toBe('2026-10-26-19'); // 23:30 local
    expect(at('2026-11-01T00:30:00Z')?.key).toBe('2026-10-31-19'); // 01:30 local, 1 Nov
  });
  it('covers 13:00 and 19:00 on both sides of the DST change (25 Oct 2026)', () => {
    expect(at('2026-10-24T11:10:00Z')?.key).toBe('2026-10-24-13');
    expect(at('2026-10-26T12:10:00Z')?.key).toBe('2026-10-26-13');
    expect(at('2026-10-24T17:10:00Z')?.key).toBe('2026-10-24-19');
    expect(at('2026-10-26T18:10:00Z')?.key).toBe('2026-10-26-19');
  });
  it('uses the Belgrade date, not the UTC date, in the key', () => {
    expect(at('2026-12-31T18:10:00Z')?.key).toBe('2026-12-31-19');
    expect(at('2026-12-31T23:30:00Z')?.key).toBe('2026-12-31-19'); // 00:30 on 1 Jan local
  });
});

describe('slotsOfDay and shiftDate', () => {
  it('names the three slots of a day and steps across month ends', () => {
    expect(slotsOfDay('2026-10-31')).toEqual(['2026-10-31-07', '2026-10-31-13', '2026-10-31-19']);
    expect(shiftDate('2026-11-01', -1)).toBe('2026-10-31');
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('manualSlot', () => {
  it('has its own key and ignores the slot rule', () => {
    expect(manualSlot(new Date('2026-10-24T09:15:30Z')).key).toBe('manual-20261024T0915Z');
  });
});
