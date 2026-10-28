import { readdirSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildNisGazetteer,
  buildSettlementAreas,
  clusterWays,
  haversineMeters,
  normalizeName,
  Resolver,
  resolveRow,
  SAME_STREET_GAP_METERS,
  splitUlice,
  StreetIndex,
  type MunicipalitySnapshot,
  type NisGazetteer,
  type NisStreet,
  type OsmStreetWay,
} from '../src/index.ts';

const norm = normalizeName;

// One degree of latitude is about 111 km: 0.001 is 111 m.
const way = (id: number, ...points: [number, number][]): OsmStreetWay => ({
  type: 'way',
  id,
  tags: { name: 'Војводе Путника' },
  geometry: points.map(([lat, lon]) => ({ lat, lon })),
});

describe('clusterWays: one name, one street only when connected or close', () => {
  it('joins ways that touch or lie within the gap, chained', () => {
    const groups = clusterWays([
      way(1, [43.3, 21.9], [43.301, 21.9]),
      way(2, [43.301, 21.9], [43.302, 21.9]), // touches way 1
      way(3, [43.3055, 21.9], [43.306, 21.9]), // 330 m on: within the gap of way 2
    ]);
    expect(groups.map((g) => g.map((w) => w.id))).toEqual([[1, 2, 3]]);
  });

  it('keeps ways farther apart than the gap as different streets', () => {
    const groups = clusterWays([
      way(1, [43.3, 21.9], [43.301, 21.9]),
      way(2, [43.3578, 21.8172]), // 9 km away
    ]);
    expect(groups.map((g) => g.map((w) => w.id))).toEqual([[1], [2]]);
    // right at the gap
    const edge = SAME_STREET_GAP_METERS / 111_320;
    expect(clusterWays([way(1, [43.3, 21.9]), way(2, [43.3 + edge * 0.9, 21.9])])).toHaveLength(1);
    expect(clusterWays([way(1, [43.3, 21.9]), way(2, [43.3 + edge * 1.2, 21.9])])).toHaveLength(2);
  });

  it('orders streets by their smallest OSM way id, so keys stay stable', () => {
    const groups = clusterWays([
      way(30, [43.5, 21.5]),
      way(20, [43.3, 21.9]),
      way(10, [43.3, 21.9]),
    ]);
    expect(groups.map((g) => g.map((w) => w.id))).toEqual([[10, 20], [30]]);
  });
});

// ------------------------------------------------------------------ the resolver, synthetic

let nextId = 1;
function street(
  name: string,
  at: [number, number],
  mun: NisStreet['municipalities'],
  settlement: string | null = null,
): NisStreet {
  const id = nextId++;
  return {
    id,
    clusterKey: String(id),
    settlement,
    name,
    nameNorm: norm(name),
    altNorms: [],
    municipality: mun[0] ?? null,
    municipalities: mun,
    nameLatin: null,
    wayIds: [id],
    lines: [[at, [at[0] + 0.0004, at[1] + 0.0004]]],
    centroid: at,
  };
}

// Two streets called "Војводе Путника": one in the city (Палилула), one in Трупале (Црвени Крст),
// 9 km apart, as in the real data; and a few neighbours of the city one.
const CITY: [number, number] = [43.309, 21.8767];
const TRUPALE: [number, number] = [43.3578, 21.8172];
const cityVp = street('Војводе Путника', CITY, ['palilula'], 'Сточни трг');
const trupaleVp = street('Војводе Путника', TRUPALE, ['crveni krst'], 'Трупале');
const nearCity = street('Требињска', [43.3095, 21.8775], ['palilula']);
const nearTrupale = street('Сеоска', [43.3582, 21.8178], ['crveni krst']);

