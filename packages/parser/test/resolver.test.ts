import { describe, expect, it } from 'vitest';
import {
  addressNumbersByStreet,
  jaroWinkler,
  levenshtein,
  normalizeName,
  Resolver,
  trigramSimilarity,
  type NisStreet,
} from '../src/index.ts';

const norm = normalizeName;

let nextId = 1;
function street(
  name: string,
  opts: { mun?: NisStreet['municipalities']; at?: [number, number]; alts?: string[] } = {},
): NisStreet {
  const at = opts.at;
  const id = nextId++;
  return {
    id,
    clusterKey: String(id),
    settlement: null,
    name,
    nameNorm: norm(name),
    altNorms: (opts.alts ?? []).map(norm),
    municipality: opts.mun?.[0] ?? null,
    municipalities: opts.mun ?? [],
    nameLatin: null,
    wayIds: [],
    lines: at ? [[at, [at[0] + 0.0005, at[1] + 0.0005]]] : [],
    centroid: at ?? null,
  };
}

describe('string similarity', () => {
  it('trigram similarity: identical 1, unrelated near 0, typo high', () => {
    expect(trigramSimilarity('pasica', 'pasica')).toBe(1);
    expect(trigramSimilarity('pasica', 'xyzxyz')).toBe(0);
    expect(trigramSimilarity('studenicka', 'studenicka')).toBe(1);
    expect(trigramSimilarity('studenicka', 'studenika')).toBeGreaterThan(0.5);
  });
  it('levenshtein and jaro-winkler', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.961, 2);
    expect(jaroWinkler('a', 'b')).toBe(0);
  });
});

describe('Resolver ladder', () => {
  const nikole = street('Николе Пашића', { mun: ['medijana'], at: [43.32, 21.9] });
  const misica = street('Војводе Мишића', { mun: ['medijana'], at: [43.321, 21.901] });
  const misicaFar = street('Мишићева', { mun: ['palilula'], at: [43.4, 22.1] });
  const dvanaest = street('Булевар 12. фебруар', {
    mun: ['medijana'],
    alts: ['Булевар дванаести фебруар'],
  });
  const cegarska = street('Чегарска', { mun: ['niska banja'] });
  const resolver = new Resolver([nikole, misica, misicaFar, dvanaest, cegarska]);

  it('1 exact', () => {
    expect(resolver.resolve(norm('Николе Пашића')).by).toBe('exact');
  });
  it('2 alias beats everything', () => {
    const r = resolver.resolve('xyz', { aliases: new Map([['xyz', cegarska.id]]) });
    expect(r).toMatchObject({ by: 'alias', street: cegarska });
  });
  it('case forms', () => {
    expect(resolver.resolve(norm('Чегарске'))).toMatchObject({ by: 'form', street: cegarska });
  });
  it('3 fuzzy is conservative: a one-letter typo is below the 0.85 trigram bar', () => {
    // pg_trgm-style similarity of a typo is ~0.6-0.75, so it falls through to step 5.
    expect(resolver.resolve('cegarsk').by).not.toBe('fuzzy');
  });
  it('5 a typo is caught by scoring, in its own municipality', () => {
    const typo = new Resolver([
      street('Горњоматејевачка', { mun: ['pantelej'] }),
      street('Студеничка', { mun: ['pantelej'] }),
    ]);
    const r = typo.resolve('studenika', { municipality: 'pantelej' });
    expect(r.by).toBe('scored');
    expect(r.street?.name).toBe('Студеничка');
  });
  it('5 the same typo in the wrong municipality is not auto-accepted', () => {
    const typo = new Resolver([street('Студеничка', { mun: ['palilula'] })]);
    expect(typo.resolve('studenika', { municipality: 'pantelej' }).by).toBe('unresolved');
  });
  it('4 heuristic: swapped word order', () => {
    expect(resolver.resolve(norm('ПАШИЋА НИКОЛЕ'))).toMatchObject({
      by: 'heuristic',
      street: nikole,
    });
  });
  it('4 heuristic: missing first name (token containment) is only a proposal on its own', () => {
    const r = resolver.resolve(norm('Пашића'));
    expect(r.by).toBe('unresolved');
    expect(r.street).toBeNull();
    expect(r.candidates[0]?.street).toBe(nikole); // kept as a candidate for review
  });
  it('4 heuristic: ... accepted when a street of the same row, nearby, confirms it', () => {
    expect(resolver.resolve(norm('Пашића'), { anchors: [misica] })).toMatchObject({
      by: 'heuristic',
      street: nikole,
    });
  });
  it('4 heuristic: ... but not when the row is somewhere else', () => {
    // Мишићева is 20 km away from Николе Пашића
    const r = resolver.resolve(norm('Пашића'), { anchors: [misicaFar] });
    expect(r.by).toBe('unresolved');
    expect(r.street).toBeNull();
  });
  it('4 heuristic: a word that is part of another street name is never accepted alone (typo of a third street)', () => {
    // "топлице" is a word of "Милана Топлице", not a street of its own
    const toplice = street('Милана Топлице', { mun: ['medijana'], at: [43.33, 21.92] });
    const r = new Resolver([toplice, cegarska]).resolve(norm('Топлице'));
    expect(r.street).toBeNull();
    expect(r.candidates.length).toBeGreaterThan(0);
  });
  it('4 heuristic: stray бб', () => {
    expect(resolver.resolve(norm('Чегарска бб'))).toMatchObject({ street: cegarska });
  });
  it('4 heuristic: date written in words', () => {
    expect(resolver.resolve(norm('Бул. Дванаестог фебруара'))).toMatchObject({ street: dvanaest });
  });
  it('never accepts a street that is not in the gazetteer', () => {
    const r = resolver.resolve(norm('Потпуно непозната'));
    expect(r.by).toBe('unresolved');
    expect(r.street).toBeNull();
  });
});

