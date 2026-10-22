import { describe, expect, it } from 'vitest';
import {
  matchSubscription,
  SAFETY_NET_MIN_SCORE,
  type OutageStreetRow,
  type SubscriptionTarget,
} from '../src/notify/match.ts';

const sub = (over: Partial<SubscriptionTarget> = {}): SubscriptionTarget => ({
  streetId: 7,
  settlementId: null,
  houseNumber: null,
  ...over,
});

const row = (over: Partial<OutageStreetRow> = {}): OutageStreetRow => ({
  segmentIndex: 0,
  streetId: 7,
  settlementId: null,
  partial: false,
  houseFrom: null,
  houseTo: null,
  houseRaw: null,
  parity: null,
  resolvedBy: 'exact',
  candidates: null,
  ...over,
});

describe('whole streets and parts of streets', () => {
  it('a whole street affects everyone on it, with or without a house number', () => {
    expect(matchSubscription(sub(), [row()])).toEqual({ kind: 'affected' });
    expect(matchSubscription(sub({ houseNumber: 12 }), [row()])).toEqual({ kind: 'affected' });
  });
  it('"делови X" without numbers is only "possibly affected" (which parts is unknown)', () => {
    expect(matchSubscription(sub({ houseNumber: 12 }), [row({ partial: true })])).toEqual({
      kind: 'possible',
      reason: 'partial',
    });
  });
  it('another street is not a match', () => {
    expect(matchSubscription(sub({ streetId: 99 }), [row()])).toBeNull();
  });
});

describe('house ranges', () => {
  const r2630 = row({ houseFrom: 26, houseTo: 32, houseRaw: '26-32В' });
  it('a number inside the range is affected, outside is not', () => {
    expect(matchSubscription(sub({ houseNumber: 30 }), [r2630])).toEqual({ kind: 'affected' });
    expect(matchSubscription(sub({ houseNumber: 26 }), [r2630])).toEqual({ kind: 'affected' });
    expect(matchSubscription(sub({ houseNumber: 32 }), [r2630])).toEqual({ kind: 'affected' });
    expect(matchSubscription(sub({ houseNumber: 33 }), [r2630])).toBeNull();
    expect(matchSubscription(sub({ houseNumber: 25 }), [r2630])).toBeNull();
  });
  it('no house number on a ranged segment is "possibly affected"', () => {
    expect(matchSubscription(sub(), [r2630])).toEqual({ kind: 'possible', reason: 'no_number' });
  });
  it('respects parity: непарни бр. 9-53, парни бр. 30-44 (a real Niš row)', () => {
    const rows = [
      row({ houseFrom: 9, houseTo: 53, houseRaw: 'непарни бр. 9-53', parity: 'odd' }),
      row({ houseFrom: 30, houseTo: 44, houseRaw: 'парни бр. 30-44', parity: 'even' }),
    ];
    expect(matchSubscription(sub({ houseNumber: 31 }), rows)).toEqual({ kind: 'affected' });
    expect(matchSubscription(sub({ houseNumber: 32 }), rows)).toEqual({ kind: 'affected' });
    expect(matchSubscription(sub({ houseNumber: 10 }), rows)).toBeNull(); // even, below 30
    expect(matchSubscription(sub({ houseNumber: 55 }), rows)).toBeNull(); // odd, above 53
    expect(matchSubscription(sub({ houseNumber: 46 }), rows)).toBeNull(); // even, above 44
  });
  it('a parity word alone covers every odd/even number', () => {
    const rows = [row({ houseRaw: 'парни', parity: 'even' })];
    expect(matchSubscription(sub({ houseNumber: 8 }), rows)).toEqual({ kind: 'affected' });
    expect(matchSubscription(sub({ houseNumber: 9 }), rows)).toBeNull();
  });
  it('"(41,бб)": a numbered house matches only its number; бб does not match a number', () => {
    const rows = [row({ houseFrom: 41, houseTo: 41, houseRaw: '41' }), row({ houseRaw: 'бб' })];
    expect(matchSubscription(sub({ houseNumber: 41 }), rows)).toEqual({ kind: 'affected' });
    expect(matchSubscription(sub({ houseNumber: 50 }), rows)).toBeNull();
    expect(matchSubscription(sub(), rows)).toEqual({ kind: 'possible', reason: 'no_number' });
  });
  it('a partial segment with ranges still decides by the ranges', () => {
    const rows = [row({ partial: true, houseFrom: 1, houseTo: 9, houseRaw: '1-9' })];
    expect(matchSubscription(sub({ houseNumber: 5 }), rows)).toEqual({ kind: 'affected' });
    expect(matchSubscription(sub({ houseNumber: 20 }), rows)).toBeNull();
  });
});

describe('several segments: the strongest result wins', () => {
  it('affected beats possible', () => {
    const rows = [row({ segmentIndex: 0, partial: true }), row({ segmentIndex: 1 })];
    expect(matchSubscription(sub(), rows)).toEqual({ kind: 'affected' });
  });
  it('a street mentioned twice is checked in both segments', () => {
    const rows = [
      row({ segmentIndex: 0, houseFrom: 1, houseTo: 9, houseRaw: '1-9' }),
      row({ segmentIndex: 1, houseFrom: 20, houseTo: 30, houseRaw: '20-30' }),
    ];
    expect(matchSubscription(sub({ houseNumber: 25 }), rows)).toEqual({ kind: 'affected' });
  });
});

describe('settlements', () => {
  it('a villager matches the settlement segment', () => {
    const rows = [row({ streetId: null, settlementId: 3 })];
    expect(matchSubscription(sub({ streetId: null, settlementId: 3 }), rows)).toEqual({
      kind: 'affected',
    });
    expect(matchSubscription(sub({ streetId: null, settlementId: 4 }), rows)).toBeNull();
  });
  it('"део села X" is only possibly affected', () => {
    const rows = [row({ streetId: null, settlementId: 3, partial: true })];
    expect(matchSubscription(sub({ streetId: null, settlementId: 3 }), rows)).toEqual({
      kind: 'possible',
      reason: 'partial',
    });
  });
});

describe('the 12-hour safety net: segments that were never resolved', () => {
  const unresolved = (score: number) =>
    row({
      streetId: null,
      resolvedBy: 'unresolved',
      candidates: [
        { id: 7, name: 'Војводе Мишића', score },
        { id: 8, name: 'Живојина Мишића', score: 0.3 },
      ],
    });
  it('is off by default', () => {
    expect(matchSubscription(sub(), [unresolved(0.9)])).toBeNull();
  });
  it('notifies a user whose street is a candidate scoring at least 0.6, as "possibly affected"', () => {
    expect(SAFETY_NET_MIN_SCORE).toBe(0.6);
    expect(matchSubscription(sub(), [unresolved(0.6)], { safetyNet: true })).toEqual({
      kind: 'possible',
      reason: 'unresolved',
    });
    expect(matchSubscription(sub(), [unresolved(0.9)], { safetyNet: true })?.kind).toBe('possible');
  });
  it('does not notify below 0.6, or a user on another candidate below the bar', () => {
    expect(matchSubscription(sub(), [unresolved(0.59)], { safetyNet: true })).toBeNull();
    expect(
      matchSubscription(sub({ streetId: 8 }), [unresolved(0.9)], { safetyNet: true }),
    ).toBeNull();
  });
  it('ignores resolved segments (they are not "unresolved")', () => {
    const resolved = row({
      streetId: 99,
      resolvedBy: 'exact',
      candidates: [{ id: 7, score: 0.9 }],
    });
    expect(matchSubscription(sub(), [resolved], { safetyNet: true })).toBeNull();
  });
});
