import { readFileSync, readdirSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decodePage,
  nisMunicipality,
  normalizeName,
  parsePage,
  splitUlice,
  type NisGazetteer,
} from '@struja/parser';
import { importGazetteer, type ImportResult, type ReviewedAlias } from '../src/gazetteer/import.ts';
import { loadGazetteer, type LoadedGazetteer } from '../src/gazetteer/load.ts';
import { readNisSnapshots } from '../src/gazetteer/osm-files.ts';
import { startTestDb, type TestDb } from './helpers/db.ts';

const ROOT = new URL('../../../', import.meta.url);
const OSM = new URL('fixtures/osm/', ROOT);
const aliases: ReviewedAlias[] = JSON.parse(
  readFileSync(new URL('packages/parser/data/aliases.json', ROOT), 'utf8'),
);

let t: TestDb;
let source: ReturnType<typeof readNisSnapshots>;
let first: ImportResult;
let loaded: LoadedGazetteer;

beforeAll(async () => {
  t = await startTestDb();
  source = readNisSnapshots(new URL('.', OSM).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  first = await importGazetteer(t.db, {
    city: 'Nis',
    gazetteer: source.gazetteer,
    addresses: source.addresses,
    aliases,
  });
  loaded = await loadGazetteer(t.db, 'Nis');
});
afterAll(async () => {
  await t?.stop();
});

describe('importing the real Niš OSM snapshots into PostGIS', () => {
  it('stores the streets, settlements, address points and reviewed aliases', () => {
    expect(first.streets).toBe(source.gazetteer.streets.length);
    expect(first.settlements).toBe(source.gazetteer.settlements.length);
    expect(first.addressPoints).toBeGreaterThan(40_000);
    expect(first.aliases).toBe(8);
    expect(first.version).toBe(1);
  });

  it('keeps street geometry as a MultiLineString that survives the round trip', () => {
    const original = source.gazetteer.streets.find((s) => s.nameNorm === 'studenicka');
    const back = loaded.streets.find((s) => s.nameNorm === 'studenicka');
    expect(original).toBeDefined();
    expect(back?.lines.length).toBe(original?.lines.length);
    const a = original?.lines[0]?.[0];
    const b = back?.lines[0]?.[0];
    expect(b?.[0]).toBeCloseTo(a?.[0] ?? 0, 6);
    expect(b?.[1]).toBeCloseTo(a?.[1] ?? 0, 6);
  });

  it('keeps municipalities, alternate names and settlements', () => {
    const dvanaest = loaded.streets.find((s) => s.nameNorm === 'bulevar 12 februar');
    expect(dvanaest?.altNorms?.length).toBeGreaterThan(0);
    expect(loaded.streets.some((s) => s.municipalities.includes('pantelej'))).toBe(true);
    expect(loaded.settlements.find((s) => s.name === 'Трупале')?.kind).toBe('village');
  });

  it('imports reviewed aliases only, as manual with confidence 1.0', async () => {
    expect(loaded.aliases.get('studenicke')).toBeDefined();
    const r = await t.db.execute(sql`SELECT DISTINCT source, confidence FROM street_alias`);
    expect(r.rows).toEqual([{ source: 'manual', confidence: 1 }]);
  });

  it('exposes house numbers from OSM for the scoring step', () => {
    expect(loaded.addressNumbers.get('cegarska')?.size).toBeGreaterThan(0);
  });
});

describe('the Resolver rebuilt from the database gives the Phase 1 answers', () => {
  const dir = new URL('fixtures/eds/manual-20261022T1202Z/', ROOT);
  const rows = readdirSync(dir)
    .filter((f) => /^Nis_Dan_\d\.htm$/.test(f))
    .flatMap((f) => parsePage(decodePage(readFileSync(new URL(f, dir))).text).rows)
    .filter((r) => nisMunicipality(r.opstina) !== null);

  it('resolves every in-scope segment of the real Niš pages, none wrongly', () => {
    const expected = new Map([
      ['Студеничке', 'Студеничка'],
      ['Матејевачког пута', 'Матејевачки пут'],
      ['Бубањске долине', 'Бубањска долина'],
      ['Чегарске', 'Чегарска'],
      ['Друга Нишавска прилаз два', 'Друга Нишавска прилаз 2'],
    ]);
    let checked = 0;
    for (const row of rows) {
      for (const seg of splitUlice(row.ulice)) {
        const r = loaded.resolver.resolve(normalizeName(seg.name), {
          municipality: nisMunicipality(row.opstina),
          aliases: loaded.aliases,
          addressNumbers: loaded.addressNumbers,
        });
        expect(r.street, seg.name).not.toBeNull();
        const want = expected.get(seg.name);
        if (want) {
          expect(r.street?.name, seg.name).toBe(want);
          checked++;
        }
      }
    }
    expect(checked).toBe(expected.size);
  });

  it('uses a confirmed alias before anything else', () => {
    const r = loaded.resolver.resolve('studenicke', { aliases: loaded.aliases });
    expect(r.by).toBe('alias');
    expect(r.street?.name).toBe('Студеничка');
  });
});

describe('re-importing', () => {
  it('keeps every street id (subscriptions point at them) and the version when nothing changed', async () => {
    const before = new Map(loaded.streets.map((s) => [s.nameNorm, s.id]));
    const again = await importGazetteer(t.db, {
      city: 'Nis',
      gazetteer: source.gazetteer,
      addresses: source.addresses,
      aliases,
    });
    const after = await loadGazetteer(t.db, 'Nis');
    expect(again.version).toBe(1);
    expect(again.etag).toBe(first.etag);
    expect(again.aliases).toBe(0); // already there
    for (const s of after.streets) expect(s.id, s.name).toBe(before.get(s.nameNorm));
    expect(after.streets.length).toBe(loaded.streets.length);
  });

  it('bumps the version and changes the ETag when a street is added, and keeps old ids', async () => {
    const extra: NisGazetteer = {
      settlements: source.gazetteer.settlements,
      streets: [
        ...source.gazetteer.streets,
        {
          id: 999999,
          name: 'Нова тестна улица',
          nameNorm: 'nova testna ulica',
          altNorms: [],
          municipality: 'medijana',
          municipalities: ['medijana'],
          nameLatin: null,
          wayIds: [1],
          lines: [],
          centroid: null,
        },
      ],
    };
    const res = await importGazetteer(t.db, { city: 'Nis', gazetteer: extra, addresses: [] });
    expect(res.version).toBe(2);
    expect(res.etag).not.toBe(first.etag);
    const after = await loadGazetteer(t.db, 'Nis');
    expect(after.streets.find((s) => s.nameNorm === 'nova testna ulica')?.lines).toEqual([]);
    expect(after.streets.length).toBe(loaded.streets.length + 1);
    // address points were replaced by the (empty) new set
    expect(after.addressNumbers.size).toBe(0);
  });
});
