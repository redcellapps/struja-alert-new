import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { citiesResponseSchema, gazetteerResponseSchema } from '@struja/shared';
import { buildApp } from '../src/app.ts';
import { importGazetteer } from '../src/gazetteer/import.ts';
import { readNisSnapshots } from '../src/gazetteer/osm-files.ts';
import { GazetteerService } from '../src/gazetteer/service.ts';
import { startTestDb, type TestDb } from './helpers/db.ts';

let t: TestDb;
let app: ReturnType<typeof buildApp>;
let gazetteers: GazetteerService;

beforeAll(async () => {
  t = await startTestDb();
  const osm = new URL('../../../fixtures/osm', import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    '$1',
  );
  const src = readNisSnapshots(osm);
  await importGazetteer(t.db, { city: 'Nis', gazetteer: src.gazetteer });
  gazetteers = new GazetteerService(t.db);
  app = buildApp({ db: t.db, gazetteers });
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  await t?.stop();
});

describe('GET /v1/cities', () => {
  it('lists Niš as active with its gazetteer version, the rest as "soon"', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/cities' });
    expect(res.statusCode).toBe(200);
    const body = citiesResponseSchema.parse(res.json());
    const nis = body.cities.find((c) => c.id === 'nis');
    expect(nis).toMatchObject({ name: 'Niš', active: true, gazetteerVersion: 1 });
    const others = body.cities.filter((c) => c.id !== 'nis');
    expect(others.length).toBeGreaterThan(0);
    for (const c of others) expect(c).toMatchObject({ active: false, gazetteerVersion: null });
  });
});

describe('GET /v1/cities/:city/gazetteer', () => {
  it('returns the streets and settlements, matching the shared schema', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/cities/nis/gazetteer' });
    expect(res.statusCode).toBe(200);
    const body = gazetteerResponseSchema.parse(res.json());
    expect(body.streets.length).toBeGreaterThan(2000);
    expect(body.settlements.length).toBeGreaterThan(50);
    expect(body.streets.find((s) => s.nameNorm === 'studenicka')?.nameCyrillic).toBe('Студеничка');
    expect(res.headers.etag).toBe(`"${body.etag}"`);
  });

  it('answers 304 when the app already has this version (If-None-Match)', async () => {
    const first = await app.inject({ method: 'GET', url: '/v1/cities/nis/gazetteer' });
    const again = await app.inject({
      method: 'GET',
      url: '/v1/cities/nis/gazetteer',
      headers: { 'if-none-match': String(first.headers.etag) },
    });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
  });

  it('serves a new body once the gazetteer changed and the cache was invalidated', async () => {
    const first = await app.inject({ method: 'GET', url: '/v1/cities/nis/gazetteer' });
    const src = readNisSnapshots(
      new URL('../../../fixtures/osm', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    );
    await importGazetteer(t.db, {
      city: 'Nis',
      gazetteer: {
        settlements: src.gazetteer.settlements,
        streets: [
          ...src.gazetteer.streets,
          {
            ...src.gazetteer.streets[0]!,
            id: 9999999,
            name: 'Једна нова',
            nameNorm: 'jedna nova',
            altNorms: [],
            lines: [],
          },
        ],
      },
    });
    gazetteers.invalidate('Nis');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cities/nis/gazetteer',
      headers: { 'if-none-match': String(first.headers.etag) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().version).toBe(2);
    expect(res.json().streets.some((s: { nameNorm: string }) => s.nameNorm === 'jedna nova')).toBe(
      true,
    );
  });

  it('is 404 with an error body for an unknown or inactive city', async () => {
    for (const city of ['atlantida', 'beograd']) {
      const res = await app.inject({ method: 'GET', url: `/v1/cities/${city}/gazetteer` });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('city_not_found');
    }
  });
});
