import { describe, expect, it } from 'vitest';
import { currentSlot, manualSlot } from '../src/collector/slots.ts';

const at = (iso: string) => currentSlot(new Date(iso));

describe('currentSlot', () => {
  it('summer (CEST, UTC+2): 05:05Z is 07:05 local, inside the 07 slot', () => {
    expect(at('2026-10-24T05:05:00Z')).toEqual({ key: '2026-10-24-07', hour: 7 });
  });
  it('summer: 06:05Z is 08:05 local, outside every window', () => {
    expect(at('2026-10-24T06:05:00Z')).toBeNull();
  });
  it('winter (CET, UTC+1): 06:05Z is 07:05 local, inside the 07 slot', () => {
    expect(at('2026-10-26T06:05:00Z')).toEqual({ key: '2026-10-26-07', hour: 7 });
  });
  it('winter: 05:05Z is 06:05 local, outside', () => {
    expect(at('2026-10-26T05:05:00Z')).toBeNull();
  });
  it('tolerates a delayed cron run up to the end of the hour, not past it', () => {
    expect(at('2026-10-26T06:59:00Z')?.key).toBe('2026-10-26-07');
    expect(at('2026-10-26T07:00:00Z')).toBeNull();
  });
  it('covers 13:00 and 19:00 slots on both sides of the DST change (25 Oct 2026)', () => {
    expect(at('2026-10-24T11:10:00Z')?.key).toBe('2026-10-24-13');
    expect(at('2026-10-26T12:10:00Z')?.key).toBe('2026-10-26-13');
    expect(at('2026-10-24T17:10:00Z')?.key).toBe('2026-10-24-19');
    expect(at('2026-10-26T18:10:00Z')?.key).toBe('2026-10-26-19');
  });
  it('uses the Belgrade date, not the UTC date, in the key', () => {
    expect(at('2026-10-24T22:30:00Z')).toBeNull();
    expect(at('2026-12-31T18:10:00Z')?.key).toBe('2026-12-31-19');
  });
});

describe('manualSlot', () => {
  it('has its own key and ignores the window', () => {
    expect(manualSlot(new Date('2026-10-24T09:15:30Z')).key).toBe('manual-20261024T0915Z');
  });
});
