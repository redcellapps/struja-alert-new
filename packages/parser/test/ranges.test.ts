import { describe, expect, it } from 'vitest';
import { parseRangePiece, parseRanges } from '../src/index.ts';

describe('house ranges (BRIEF §3)', () => {
  it('parses N-MX with a Cyrillic suffix', () => {
    expect(parseRangePiece('26-32В')).toMatchObject({
      from: 26,
      to: 32,
      fromSuffix: null,
      toSuffix: 'В',
      raw: '26-32В',
    });
  });
  it('parses a single number with a suffix as from = to', () => {
    expect(parseRangePiece('35В')).toMatchObject({ from: 35, to: 35, toSuffix: 'В' });
    expect(parseRangePiece('17')).toMatchObject({ from: 17, to: 17 });
  });
  it('parses a range with a suffix on the start', () => {
    expect(parseRangePiece('1-7А')).toMatchObject({ from: 1, to: 7, toSuffix: 'А' });
  });
  it('recognizes бб (no number) in its spellings', () => {
    for (const s of ['бб', 'ББ', 'б.б.', 'bb']) expect(parseRangePiece(s)?.bb).toBe(true);
  });
  it('reads parity in words, with or without бр.', () => {
    expect(parseRangePiece('непарни бр. 9-53')).toMatchObject({ parity: 'odd', from: 9, to: 53 });
    expect(parseRangePiece('парни бр. 30-44')).toMatchObject({ parity: 'even', from: 30, to: 44 });
    expect(parseRangePiece('парни')).toMatchObject({ parity: 'even', from: null, to: null });
  });
  it('does not mistake a street name for a range', () => {
    expect(parseRangePiece('12. ФЕБРУАРА')).toBeNull();
    expect(parseRangePiece('Миријевска')).toBeNull();
    expect(parseRangePiece('')).toBeNull();
  });
  it('parses comma-separated lists', () => {
    expect(parseRanges('41,бб').map((r) => r.raw)).toEqual(['41', 'бб']);
    expect(parseRanges('непарни бр. 9-53, парни бр. 30-44')).toHaveLength(2);
  });
});
