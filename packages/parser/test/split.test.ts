import { describe, expect, it } from 'vitest';
import { splitUlice } from '../src/index.ts';

const summary = (cell: string) =>
  splitUlice(cell).map((s) => ({
    name: s.name,
    settlement: s.settlement,
    partial: s.partial,
    village: s.village,
    ranges: s.ranges.map((r) => r.raw),
  }));

// Rows below are real EDS cells from the Niš / Belgrade fixtures (22 Oct 2026).
describe('splitUlice: Niš free text', () => {
  it('splits "делови A и B;" on и and drops the prefix', () => {
    expect(summary('делови Горњоматејевачке и Студеничке;')).toEqual([
      { name: 'Горњоматејевачке', settlement: null, partial: true, village: false, ranges: [] },
      { name: 'Студеничке', settlement: null, partial: true, village: false, ranges: [] },
    ]);
  });
  it('puts numbers in parentheses on the street, including бб', () => {
    expect(summary('делови Матејевачког пута (41,бб);')).toEqual([
      {
        name: 'Матејевачког пута',
        settlement: null,
        partial: true,
        village: false,
        ranges: ['41', 'бб'],
      },
    ]);
  });
  it('handles a Насеље block, Бул., and a parenthesized number', () => {
    expect(
      summary(
        'Насеље Никола Тесла - делови Бул. Светог Цара Константина, Друга Нишавска прилаз два (2);',
      ),
    ).toEqual([
      {
        name: 'Бул. Светог Цара Константина',
        settlement: 'Никола Тесла',
        partial: true,
        village: false,
        ranges: [],
      },
      {
        name: 'Друга Нишавска прилаз два',
        settlement: 'Никола Тесла',
        partial: true,
        village: false,
        ranges: ['2'],
      },
    ]);
  });
  it('reads parity in words inside parentheses', () => {
    const [seg] = splitUlice('делови Чегарске (непарни бр. 9-53, парни бр. 30-44);');
    expect(seg?.name).toBe('Чегарске');
    expect(seg?.ranges.map((r) => [r.parity, r.from, r.to])).toEqual([
      ['odd', 9, 53],
      ['even', 30, 44],
    ]);
  });
  it('strips "Део Ул." and keeps the raw segment', () => {
    const [seg] = splitUlice('Део Ул. Генерала Транијеа');
    expect(seg).toMatchObject({ name: 'Генерала Транијеа', partial: true });
    expect(seg?.raw).toBe('Део Ул. Генерала Транијеа');
  });
  it('treats a bare name as a whole street', () => {
    expect(summary('Александра Нагорног')).toEqual([
      { name: 'Александра Нагорног', settlement: null, partial: false, village: false, ranges: [] },
    ]);
  });
  it('splits several items on commas and semicolons', () => {
    expect(
      summary('делови Требињске, Војводе Путника, Космајске, Бубањске долине;').map((s) => s.name),
    ).toEqual(['Требињске', 'Војводе Путника', 'Космајске', 'Бубањске долине']);
    expect(summary('Пирот а; Б').map((s) => s.name)).toEqual(['Пирот а', 'Б']);
  });
  it('flags "Део села X" as a village', () => {
    expect(summary('део села Берин Извор,Грнчар.')).toEqual([
      { name: 'Берин Извор', settlement: null, partial: true, village: true, ranges: [] },
      { name: 'Грнчар', settlement: null, partial: true, village: true, ranges: [] },
    ]);
  });
  it('reads a "Насеља:" list as villages', () => {
    const segs = splitUlice('Насеља: Стара Брза и Купузиште са припадајућим викенд насељима.');
    expect(segs.map((s) => s.village)).toEqual([true, true]);
    expect(segs[0]?.name).toBe('Стара Брза');
  });
});

describe('splitUlice: Belgrade "STREET: ranges"', () => {
  it('attaches comma-separated numbers to the street before them', () => {
    expect(
      summary('Насеље М.МОКРИ ЛУГ: ГЕЦЕ КОНА: 4-26,1-7А,17,  МИРИЈЕВСКА: 3,  ЗЛАТИБОРСКА: 39,'),
    ).toEqual([
      {
        name: 'ГЕЦЕ КОНА',
        settlement: 'М.МОКРИ ЛУГ',
        partial: false,
        village: false,
        ranges: ['4-26', '1-7А', '17'],
      },
      {
        name: 'МИРИЈЕВСКА',
        settlement: 'М.МОКРИ ЛУГ',
        partial: false,
        village: false,
        ranges: ['3'],
      },
      {
        name: 'ЗЛАТИБОРСКА',
        settlement: 'М.МОКРИ ЛУГ',
        partial: false,
        village: false,
        ranges: ['39'],
      },
    ]);
  });
  it('handles a single street with one number', () => {
    expect(summary('БЈЕЛАНОВИЋЕВА: 2,')).toEqual([
      { name: 'БЈЕЛАНОВИЋЕВА', settlement: null, partial: false, village: false, ranges: ['2'] },
    ]);
  });
  it('does not read a street named after a date as a house number', () => {
    expect(summary('12. ФЕБРУАРА: 3, КРАЉА МИЛАНА: 5').map((s) => [s.name, s.ranges])).toEqual([
      ['12. ФЕБРУАРА', ['3']],
      ['КРАЉА МИЛАНА', ['5']],
    ]);
  });
});

describe('splitUlice: edge cases', () => {
  it('returns nothing for an empty cell', () => {
    expect(splitUlice('')).toEqual([]);
    expect(splitUlice('  ;  ')).toEqual([]);
  });
  it('does not split inside parentheses', () => {
    expect(splitUlice('Чегарска (9, 11 и 13)')).toHaveLength(1);
  });
});
