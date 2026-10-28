import { readdirSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildNisGazetteer,
  decodePage,
  nisMunicipality,
  parsePage,
  resolveRow,
  Resolver,
  splitUlice,
  StreetIndex,
  type MunicipalitySnapshot,
  type NisGazetteer,
} from '../src/index.ts';

// Real data: OSM snapshots (Overpass, 22 Oct 2026) and EDS pages collected the same day.
const OSM = new URL('../../../fixtures/osm/', import.meta.url);
const EDS = new URL('../../../fixtures/eds/manual-20261022T1202Z/', import.meta.url);
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
  gaz = buildNisGazetteer(json('nis-streets.json').elements, muns);
  resolver = new Resolver(gaz.streets);
});

describe('Niš gazetteer from the real OSM snapshots', () => {
  it('has all five municipalities and a plausible size', () => {
    expect(muns().sort()).toEqual([
      'crveni krst',
      'medijana',
      'niska banja',
      'palilula',
      'pantelej',
    ]);
    expect(gaz.streets.length).toBeGreaterThan(2000);
    expect(gaz.streets.filter((s) => s.municipalities.length > 0).length).toBeGreaterThan(2000);
  });
  it('includes villages, hamlets and suburbs of the five municipalities', () => {
    const kinds = new Set(gaz.settlements.map((s) => s.kind));
    expect(kinds).toContain('village');
    expect(gaz.settlements.find((s) => s.name === 'Трупале')?.municipality).not.toBeNull();
  });
  function muns() {
    return [...new Set(gaz.streets.flatMap((s) => s.municipalities))];
  }
});

describe('every in-scope Niš segment in the collected EDS pages', () => {
  // In scope = the five city municipalities, matched as EDS writes them.
  const rows = readdirSync(EDS)
    .filter((f) => /^Nis_Dan_\d\.htm$/.test(f))
    .flatMap((f) => parsePage(decodePage(readFileSync(new URL(f, EDS))).text).rows)
    .filter((r) => nisMunicipality(r.opstina) !== null);

  it('finds in-scope rows', () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  it('resolves to a real street, never to a wrong one', () => {
    const expected = new Map([
      ['Горњоматејевачке', 'Горњоматејевачка'],
      ['Студеничке', 'Студеничка'],
      ['Матејевачког пута', 'Матејевачки пут'],
      ['Требињске', 'Требињска'],
      ['Војводе Путника', 'Војводе Путника'],
      ['Космајске', 'Космајска'],
      ['Бубањске долине', 'Бубањска долина'],
      ['Чегарске', 'Чегарска'],
      ['Друга Нишавска прилаз два', 'Друга Нишавска прилаз 2'],
    ]);
    const seen = new Set<string>();
    const settlements = new StreetIndex(gaz.settlements);
    for (const row of rows) {
      const resolutions = resolveRow(splitUlice(row.ulice), {
        resolver,
        settlements,
        municipality: nisMunicipality(row.opstina),
      });
      for (const res of resolutions) {
        const seg = res.segment;
        expect(res.by, `${seg.name} (${row.opstina})`).not.toBe('unresolved');
        const want = expected.get(seg.name);
        if (res.by === 'ambiguous') {
          // Several streets share the name and the row cannot tell which: no street is chosen, and
          // every candidate is a street of that name (a false alarm over a miss, never a wrong street).
          expect(res.street, seg.name).toBeNull();
          expect(res.candidates.length, seg.name).toBeGreaterThan(1);
          for (const c of res.candidates) expect(c.name, seg.name).toBe(want);
        } else if (want) {
          expect(res.street?.name, seg.name).toBe(want);
        }
        if (want) seen.add(seg.name);
        // Vojvode Putnika (Palilula): the city street, not the one in Трупале (Црвени Крст)
        if (seg.name === 'Војводе Путника') {
          expect(res.by, row.opstina).toBe('placed');
          expect(res.street?.municipalities, row.opstina).toContain('palilula');
        }
      }
    }
    expect([...seen].sort()).toEqual([...expected.keys()].sort());
  });
});
