import { describe, expect, it } from 'vitest';
import {
  buildNisGazetteer,
  nisMunicipality,
  normalizeName,
  StreetIndex,
  type MunicipalitySnapshot,
  type OsmStreetWay,
} from '../src/index.ts';
import { canonicalizeNumbers } from '../src/numbers.ts';

const norm = normalizeName;

describe('canonicalizeNumbers', () => {
  it('turns cardinal and ordinal words into digits', () => {
    expect(canonicalizeNumbers('prilaz dva')).toBe('prilaz 2');
    expect(canonicalizeNumbers('bulevar dvanaestog februara')).toBe('bulevar 12 februara');
    expect(canonicalizeNumbers('druga nisavska')).toBe('2 nisavska');
    expect(canonicalizeNumbers('prvog maja')).toBe('1 maja');
  });
  it('leaves other words and existing digits alone', () => {
    expect(canonicalizeNumbers('vojvode putnika 12')).toBe('vojvode putnika 12');
    expect(canonicalizeNumbers('petra drugog')).toBe('petra 2');
  });
});

describe('StreetIndex: numbers as words (heuristic step)', () => {
  const index = StreetIndex.fromNames([
    'Друга Нишавска прилаз 2',
    'Булевар 12. фебруар',
    'Првомајска',
  ]);
  it('matches a number word against a digit', () => {
    const r = index.resolve(norm('Друга Нишавска прилаз два'));
    expect(r.by).toBe('heuristic');
    expect(r.street?.name).toBe('Друга Нишавска прилаз 2');
  });
  it('matches the date written in words, in the genitive', () => {
    const r = index.resolve(norm('Бул. Дванаестог фебруара'));
    expect(r.by).toBe('heuristic');
    expect(r.street?.name).toBe('Булевар 12. фебруар');
  });
  it('prefers an exact match over the heuristic', () => {
    expect(index.resolve(norm('Првомајска')).by).toBe('exact');
  });
});

describe('nisMunicipality', () => {
  it.each([
    ['Медијана', 'medijana'],
    ['Палилула - Ниш', 'palilula'],
    ['Пантелеј', 'pantelej'],
    ['Црвени крст', 'crveni krst'],
    ['Црвени Крст', 'crveni krst'],
    ['Нишка бања', 'niska banja'],
    ['Gradska opština Palilula', 'palilula'],
    ['Gradska opština Niška Banja', 'niska banja'],
  ])('maps %s', (name, key) => {
    expect(nisMunicipality(name)).toBe(key);
  });
  it.each(['Гаџин Хан', 'Прокупље', 'Алексинац', 'Врачар', ''])('rejects %s', (name) => {
    expect(nisMunicipality(name)).toBeNull();
  });
  it('maps a bare "Палилула" too, so scope must also check the page is the Niš branch', () => {
    // EDS writes Niš's municipality as "Палилула - Ниш" because Belgrade has its own Палилула.
    // OSM only says "Palilula", so the name alone cannot tell them apart: callers must also
    // require that the row comes from a Niš page.
    expect(nisMunicipality('Палилула')).toBe('palilula');
  });
});

describe('buildNisGazetteer', () => {
  const ways: OsmStreetWay[] = [
    {
      type: 'way',
      id: 1,
      tags: { name: 'Студеничка', 'name:sr-Latn': 'Studenička' },
      geometry: [
        { lat: 43.3, lon: 21.9 },
        { lat: 43.4, lon: 22.0 },
      ],
    },
    {
      type: 'way',
      id: 2,
      tags: { name: 'Студеничка' },
      // a continuation within a few metres of the end of way 1: the same street
      geometry: [{ lat: 43.4002, lon: 22.0002 }],
    },
    {
      type: 'way',
      id: 3,
      tags: {
        name: 'Булевар 12. фебруар',
        alt_name: 'Булевар дванаести фебруар; Бул. 12. фебруара',
      },
    },
    { type: 'way', id: 4, tags: { highway: 'residential' } },
  ];
  const muns: MunicipalitySnapshot[] = [
    {
      name: 'Gradska opština Pantelej',
      streetWayIds: [1, 3],
      places: [
        {
          type: 'node',
          id: 10,
          lat: 43.35,
          lon: 21.8,
          tags: { name: 'Трупале', place: 'village' },
        },
        { type: 'node', id: 11, lat: 1, lon: 1, tags: { name: 'Нешто', place: 'locality' } },
      ],
    },
    {
      name: 'Gradska opština Palilula',
      streetWayIds: [2, 3],
      places: [
        {
          type: 'node',
          id: 10,
          lat: 43.35,
          lon: 21.8,
          tags: { name: 'Трупале', place: 'village' },
        },
      ],
    },
    { name: 'Neki drugi grad', streetWayIds: [1], places: [] },
  ];
  const g = buildNisGazetteer(ways, muns);

  it('merges connected or close ways with the same normalized name and ignores nameless ways', () => {
    expect(g.streets.map((s) => s.name)).toEqual(['Студеничка', 'Булевар 12. фебруар']);
    expect(g.streets[0]?.wayIds).toEqual([1, 2]);
    expect(g.streets[0]?.lines).toHaveLength(2);
  });
  it('records every city municipality a street touches, but not other places', () => {
    expect(g.streets[0]?.municipalities).toEqual(['pantelej', 'palilula']);
    expect(g.streets[1]?.municipalities).toEqual(['pantelej', 'palilula']);
  });
  it('computes a centroid from the geometry', () => {
    expect(g.streets[0]?.centroid?.[0]).toBeCloseTo((43.3 + 43.4 + 43.4002) / 3);
    expect(g.streets[1]?.centroid).toBeNull();
  });
  it('keeps alternate names as extra normalized forms', () => {
    expect(g.streets[1]?.altNorms).toEqual(['bulevar dvanaesti februar', 'bulevar 12 februara']);
    expect(g.streets[0]?.nameLatin).toBe('Studenička');
  });
  it('names the nearest settlement of each street, and gives each a stable key', () => {
    expect(g.streets[0]?.settlement).toBe('Трупале');
    expect(g.streets[0]?.clusterKey).toBe('1'); // the smallest OSM way id
    expect(g.streets[1]?.settlement).toBeNull(); // no geometry, no place to name
  });
  it('lets an alternate name resolve to the street', () => {
    const r = new StreetIndex(g.streets).resolve(norm('Бул. 12. фебруара'));
    expect(r.street?.name).toBe('Булевар 12. фебруар');
  });
  it('lists settlements once, with their kind, skipping non-settlement places', () => {
    expect(g.settlements).toHaveLength(1);
    expect(g.settlements[0]).toMatchObject({
      name: 'Трупале',
      kind: 'village',
      municipality: 'pantelej',
    });
  });
});
