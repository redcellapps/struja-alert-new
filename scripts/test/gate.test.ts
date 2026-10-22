import { describe, expect, it } from 'vitest';
import { aliasSeed, toCsv, type LabelRow } from '../src/labels/build.ts';
import { csvCell, parseCsv, readReviewed } from '../src/labels/csv.ts';
import { formatVerdict, measureGate, wilsonLower } from '../src/labels/gate.ts';

const row = (over: Partial<LabelRow> = {}): LabelRow => ({
  key: 'k',
  first_seen: 's1',
  last_seen: 's1',
  seen_in_snapshots: 1,
  date: '2026-10-22',
  ogranak: 'Ниш',
  opstina: 'Пантелеј',
  in_scope: true,
  raw_segment: 'Студеничке',
  segment_name: 'Студеничке',
  ranges: '',
  kind: 'street',
  proposed: 'Студеничка',
  resolved_by: 'form',
  score: '',
  candidates: '',
  ...over,
});

describe('csv', () => {
  it('round-trips quotes, commas and newlines', () => {
    const cells = ['a,b', 'say "hi"', 'two\nlines', 'plain'];
    const parsed = parseCsv(cells.map(csvCell).join(',') + '\n');
    expect(parsed).toEqual([cells]);
  });
});

describe('regenerating labels.csv never loses a review', () => {
  it('carries confirmed/notes over by municipality + raw segment', () => {
    const first = toCsv([row()]);
    const reviewed = first.replace(/,,\n$/, ',ok,checked by me\n');
    const again = toCsv([row({ seen_in_snapshots: 5 })], reviewed);
    expect([...readReviewed(again).values()]).toEqual([
      { confirmed: 'ok', notes: 'checked by me' },
    ]);
  });
  it('keeps a reviewed row that is no longer in the collected pages', () => {
    const reviewed = toCsv([row()]).replace(/,,\n$/, ',ok,\n');
    const again = toCsv([row({ raw_segment: 'Друга', opstina: 'Медијана' })], reviewed);
    expect(again.split('\n').filter(Boolean)).toHaveLength(3); // header + new row + kept row
    expect(readReviewed(again).get('Пантелеј|Студеничке')?.confirmed).toBe('ok');
  });
  it('does not keep unreviewed rows that vanished', () => {
    const again = toCsv([row({ raw_segment: 'Друга' })], toCsv([row()]));
    expect(again.split('\n').filter(Boolean)).toHaveLength(2);
  });
});

describe('aliasSeed keeps reviewed entries', () => {
  it('never replaces or drops an existing entry', () => {
    const existing = [
      {
        raw: 'Студеничке',
        raw_norm: 'studenicke',
        street: 'Студеничка',
        source: 'form',
        confidence: 1,
        reviewed: true,
        reviewed_at: '2026-10-22',
      },
    ];
    const seed = aliasSeed([row({ proposed: 'Нешто друго' })], existing);
    expect(seed).toEqual(existing);
  });
  it('adds new proposals unreviewed', () => {
    const seed = aliasSeed([row({ segment_name: 'Космајске', proposed: 'Космајска' })], []);
    expect(seed).toHaveLength(1);
    expect(seed[0]?.reviewed).toBeUndefined();
  });
});

describe('wilsonLower', () => {
  it('shows how little 10 of 10 proves', () => {
    expect(wilsonLower(10, 10)).toBeCloseTo(0.722, 2);
    expect(wilsonLower(200, 200)).toBeGreaterThan(0.98);
    expect(wilsonLower(0, 0)).toBe(0);
  });
});

describe('measureGate', () => {
  const csv = (rows: LabelRow[], confirmed: string[]) =>
    toCsv(rows)
      .split('\n')
      .map((line, i) =>
        i >= 1 && line ? line.replace(/,,$/, `,${confirmed[i - 1] ?? ''},`) : line,
      )
      .join('\n');

  it('counts only in-scope street segments, with the sample size', () => {
    const v = measureGate(
      csv(
        [
          row(),
          row({
            raw_segment: 'b',
            in_scope: false,
            kind: 'out_of_scope',
            proposed: '',
            resolved_by: '',
          }),
          row({ raw_segment: 'c', kind: 'village' }),
        ],
        ['ok', '', ''],
      ),
    );
    expect(v.inScopeStreetSegments).toBe(1);
    expect(v.confirmed).toBe(1);
    expect(v.status).toBe('INSUFFICIENT_SAMPLE');
  });
  it('is insufficient below 200 confirmed even when everything is right', () => {
    const v = measureGate(csv([row()], ['ok']));
    expect(v.precision).toBe(1);
    expect(v.status).toBe('INSUFFICIENT_SAMPLE');
    expect(formatVerdict(v)).toContain('1 confirmed');
  });
  it('treats a different street, or "none" with a proposal, as a wrong accept', () => {
    const v = measureGate(
      csv(
        [row(), row({ raw_segment: 'b' }), row({ raw_segment: 'c' }), row({ raw_segment: 'd' })],
        ['ok', 'Друга улица', 'none', 'Студеничка'],
      ),
    );
    expect(v.confirmedAutoAccepts).toBe(4);
    expect(v.correctAutoAccepts).toBe(2);
    expect(v.wrongAutoAccepts).toBe(2);
  });
  it('passes or fails at 200 confirmed by the two targets', () => {
    const many = (wrong: number) => {
      const rows = Array.from({ length: 200 }, (_, i) => row({ raw_segment: `s${i}` }));
      return measureGate(
        csv(
          rows,
          rows.map((_, i) => (i < wrong ? 'Друга улица' : 'ok')),
        ),
      );
    };
    expect(many(0).status).toBe('PASS');
    expect(many(1).status).toBe('PASS'); // 99.5% >= 99%
    expect(many(5).status).toBe('FAIL'); // 97.5% < 99%
  });
  it('fails on resolution below 95% even with perfect precision', () => {
    const rows = Array.from({ length: 200 }, (_, i) =>
      row({
        raw_segment: `s${i}`,
        proposed: i < 20 ? '' : 'Студеничка',
        resolved_by: i < 20 ? 'unresolved' : 'form',
      }),
    );
    expect(
      measureGate(
        csv(
          rows,
          rows.map(() => 'ok'),
        ),
      ).status,
    ).toBe('FAIL');
  });
});