describe('the resolver and several streets with one name', () => {
  const resolver = new Resolver([cityVp, trupaleVp, nearCity, nearTrupale]);

  it('picks by the municipality of the EDS row', () => {
    const r = resolver.resolve(norm('Војводе Путника'), { municipality: 'palilula' });
    expect(r).toMatchObject({ by: 'placed', street: cityVp });
    const t = resolver.resolve(norm('Војводе Путника'), { municipality: 'crveni krst' });
    expect(t).toMatchObject({ by: 'placed', street: trupaleVp });
  });

  it('picks by the distance to the other streets of the row when the municipality cannot tell', () => {
    // a row without a known municipality: the neighbours say where it is
    const r = resolver.resolve(norm('Војводе Путника'), { anchors: [nearCity] });
    expect(r).toMatchObject({ by: 'placed', street: cityVp });
    const t = resolver.resolve(norm('Војводе Путника'), { anchors: [nearTrupale] });
    expect(t).toMatchObject({ by: 'placed', street: trupaleVp });
  });

  it('chooses none, and offers every one of them, when nothing decides', () => {
    const none = resolver.resolve(norm('Војводе Путника'));
    expect(none.by).toBe('ambiguous');
    expect(none.street).toBeNull();
    expect(none.candidates.map((c) => c.street)).toEqual([cityVp, trupaleVp]);
    // anchors in the middle of nowhere: too far from both, or not clearly nearer to one
    const lost = resolver.resolve(norm('Војводе Путника'), {
      anchors: [street('Далека', [43.2, 22.2], ['medijana'])],
    });
    expect(lost.by).toBe('ambiguous');
    const between = resolver.resolve(norm('Војводе Путника'), {
      anchors: [street('Средња', [43.333, 21.847], ['medijana'])],
    });
    expect(between.by).toBe('ambiguous');
  });

  it('narrows to the streets of the municipality when several still fit', () => {
    const twinCity = street('Војводе Путника', [43.3, 21.99], ['palilula'], 'Горње Међурово');
    const r = new Resolver([cityVp, twinCity, trupaleVp]).resolve(norm('Војводе Путника'), {
      municipality: 'palilula',
    });
    expect(r.by).toBe('ambiguous');
    expect(r.candidates.map((c) => c.street)).toEqual([cityVp, twinCity]); // not the Трупале one
  });

  it('places an alias of a shared name like the name itself', () => {
    const aliases = new Map([[norm('Воје Путника'), cityVp.id]]);
    const r = resolver.resolve(norm('Воје Путника'), { aliases, municipality: 'crveni krst' });
    expect(r).toMatchObject({ by: 'placed', street: trupaleVp });
  });

  it('resolves a name with one street as before', () => {
    expect(resolver.resolve(norm('Требињска'))).toMatchObject({ by: 'exact', street: nearCity });
  });
});

describe('resolveRow: the names of one row place each other', () => {
  // Two names, each with two streets. Pair 1 lies together in the east, pair 2 in the west, and
  // the east streets are 6 km from the west ones.
  const aEast = street('Омладинска', [43.3, 21.95], ['pantelej']);
  const aWest = street('Омладинска', [43.3, 21.88], ['pantelej']);
  const bEast = street('Школска', [43.301, 21.951], ['pantelej']);
  const bWest = street('Школска', [43.301, 21.881], ['pantelej']);
  const resolver = new Resolver([aEast, aWest, bEast, bWest]);
  const settlements = new StreetIndex([]);

  it('is ambiguous when both pairs fit the row equally', () => {
    const out = resolveRow(splitUlice('Омладинска, Школска'), {
      resolver,
      settlements,
      municipality: 'pantelej',
    });
    // the east pair and the west pair are both next to each other: nothing prefers one
    expect(out.map((r) => r.by)).toEqual(['ambiguous', 'ambiguous']);
    expect(out[0]?.candidates.map((c) => c.id)).toEqual([aEast.id, aWest.id]);
  });

  it('is decided by a street of the row that has no namesake', () => {
    const anchor = street('Источна', [43.3005, 21.9505], ['pantelej']);
    const r2 = new Resolver([aEast, aWest, bEast, bWest, anchor]);
    const out = resolveRow(splitUlice('Омладинска, Школска, Источна'), {
      resolver: r2,
      settlements,
      municipality: 'pantelej',
    });
    expect(out.map((r) => r.street?.id)).toEqual([aEast.id, bEast.id, anchor.id]);
    expect(out.map((r) => r.by)).toEqual(['placed', 'placed', 'exact']);
  });

  it('leans two undecided names on each other when one pair is clearly together', () => {
    // west streets 4 km apart from each other, east streets next to each other
    const aFar = street('Омладинска', [43.3, 21.83], ['pantelej']);
    const r3 = new Resolver([aEast, aFar, bEast]);
    const out = resolveRow(splitUlice('Омладинска, Школска'), {
      resolver: r3,
      settlements,
      municipality: 'pantelej',
    });
    expect(out.map((r) => r.street?.id)).toEqual([aEast.id, bEast.id]);
  });
});

// ------------------------------------------------------------------ the real Niš data

