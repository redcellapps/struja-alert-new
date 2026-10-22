import type { GazetteerResponse } from '@struja/shared';
import { gazetteer } from '../mock-server/fixtures';
import { readCached, refreshGazetteer } from '../src/gazetteer/cache';
import { buildIndex, parseHouseNumber, placeName, search } from '../src/gazetteer/search';
import { memoryStorage } from '../src/store/storage';

const index = buildIndex(gazetteer);
const names = (q: string) => search(index, q).map((p) => p.nameLatin);

describe('offline street search', () => {
  it('finds a street whatever the script, case or diacritics typed', () => {
    for (const q of ['vojvode misica', 'Vojvode Mišića', 'војводе мишића', 'VOJVODE MISICA']) {
      expect(names(q)).toEqual(['Vojvode Mišića']);
    }
  });

  it('matches a half typed word and words in any order (false positives over misses)', () => {
    expect(names('voj mi')).toEqual(['Vojvode Mišića']);
    expect(names('misica vojvode')).toEqual(['Vojvode Mišića']);
    expect(names('stud')).toEqual(['Studenička']);
  });

  it('expands the abbreviations the normalizer expands ("bul" is not guessed, "bulevar" is)', () => {
    expect(names('bulevar nem')).toEqual(['Bulevar Nemanjića']);
  });

  it('finds settlements too, marked as such, after streets of the same rank', () => {
    const found = search(index, 'bubanj');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'settlement', nameLatin: 'Bubanj' });
  });

  it('answers nothing for one letter or for no match', () => {
    expect(names('v')).toEqual([]);
    expect(names('')).toEqual([]);
    expect(names('zzzz')).toEqual([]);
  });

  it('ranks an exact name before a prefix before a looser match, and caps the list', () => {
    const g: GazetteerResponse = {
      ...gazetteer,
      streets: Array.from({ length: 20 }, (_, i) => ({
        id: i + 1,
        nameCyrillic: `Нишка ${i}`,
        nameLatin: `Niška ${i}`,
        nameNorm: `niska ${i}`,
        altNorms: [],
        municipality: null,
      })).concat([
        {
          id: 99,
          nameCyrillic: 'Нишка',
          nameLatin: 'Niška',
          nameNorm: 'niska',
          altNorms: [],
          municipality: null,
        },
      ]),
      settlements: [],
    };
    const found = search(buildIndex(g), 'niska');
    expect(found).toHaveLength(8);
    expect(found[0]?.id).toBe(99);
  });

  it('shows the name in the chosen script, deriving Latin when the gazetteer has none', () => {
    const [p] = search(index, 'cegarska');
    expect(p && placeName(p, 'latn')).toBe('Čegarska');
    expect(p && placeName(p, 'cyrl')).toBe('Чегарска');
    const [b] = search(index, 'bubanj');
    expect(b && placeName(b, 'latn')).toBe('Bubanj');
  });

  it('uses alternative names as search keys', () => {
    const g: GazetteerResponse = {
      ...gazetteer,
      streets: [
        {
          id: 1,
          nameCyrillic: 'Војводе Мишића',
          nameLatin: 'Vojvode Mišića',
          nameNorm: 'vojvode misica',
          altNorms: ['dr zorana djindjica'],
          municipality: null,
        },
      ],
      settlements: [],
    };
    expect(search(buildIndex(g), 'djindjic').map((p) => p.id)).toEqual([1]);
  });
});

describe('parseHouseNumber', () => {
  it('reads a number with an optional suffix, and accepts nothing', () => {
    expect(parseHouseNumber('')).toEqual({});
    expect(parseHouseNumber('  ')).toEqual({});
    expect(parseHouseNumber('34')).toEqual({ houseNumber: 34 });
    expect(parseHouseNumber('34a')).toEqual({ houseNumber: 34, houseSuffix: 'a' });
    expect(parseHouseNumber('34 A')).toEqual({ houseNumber: 34, houseSuffix: 'a' });
    expect(parseHouseNumber('12/3')).toEqual({ houseNumber: 12, houseSuffix: '3' });
    // a Cyrillic suffix is stored in Latin, as the server's gazetteer does
    expect(parseHouseNumber('34а')).toEqual({ houseNumber: 34, houseSuffix: 'a' });
  });

  it('rejects what is not a house number', () => {
    for (const bad of ['a34', 'abc', '0', '10000', '34abcd', '3 4', '-5']) {
      expect(parseHouseNumber(bad)).toBe('invalid');
    }
  });
});

describe('gazetteer cache', () => {
  it('stores a downloaded copy, then keeps it on a 304', async () => {
    const kv = memoryStorage();
    expect(readCached(kv, 'nis')).toBeNull();
    const first = await refreshGazetteer({ gazetteer: async () => gazetteer }, kv, 'nis');
    expect(first?.etag).toBe(gazetteer.etag);
    const seen: (string | undefined)[] = [];
    const second = await refreshGazetteer(
      {
        gazetteer: async (_city, etag) => {
          seen.push(etag);
          return null;
        },
      },
      kv,
      'nis',
    );
    expect(seen).toEqual([gazetteer.etag]);
    expect(second).toEqual(gazetteer);
  });

  it('drops a damaged copy and downloads again', async () => {
    const kv = memoryStorage();
    kv.set('gazetteer:nis', '{not json');
    expect(readCached(kv, 'nis')).toBeNull();
    expect(kv.getString('gazetteer:nis')).toBeUndefined();
  });

  it('lets a network failure through (the caller keeps the cached copy)', async () => {
    const kv = memoryStorage();
    await expect(
      refreshGazetteer(
        {
          gazetteer: async () => {
            throw new Error('offline');
          },
        },
        kv,
        'nis',
      ),
    ).rejects.toThrow('offline');
  });
});