describe('Resolver step 5: scoring with spatial context', () => {
  // Two streets that both contain "Мишића": the neighbour of the row's anchor street wins.
  const anchor = street('Николе Пашића', { mun: ['medijana'], at: [43.32, 21.9] });
  const near = street('Војводе Мишића', { mun: ['medijana'], at: [43.322, 21.902] });
  const far = street('Живојина Мишића', { mun: ['palilula'], at: [43.45, 22.2] });
  const resolver = new Resolver([anchor, near, far]);

  it('is ambiguous without context: both are plausible and neither is auto-accepted', () => {
    const r = resolver.resolve(norm('Мишића'));
    expect(r.by).toBe('unresolved');
    expect(r.candidates.map((c) => c.street.name).sort()).toEqual([
      'Војводе Мишића',
      'Живојина Мишића',
    ]);
  });
  it('uses the other streets in the same row to pick the nearby one', () => {
    const r = resolver.resolve(norm('Мишића'), { anchors: [anchor], municipality: 'medijana' });
    expect(r.by).toBe('scored');
    expect(r.street).toBe(near);
    expect(r.candidates[0]?.street).toBe(near);
    expect(r.candidates[0]?.features.proximity).toBeGreaterThan(0.5);
    expect(r.candidates[0]?.score).toBeGreaterThan(r.candidates[1]?.score ?? 1);
  });
  it('never auto-accepts when the margin over the runner-up is too small', () => {
    const twinA = street('Прва Краљева', { mun: ['medijana'], at: [43.32, 21.9] });
    const twinB = street('Прва Краљица', { mun: ['medijana'], at: [43.32, 21.9] });
    const r = new Resolver([twinA, twinB]).resolve(norm('Прва Краљ'), { municipality: 'medijana' });
    expect(r.by).toBe('unresolved');
    expect(r.street).toBeNull();
  });
  it('house numbers that exist on a street raise its score', () => {
    const addr = addressNumbersByStreet([
      { tags: { 'addr:street': 'Војводе Мишића', 'addr:housenumber': '34a' } },
      { tags: { 'addr:street': 'Живојина Мишића', 'addr:housenumber': '2' } },
    ]);
    const range = {
      from: 30,
      to: 40,
      fromSuffix: null,
      toSuffix: null,
      parity: null,
      bb: false,
      raw: '30-40',
    };
    const r = resolver.resolve(norm('Мишића'), { ranges: [range], addressNumbers: addr });
    const byName = new Map(r.candidates.map((c) => [c.street.name, c.features.houseNumber]));
    expect(byName.get('Војводе Мишића')).toBe(1);
    expect(byName.get('Живојина Мишића')).toBe(0);
  });
});

// Regressions found by the synthetic stress test (scripts/src/synthetic-eval.ts).
describe('Resolver: never guess between streets that fit equally', () => {
  const resolver = new Resolver([
    street('Прва', { mun: ['medijana'] }),
    street('Римска 3', { mun: ['medijana'] }),
    street('Старине Новака', { mun: ['medijana'], at: [43.32, 21.9] }),
    street('Новака Радуловића', { mun: ['medijana'], at: [43.5, 22.2] }),
    street('Првог српског устанка', { mun: ['medijana'] }),
    street('Другог српског устанка', { mun: ['medijana'] }),
  ]);
  it('a bare number is not a number word ("3" is not "Трећа")', () => {
    expect(resolver.resolve('3').street).toBeNull();
    expect(resolver.resolve('1').street).toBeNull();
  });
  it('a bare name that fits two streets is not auto-accepted without row context', () => {
    const r = resolver.resolve(norm('Новака'), { municipality: 'medijana' });
    expect(r.by).toBe('unresolved');
    expect(r.candidates.map((c) => c.street.name).sort()).toEqual([
      'Новака Радуловића',
      'Старине Новака',
    ]);
  });
  it('... but the other streets of the same row can decide it', () => {
    const anchor = street('Неки сусед', { mun: ['medijana'], at: [43.3201, 21.9001] });
    const r = new Resolver([
      street('Старине Новака', { mun: ['medijana'], at: [43.32, 21.9] }),
      street('Новака Радуловића', { mun: ['medijana'], at: [43.5, 22.2] }),
    ]).resolve(norm('Новака'), { municipality: 'medijana', anchors: [anchor] });
    expect(r.by).toBe('scored');
    expect(r.street?.name).toBe('Старине Новака');
  });
  it('fuzzy needs a clear lead over the runner-up ("српског устанка")', () => {
    expect(resolver.resolve(norm('српског устанка')).by).not.toBe('fuzzy');
  });
});

describe('addressNumbersByStreet', () => {
  it('keeps the leading integer of messy house numbers', () => {
    const m = addressNumbersByStreet([
      { tags: { 'addr:street': 'Чегарска', 'addr:housenumber': '12/3' } },
      { tags: { 'addr:street': 'Чегарска', 'addr:housenumber': '7б' } },
      { tags: { 'addr:street': 'Чегарска', 'addr:housenumber': 'bb' } },
      { tags: { 'addr:street': 'Чегарска' } },
    ]);
    expect([...(m.get('cegarska') ?? [])].sort((a, b) => a - b)).toEqual([7, 12]);
  });
});