const OSM = new URL('../../../fixtures/osm/', import.meta.url);
const json = (name: string) => JSON.parse(readFileSync(new URL(name, OSM), 'utf8'));
let gaz: NisGazetteer;
let resolver: Resolver;
beforeAll(() => {
  const admin = json('nis-admin-areas.json').elements.filter(
    (e: { tags: Record<string, string> }) => e.tags.admin_level === '8',
  );
  const nameOf = new Map<string, string>(
    admin.map((e: { id: number; tags: Record<string, string> }) => [
      String(e.id),
      e.tags['name:sr-Latn'] ?? e.tags.name ?? '',
    ]),
  );
  const muns: MunicipalitySnapshot[] = readdirSync(OSM)
    .filter((f) => /^nis-municipality-\d+\.json$/.test(f))
    .map((f) => {
      const els = json(f).elements;
      return {
        name: nameOf.get(/(\d+)/.exec(f)?.[1] ?? '') ?? '',
        streetWayIds: els
          .filter((e: { type: string; tags?: unknown }) => e.type === 'way' && !e.tags)
          .map((e: { id: number }) => e.id),
        places: els.filter((e: { tags?: { place?: string } }) => e.tags?.place),
      };
    });
  gaz = buildNisGazetteer(
    json('nis-streets.json').elements,
    muns,
    buildSettlementAreas(json('nis-settlement-areas.json').elements),
  );
  resolver = new Resolver(gaz.streets);
});

const entries = (name: string) => gaz.streets.filter((s) => s.nameNorm === norm(name));
const apart = (a: NisStreet, b: NisStreet) => haversineMeters(a.centroid!, b.centroid!);

describe('same-named streets in the real Niš data', () => {
  it('Војводе Путника is two streets, kilometres apart: the city one and the one in Трупале', () => {
    const list = entries('Војводе Путника');
    expect(list).toHaveLength(2);
    expect(apart(list[0]!, list[1]!)).toBeGreaterThan(5000);
    expect(list.map((s) => s.settlement).sort()).toEqual(['Палилула', 'Трупале']);
    // the one in Трупале belongs to Црвени Крст, the city one to Палилула and Медијана
    const trupale = list.find((s) => s.settlement === 'Трупале')!;
    expect(trupale.municipalities).toEqual(['crveni krst']);
    expect(list.find((s) => s !== trupale)!.municipalities).toContain('palilula');
  });

  it('streets are named after the settlement they lie in: a village by its own name, the city by its municipality', () => {
    const [city, trupale] = entries('Војводе Путника').sort((a, b) =>
      a.settlement === 'Трупале' ? 1 : b.settlement === 'Трупале' ? -1 : 0,
    );
    expect(city?.settlement).toBe('Палилула'); // not the nearest place node ("Сточни трг")
    expect(trupale?.settlement).toBe('Трупале');
    expect(entries('Требињска')[0]?.settlement).toBe('Палилула');
    // every street has a label, and no two streets of one name share one
    for (const s of gaz.streets) expect(s.settlement, s.name).not.toBeNull();
    const byName = new Map<string, string[]>();
    for (const s of gaz.streets) {
      byName.set(s.nameNorm, [...(byName.get(s.nameNorm) ?? []), s.settlement ?? '']);
    }
    for (const [name, labels] of byName) {
      expect(new Set(labels).size, `${name}: ${labels.join(', ')}`).toBe(labels.length);
    }
  });

  it('Маршала Тита is in eight places, none within a gap of another', () => {
    const list = entries('Маршала Тита');
    expect(list.length).toBeGreaterThanOrEqual(8);
    for (const a of list) {
      for (const b of list) {
        if (a === b) continue;
        const near = a.lines.some((la) =>
          b.lines.some((lb) =>
            la.some((p) => lb.some((q) => haversineMeters(p, q) <= SAME_STREET_GAP_METERS)),
          ),
        );
        expect(near, `${a.clusterKey} and ${b.clusterKey}`).toBe(false);
      }
    }
    // told apart by their settlement (the villages they run through)
    expect(new Set(list.map((s) => s.settlement)).size).toBeGreaterThanOrEqual(7);
  });

  it('every street has a unique (name, key), and a street keeps its ways within one place', () => {
    const keys = new Set(gaz.streets.map((s) => `${s.nameNorm}|${s.clusterKey}`));
    expect(keys.size).toBe(gaz.streets.length);
    expect(gaz.streets.length).toBeGreaterThan(2400);
  });

  it('a Палилула row that names Војводе Путника means the city street, not Трупале', () => {
    const r = resolver.resolve(norm('Војводе Путника'), { municipality: 'palilula' });
    expect(r.by).toBe('placed');
    expect(r.street?.settlement).not.toBe('Трупале');
    const t = resolver.resolve(norm('Војводе Путника'), { municipality: 'crveni krst' });
    expect(t.street?.settlement).toBe('Трупале');
  });

  it('Маршала Тита with nothing to go on is ambiguous, with every street of the name as a candidate', () => {
    const r = resolver.resolve(norm('Маршала Тита'));
    expect(r.by).toBe('ambiguous');
    expect(r.candidates.length).toBe(entries('Маршала Тита').length);
  });
});
