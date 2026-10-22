import { describe, expect, it } from 'vitest';
import { pairChanges, type PairRow } from '../src/ingest/pairing.ts';

const H = 3600_000;
const T0 = Date.UTC(2026, 9, 27, 6, 0); // 27 Oct 2026 06:00Z
let id = 1;
const row = (
  from: number,
  to: number,
  streets: string[] = ['studenicka'],
  over: Partial<PairRow> = {},
): PairRow => ({
  id: id++,
  identityKey: `Nis|pantelej|2026-10-27|${[...streets].sort().join(',')}`,
  municipality: 'pantelej',
  date: '2026-10-27',
  startsAt: new Date(T0 + from * H),
  endsAt: new Date(T0 + to * H),
  streets: new Set(streets),
  ...over,
});

describe('A: same identity, a changed time window', () => {
  it('pairs one new row with the one old row that left the page', () => {
    const o = row(2, 4);
    const n = row(3, 5);
    expect(pairChanges([n], [o])).toEqual({ pairs: [{ newId: n.id, oldId: o.id }], groups: [] });
  });

  it('with two outages of the same identity changing at once, pairs by the smallest time shift', () => {
    // morning 08-10 -> 09-11 (shift 2h total), afternoon 14-16 -> 14:30-16:30 (shift 1h total)
    const oldM = row(2, 4);
    const oldA = row(8, 10);
    const newM = row(3, 5);
    const newA = row(8.5, 10.5);
    const r = pairChanges([newM, newA], [oldM, oldA]);
    expect(r.groups).toEqual([]);
    expect(r.pairs).toHaveLength(2);
    expect(r.pairs).toContainEqual({ newId: newM.id, oldId: oldM.id });
    expect(r.pairs).toContainEqual({ newId: newA.id, oldId: oldA.id });
  });

  it('does not let a far-away pairing win just because it comes first', () => {
    // new1 is closer to old2 and new2 to old1: the cheapest assignment crosses the list order
    const old1 = row(2, 4);
    const old2 = row(8, 10);
    const new1 = row(8.5, 10.5);
    const new2 = row(2.5, 4.5);
    const r = pairChanges([new1, new2], [old1, old2]);
    expect(r.pairs).toContainEqual({ newId: new1.id, oldId: old2.id });
    expect(r.pairs).toContainEqual({ newId: new2.id, oldId: old1.id });
  });

  it('KNOWN GAP 1: if the best assignment is tied, forms ONE group instead of guessing', () => {
    // 08-10 and 10-12 both move 1h later: new 09-11 and 11-13. new 09-11 is equally far from
    // both olds (|1h|+|1h| vs |...|): a tie.
    const old1 = row(2, 4);
    const old2 = row(4, 6);
    const new1 = row(3, 5); // 1h from old1, 1h from old2
    const new2 = row(3, 5, ['studenicka'], {}); // identical window: indistinguishable
    const r = pairChanges([new1, new2], [old1, old2]);
    expect(r.pairs).toEqual([]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]?.newIds.sort()).toEqual([new1.id, new2.id].sort());
    expect(r.groups[0]?.oldIds.sort()).toEqual([old1.id, old2.id].sort());
  });

  it('leaves a leftover new row unpaired when there are fewer old rows (a genuinely new outage)', () => {
    const old = row(2, 4);
    const closer = row(2.5, 4.5);
    const extra = row(8, 10);
    const r = pairChanges([closer, extra], [old]);
    expect(r.pairs).toEqual([{ newId: closer.id, oldId: old.id }]);
    expect(r.groups).toEqual([]);
  });

  it('different identities never pair in A', () => {
    const o = row(2, 4, ['cegarska']);
    const n = row(3, 5, ['studenicka']);
    expect(pairChanges([n], [o])).toEqual({ pairs: [], groups: [] });
  });
});

describe('B: the street list was edited (same municipality, date and time window)', () => {
  it('pairs a row that gained a street with the one it grew from', () => {
    const o = row(2, 4, ['studenicka']);
    const n = row(2, 4, ['studenicka', 'cegarska']);
    expect(pairChanges([n], [o])).toEqual({ pairs: [{ newId: n.id, oldId: o.id }], groups: [] });
  });

  it('pairs a row that lost a street (the other direction)', () => {
    const o = row(2, 4, ['studenicka', 'cegarska']);
    const n = row(2, 4, ['studenicka']);
    expect(pairChanges([n], [o])).toEqual({ pairs: [{ newId: n.id, oldId: o.id }], groups: [] });
  });

  it('needs overlapping streets: a different street set is a new outage + a cancellation', () => {
    const o = row(2, 4, ['studenicka']);
    const n = row(2, 4, ['cegarska']);
    expect(pairChanges([n], [o])).toEqual({ pairs: [], groups: [] });
  });

  it('needs the same time window', () => {
    const o = row(2, 4, ['studenicka']);
    const n = row(3, 5, ['studenicka', 'cegarska']);
    expect(pairChanges([n], [o])).toEqual({ pairs: [], groups: [] });
  });

  it('needs the same municipality and date', () => {
    const o = row(2, 4, ['studenicka']);
    const other = row(2, 4, ['studenicka', 'cegarska'], { municipality: 'medijana' });
    expect(pairChanges([other], [o])).toEqual({ pairs: [], groups: [] });
  });

  it('chooses the best overlap when several olds could match, or forms a group on a tie', () => {
    const near = row(2, 4, ['a', 'b', 'c']);
    const far = row(2, 4, ['c', 'x', 'y', 'z']);
    const n = row(2, 4, ['a', 'b', 'c', 'd']);
    expect(pairChanges([n], [near, far]).pairs).toEqual([{ newId: n.id, oldId: near.id }]);

    const t1 = row(2, 4, ['a', 'x']);
    const t2 = row(2, 4, ['a', 'y']);
    const m = row(2, 4, ['a', 'z']);
    const tie = pairChanges([m], [t1, t2]);
    expect(tie.pairs).toEqual([]);
    expect(tie.groups).toHaveLength(1);
  });

  it('A takes priority: a changed time is never read as a street edit', () => {
    const o = row(2, 4, ['studenicka']);
    const sameStreetsNewTime = row(3, 5, ['studenicka']);
    expect(pairChanges([sameStreetsNewTime], [o]).pairs).toEqual([
      { newId: sameStreetsNewTime.id, oldId: o.id },
    ]);
  });
});

describe('bounds', () => {
  it('treats a huge bucket as ambiguous instead of enumerating', () => {
    const olds = Array.from({ length: 8 }, (_, i) => row(i, i + 1));
    const news = Array.from({ length: 8 }, (_, i) => row(i + 0.1, i + 1.1));
    const r = pairChanges(news, olds);
    expect(r.pairs).toEqual([]);
    expect(r.groups).toHaveLength(1);
  });
  it('does nothing without rows', () => {
    expect(pairChanges([], [])).toEqual({ pairs: [], groups: [] });
    expect(pairChanges([row(1, 2)], [])).toEqual({ pairs: [], groups: [] });
  });
});
