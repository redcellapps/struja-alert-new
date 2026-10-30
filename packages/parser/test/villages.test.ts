import { readdirSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildNisGazetteer,
  buildSettlementAreas,
  nisMunicipality,
  normalizeName,
  resolveRow,
  Resolver,
  splitUlice,
  StreetIndex,
  type MunicipalitySnapshot,
  type NisGazetteer,
  type NisSettlement,
} from '../src/index.ts';

// Real EDS rows (fixtures/eds/2026-10-28-19 and -29-19, branch Niš) that name settlements in the
// genitive without "село"/"насеље": they must resolve as villages, not stay unresolved streets.
const OSM = new URL('../../../fixtures/osm/', import.meta.url);
const json = (name: string) => JSON.parse(readFileSync(new URL(name, OSM), 'utf8'));
const ALIASES = new URL('../data/aliases.json', import.meta.url);

let gaz: NisGazetteer;
let resolver: Resolver;
let settlements: StreetIndex;
let settlementAliases: Map<string, NisSettlement>;

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
  settlements = new StreetIndex(gaz.settlements);
  // The reviewed village aliases of the seed file, as the server and the label builder load them.
  const seed = JSON.parse(readFileSync(ALIASES, 'utf8')) as {
    raw_norm: string;
    settlement?: string;
    reviewed?: boolean;
  }[];
  settlementAliases = new Map(
    seed.flatMap((a) => {
      if (!a.settlement || !a.reviewed) return [];
      const p = gaz.settlements.find((s) => s.name === a.settlement);
      return p ? [[a.raw_norm, p] as const] : [];
    }),
  );
});

const resolve = (opstina: string, cell: string) =>
  resolveRow(splitUlice(cell), {
    resolver,
    settlements,
    settlementAliases,
    municipality: nisMunicipality(opstina),
  });

describe('settlement names in the genitive (Niška Banja, 28–29 Oct 2026)', () => {
  it('resolves "делови Банцарева, Чукљеника, Доње Студене, Горње Студене, Бојаниних вода" as five villages', () => {
    const out = resolve(
      'Нишка бања',
      'делови Банцарева, Чукљеника, Доње Студене, Горње Студене, Бојаниних вода;',
    );
    expect(out.map((r) => r.segment.name)).toEqual([
      'Банцарева',
      'Чукљеника',
      'Доње Студене',
      'Горње Студене',
      'Бојаниних вода',
    ]);
    expect(out.map((r) => r.kind)).toEqual(['village', 'village', 'village', 'village', 'village']);
    expect(out.map((r) => r.settlement?.name)).toEqual([
      'Банцарево',
      'Чукљеник',
      'Доња Студена',
      'Горња Студена',
      'Бојанине воде',
    ]);
    expect(out.every((r) => r.street === null)).toBe(true);
    // The four OSM villages are in Niška Banja; the extra one is placed there by hand.
    for (const r of out) expect(r.settlement?.municipality).toBe('niska banja');
  });

  it('has the settlement OSM lacks in the gazetteer, without coordinates', () => {
    const extra = gaz.settlements.find((s) => s.name === 'Бојанине воде');
    expect(extra).toMatchObject({ kind: 'locality', municipality: 'niska banja', lat: null });
    expect(Number(extra?.id)).toBeLessThan(0);
    // nothing OSM already has is duplicated
    expect(gaz.settlements.filter((s) => s.nameNorm === normalizeName('Банцарево'))).toHaveLength(
      1,
    );
  });

  it('a street that merely resembles a village name is still a street', () => {
    const [seg] = resolve('Пантелеј', 'делови Горњоматејевачке и Студеничке;');
    expect(seg?.kind).toBe('street');
    const names = resolve('Пантелеј', 'делови Горњоматејевачке и Студеничке;').map((r) => ({
      kind: r.kind,
      street: r.street?.name ?? r.candidates[0]?.name,
    }));
    expect(names.map((n) => n.kind)).toEqual(['street', 'street']);
    expect(names[1]?.street).toBe('Студеничка');
  });
});

describe('Стара железничка колонија (Palilula, 29 Oct 2026)', () => {
  it('"Старе Железничке Колоније (1-10)" is the neighbourhood, "Железничке Колоније (1)" the street', () => {
    const out = resolve(
      'Палилула - Ниш',
      'делови Белопаланчке (бб), Старе Железничке Колоније (1-10), Станоја Бунушевца (13,23,27,37), Таковске (37), Милана Ракића (1), Божидарчеве (10-26), Железничке Колоније (1);',
    );
    const colony = out.find((r) => r.segment.name === 'Старе Железничке Колоније');
    expect(colony).toMatchObject({ kind: 'village', by: 'alias' });
    expect(colony?.settlement).toMatchObject({
      name: 'Железничка колонија',
      kind: 'neighbourhood',
    });
    expect(colony?.segment.ranges.map((x) => x.raw)).toEqual(['1-10']);
    const street = out.find((r) => r.segment.name === 'Железничке Колоније');
    expect(street?.kind).toBe('street');
    expect(street?.street?.name).toBe('Железничка колонија');
  });
});
