import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkDay, dayToCheck, describeDay, isAlarm } from '../src/collector/watch.ts';

const branch = (slots: string[]) => {
  const dir = mkdtempSync(join(tmpdir(), 'struja-watch-'));
  for (const key of slots) {
    mkdirSync(join(dir, 'eds', key), { recursive: true });
    writeFileSync(join(dir, 'eds', key, '_slot.json'), '{}');
  }
  return dir;
};

describe('the collector watchdog', () => {
  it('checks the last whole Belgrade day', () => {
    expect(dayToCheck(new Date('2026-10-31T00:30:00Z'))).toBe('2026-10-30'); // 01:30 local, 31 Oct
    expect(dayToCheck(new Date('2026-10-30T23:30:00Z'))).toBe('2026-10-30'); // 00:30 local, 31 Oct
  });

  it('counts the slots that have a marker, and names the missing ones', () => {
    const dir = branch([
      '2026-10-29-19',
      '2026-10-30-07',
      '2026-10-30-19',
      'manual-20261030T1200Z',
    ]);
    expect(checkDay(dir, '2026-10-30')).toEqual({
      date: '2026-10-30',
      present: ['2026-10-30-07', '2026-10-30-19'],
      missing: ['2026-10-30-13'],
    });
    expect(describeDay(checkDay(dir, '2026-10-30'))).toBe(
      '2026-10-30: 2 of 3 slots collected (2026-10-30-07, 2026-10-30-19); missing 2026-10-30-13: enough.',
    );
    expect(isAlarm(checkDay(dir, '2026-10-30'))).toBe(false);
  });

  it('alarms on a day with fewer than two slots (the owner’s threshold), not only on none', () => {
    const one = checkDay(branch(['2026-10-30-19']), '2026-10-30');
    expect(isAlarm(one)).toBe(true);
    expect(describeDay(one)).toBe(
      '2026-10-30: 1 of 3 slots collected (2026-10-30-19); missing 2026-10-30-07, 2026-10-30-13: fewer than 2.',
    );
    expect(isAlarm(checkDay(branch(['2026-10-30-07', '2026-10-30-13', '2026-10-30-19']), '2026-10-30'))).toBe(false);
  });

  it('reports a day with nothing collected', () => {
    const dir = branch(['2026-10-29-19']);
    const r = checkDay(dir, '2026-10-30');
    expect(r.present).toEqual([]);
    expect(isAlarm(r)).toBe(true);
    expect(describeDay(r)).toBe(
      'No EDS fixtures were collected on 2026-10-30 (missing: 2026-10-30-07, 2026-10-30-13, 2026-10-30-19).',
    );
  });
});
