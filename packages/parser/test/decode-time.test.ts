import { describe, expect, it } from 'vitest';
import {
  belgradeLocalToUtc,
  decodePage,
  decodeWindows1251,
  parsePageDate,
  parseTimeWindow,
} from '../src/index.ts';

describe('decodePage', () => {
  it('decodes UTF-8 and strips the BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('НИШ')]);
    expect(decodePage(bytes)).toEqual({ text: 'НИШ', encoding: 'utf-8' });
  });
  it('falls back to windows-1251 when the bytes are not valid UTF-8', () => {
    // "Нишка" in windows-1251
    const bytes = new Uint8Array([0xcd, 0xe8, 0xf8, 0xea, 0xe0]);
    expect(decodePage(bytes)).toEqual({ text: 'Нишка', encoding: 'windows-1251' });
  });
  it('maps the Serbian-specific windows-1251 letters', () => {
    const bytes = new Uint8Array([
      0x80, 0x9e, 0x9f, 0xbc, 0x9a, 0x9c, 0x8a, 0x8c, 0x8e, 0x8f, 0xa3,
    ]);
    expect(decodeWindows1251(bytes)).toBe('ЂћџјљњЉЊЋЏЈ');
  });
});

describe('Europe/Belgrade time', () => {
  it('uses UTC+2 in summer and UTC+1 in winter', () => {
    expect(belgradeLocalToUtc(2026, 10, 22, 8, 30).toISOString()).toBe('2026-10-22T06:30:00.000Z');
    expect(belgradeLocalToUtc(2026, 12, 1, 8, 30).toISOString()).toBe('2026-12-01T07:30:00.000Z');
  });
  it('switches on the last Sunday of October (25 Oct 2026)', () => {
    expect(belgradeLocalToUtc(2026, 10, 24, 8, 0).toISOString()).toBe('2026-10-24T06:00:00.000Z');
    expect(belgradeLocalToUtc(2026, 10, 26, 8, 0).toISOString()).toBe('2026-10-26T07:00:00.000Z');
  });
  it('switches on the last Sunday of March (29 Mar 2026)', () => {
    expect(belgradeLocalToUtc(2026, 3, 28, 8, 0).toISOString()).toBe('2026-03-28T07:00:00.000Z');
    expect(belgradeLocalToUtc(2026, 3, 30, 8, 0).toISOString()).toBe('2026-03-30T06:00:00.000Z');
  });
});

describe('parsePageDate / parseTimeWindow', () => {
  it('reads the Cyrillic header date and the ISO form', () => {
    expect(parsePageDate('НИШ - Планирана искључења за датум: 09.08.2026.')).toEqual({
      year: 2026,
      month: 8,
      day: 9,
    });
    expect(parsePageDate('Београд 2026-08-10')).toEqual({ year: 2026, month: 8, day: 10 });
    expect(parsePageDate('nothing')).toBeNull();
  });
  it('turns a window into UTC instants', () => {
    const w = parseTimeWindow('08:30 - 12:30', { year: 2026, month: 10, day: 22 });
    expect(w?.startsAt.toISOString()).toBe('2026-10-22T06:30:00.000Z');
    expect(w?.endsAt.toISOString()).toBe('2026-10-22T10:30:00.000Z');
  });
  it('ends the next day when the window crosses midnight', () => {
    const w = parseTimeWindow('22:00 - 02:00', { year: 2026, month: 10, day: 22 });
    expect(w?.endsAt.toISOString()).toBe('2026-10-23T00:00:00.000Z');
  });
  it('returns null for text without a window', () => {
    expect(parseTimeWindow('uskoro', { year: 2026, month: 1, day: 1 })).toBeNull();
  });
});
