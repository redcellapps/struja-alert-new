import { readdirSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildNisGazetteer,
  decodePage,
  nisMunicipality,
  normalizeName,
  parsePage,
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
let streets: StreetIndex;
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
  streets = new StreetIndex(gaz.streets);
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
    for (const row of rows) {
      for (const seg of splitUlice(row.ulice)) {
        const res = streets.resolve(normalizeName(seg.name));
        expect(res.by, `${seg.name} (${row.opstina})`).not.toBe('unresolved');
        expect(res.by, seg.name).not.toBe('ambiguous');
        const want = expected.get(seg.name);
        if (want) {
          expect(res.street?.name, seg.name).toBe(want);
          seen.add(seg.name);
        }
      }
    }
    expect([...seen].sort()).toEqual([...expected.keys()].sort());
  });
});
