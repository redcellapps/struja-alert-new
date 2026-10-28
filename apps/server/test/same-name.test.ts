import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { outageDetailSchema } from '@struja/shared';
import type { NisGazetteer, NisStreet } from '@struja/parser';
import { buildApp } from '../src/app.ts';
import { street as streetTable } from '../src/db/schema.ts';
import { importGazetteer } from '../src/gazetteer/import.ts';
import { loadGazetteer } from '../src/gazetteer/load.ts';
import { GazetteerService } from '../src/gazetteer/service.ts';
import { matchSubscription, type OutageStreetRow } from '../src/notify/match.ts';
import { startTestDb, type TestDb } from './helpers/db.ts';
import { createWorld, type World } from './helpers/world.ts';

// Streets that share a name in different places (BRIEF §3, Gazetteer): the real Niš data has
// Војводе Путника in the city and in Трупале, Чегарска in four places, Студеничка in three.

// ------------------------------------------------------------------ the matcher

describe('matching a saved address against a name that several streets share', () => {
  const row = (over: Partial<OutageStreetRow>): OutageStreetRow => ({
    segmentIndex: 0,
    streetId: null,
    settlementId: null,
    partial: false,
    houseFrom: null,
    houseTo: null,
    houseRaw: null,
    parity: null,
    resolvedBy: 'exact',
    candidates: null,
    ...over,
  });
  const sub = (streetId: number) => ({ streetId, settlementId: null, houseNumber: null });

  it('a placed segment concerns only its own street: the namesake is not told', () => {
    const rows = [row({ streetId: 15, resolvedBy: 'placed' })];
    expect(matchSubscription(sub(15), rows)).toEqual({ kind: 'affected' });
    expect(matchSubscription(sub(16), rows)).toBeNull(); // Војводе Путника in Трупале
  });

  it('an ambiguous segment is "possibly affected" for every candidate, and nobody else', () => {
    const rows = [
      row({
        resolvedBy: 'ambiguous',
        candidates: [
          { id: 235, score: 1 },
          { id: 237, score: 1 },
          { id: 238, score: 1 },
        ],
      }),
    ];
    for (const id of [235, 237, 238]) {
      expect(matchSubscription(sub(id), rows), String(id)).toEqual({
        kind: 'possible',
        reason: 'same_name',
      });
    }
    expect(matchSubscription(sub(236), rows)).toBeNull(); // the Чегарска of another municipality
  });

  it('every candidate counts, not only the best-scored five', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: 100 + i, score: 1 }));
    const rows = [row({ resolvedBy: 'ambiguous', candidates: many })];
    expect(matchSubscription(sub(107), rows)).toEqual({ kind: 'possible', reason: 'same_name' });
  });
});

// ------------------------------------------------------------------ the whole pipeline

let w: World;
let app: ReturnType<typeof buildApp>;
beforeAll(async () => {
  w = await createWorld();
  app = buildApp(
    { db: w.t.db, gazetteers: new GazetteerService(w.t.db), now: () => w.now },
    { allowDevTokens: true, logger: false },
  );
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  await w?.stop();
});

const entries = (norm: string) => w.gaz.streets.filter((s) => s.nameNorm === norm);
const inMun = (norm: string, mun: string) =>
  entries(norm).filter((s) => s.municipalities.includes(mun as never));

describe('an outage naming Војводе Путника', () => {
  const city = () =>
    entries('vojvode putnika').find((s) => s.settlement !== 'Трупале') as NisStreet;
  const trupale = () =>
    entries('vojvode putnika').find((s) => s.settlement === 'Трупале') as NisStreet;

  it('the gazetteer has two streets of that name, a municipality apart', () => {
    expect(entries('vojvode putnika')).toHaveLength(2);
    expect(city().municipalities).toContain('palilula');
    expect(trupale().municipalities).toEqual(['crveni krst']);
  });

  it('a Палилула row tells the city street and not the one in Трупале', async () => {
    const inCity = await w.addSub({ norm: 'vojvode putnika', streetId: Number(city().id) });
    const inTrupale = await w.addSub({ norm: 'vojvode putnika', streetId: Number(trupale().id) });
    await w.page('16.11.2026.', [['Палилула - Ниш', '08:00 - 10:00', 'Војводе Путника']]);
    await w.plan();
    await w.deliver();
    expect(w.titles(inCity.token)).toHaveLength(1);
    expect(w.titles(inTrupale.token)).toEqual([]);
    const row = (
      await w.t.db.execute(
        sql`SELECT os.street_id, os.resolved_by FROM outage_street os JOIN outage o ON o.id = os.outage_id
            WHERE o.outage_date = '2026-11-16'`,
      )
    ).rows[0];
    expect(row).toMatchObject({ street_id: city().id, resolved_by: 'placed' });
  });

  it('a Црвени крст row tells the one in Трупале and not the city street', async () => {
    const inCity = await w.addSub({ norm: 'vojvode putnika', streetId: Number(city().id) });
    const inTrupale = await w.addSub({ norm: 'vojvode putnika', streetId: Number(trupale().id) });
    await w.page('17.11.2026.', [['Црвени крст', '08:00 - 10:00', 'Војводе Путника']]);
    await w.plan();
    await w.deliver();
    expect(w.titles(inTrupale.token)).toHaveLength(1);
    expect(w.titles(inCity.token)).toEqual([]);
  });

  it('the detail draws only the street it means, and says which one it is', async () => {
    const id = Number(
      (
        await w.t.db.execute(
          sql`SELECT id FROM outage WHERE outage_date = '2026-11-16' AND raw_streets LIKE '%Путника%'`,
        )
      ).rows[0]?.id,
    );
    const detail = outageDetailSchema.parse(
      (await app.inject({ method: 'GET', url: `/v1/outages/${id}` })).json(),
    );
    expect(detail.segments[0]?.streetId).toBe(city().id);
    const features = detail.geometry.features as {
      properties: { streetId: number; candidate: boolean };
    }[];
    expect(features.map((f) => f.properties.streetId)).toEqual([city().id]);
    expect(features[0]?.properties.candidate).toBe(false);
  });
});

describe('an outage naming Чегарска where the row cannot say which', () => {
  // Pantelej has three Чегарска streets (Медијана, Горњи Матејевац, Каменица), Niška Banja a fourth.
  it('every Pantelej candidate is "Moguće", the one in another municipality hears nothing', async () => {
    const pantelej = inMun('cegarska', 'pantelej');
    expect(pantelej.length).toBeGreaterThanOrEqual(2);
    const other = inMun('cegarska', 'niska banja')[0] as NisStreet;
    const subs = await Promise.all(
      pantelej.map((s) => w.addSub({ norm: 'cegarska', streetId: Number(s.id) })),
    );
    const elsewhere = await w.addSub({ norm: 'cegarska', streetId: Number(other.id) });
    await w.page('18.11.2026.', [['Пантелеј', '10:00 - 12:00', 'Чегарске']]);
    await w.plan();
    await w.deliver();
    for (const s of subs) expect(w.titles(s.token), s.deviceId).toHaveLength(1);
    expect(w.titles(elsewhere.token)).toEqual([]);

    const res = (
      await w.t.db.execute(
        sql`SELECT street_id, resolved_by, candidates FROM outage_street os JOIN outage o ON o.id = os.outage_id
            WHERE o.outage_date = '2026-11-18'`,
      )
    ).rows[0] as { street_id: number | null; resolved_by: string; candidates: { id: number }[] };
    expect(res.street_id).toBeNull();
    expect(res.resolved_by).toBe('ambiguous');
    // every candidate is kept, not the top five
    expect(res.candidates.map((c) => c.id).sort()).toEqual(pantelej.map((s) => s.id).sort());
  });

  it('a new address on a candidate street sees the outage on screen as "Moguće"', async () => {
    const target = inMun('cegarska', 'pantelej')[0] as NisStreet;
    const c = await app.inject({
      method: 'POST',
      url: '/v1/devices',
      payload: {
        pushToken: 'dev-token:same-name-in-app',
        platform: 'android',
        locale: 'sr',
        script: 'latn',
      },
    });
    const { deviceId, deviceSecret } = c.json() as { deviceId: string; deviceSecret: string };
    const res = await app.inject({
      method: 'POST',
      url: '/v1/subscriptions',
      headers: { authorization: `Bearer ${deviceId}.${deviceSecret}` },
      payload: { streetId: Number(target.id) },
    });
    const body = res.json() as { outages: { match: string; reason: string | null }[] };
    expect(body.outages).toHaveLength(1);
    expect(body.outages[0]).toMatchObject({ match: 'possible', reason: 'same_name' });
  });

  it('the app is told "Moguće" for each, with the candidates drawn on the map', async () => {
    const pantelej = inMun('cegarska', 'pantelej');
    const target = pantelej[0] as NisStreet;
    const dev = await w.addSub({ norm: 'cegarska', streetId: Number(target.id) });
    const id = Number(
      (await w.t.db.execute(sql`SELECT id FROM outage WHERE outage_date = '2026-11-18'`)).rows[0]
        ?.id,
    );
    const token = (
      await w.t.db.execute(sql`SELECT d.push_token FROM device d WHERE d.id = ${dev.deviceId}`)
    ).rows[0]?.push_token;
    expect(token).toBe(dev.token);
    // the detail without credentials: the segment is one street nobody can name
    const anon = outageDetailSchema.parse(
      (await app.inject({ method: 'GET', url: `/v1/outages/${id}` })).json(),
    );
    expect(anon.segments[0]).toMatchObject({ kind: 'unresolved', streetId: null, name: null });
    const drawn = (
      anon.geometry.features as { properties: { streetId: number; candidate: boolean } }[]
    )
      .filter((f) => f.properties.candidate)
      .map((f) => f.properties.streetId)
      .sort();
    expect(drawn).toEqual(
      pantelej
        .filter((s) => s.lines.length > 0)
        .map((s) => s.id)
        .sort(),
    );
  });
});

// ------------------------------------------------------------------ the import

describe('importing streets that share a name', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t?.stop();
  });

  const mk = (
    id: number,
    key: string,
    at: [number, number],
    settlement: string,
    mun: NisStreet['municipalities'],
  ): NisStreet => ({
    id,
    clusterKey: key,
    settlement,
    name: 'Војводе Путника',
    nameNorm: 'vojvode putnika',
    altNorms: [],
    municipality: mun[0] ?? null,
    municipalities: mun,
    nameLatin: null,
    wayIds: [Number(key)],
    lines: [[at, [at[0] + 0.003, at[1] + 0.003]]],
    centroid: at,
  });
  const cityStreet = mk(1, '10', [43.309, 21.8767], 'Сточни трг', ['palilula']);
  const trupaleStreet = mk(2, '20', [43.3578, 21.8172], 'Трупале', ['crveni krst']);
  const gazetteer: NisGazetteer = { streets: [cityStreet, trupaleStreet], settlements: [] };
  const point = (lat: number, lon: number, hn: string) => ({
    tags: { 'addr:street': 'Војводе Путника', 'addr:housenumber': hn },
    lat,
    lon,
  });

  it('stores one row per street, with its settlement, and gives each address point to the nearest', async () => {
    const r = await importGazetteer(t.db, {
      city: 'Nis',
      gazetteer,
      addresses: [point(43.3092, 21.8769, '34'), point(43.358, 21.8175, '7')],
    });
    expect(r.streets).toBe(2);
    expect(r.addressPoints).toBe(2);
    const rows = (
      await t.db.execute(sql`
        SELECT s.cluster_key, s.settlement_name,
               (SELECT string_agg(a.housenumber, ',') FROM address_point a WHERE a.street_id = s.id) AS numbers
        FROM street s WHERE s.name_norm = 'vojvode putnika' ORDER BY s.cluster_key`)
    ).rows;
    expect(rows).toEqual([
      { cluster_key: '10', settlement_name: 'Сточни трг', numbers: '34' },
      { cluster_key: '20', settlement_name: 'Трупале', numbers: '7' },
    ]);
  });

  it('keeps street ids when the same streets are imported again', async () => {
    const before = (await loadGazetteer(t.db, 'Nis')).streets.map((s) => [s.clusterKey, s.id]);
    await importGazetteer(t.db, { city: 'Nis', gazetteer });
    const after = (await loadGazetteer(t.db, 'Nis')).streets.map((s) => [s.clusterKey, s.id]);
    expect(after).toEqual(before);
  });

  it('replaces the old, name-merged row: what pointed at it moves to the split street with the most geometry', async () => {
    const legacy = await t.db
      .insert(streetTable)
      .values({ city: 'Nis', nameCyrillic: 'Кружна', nameNorm: 'kruzna' })
      .returning();
    const old = legacy[0] as { id: number };
    await t.db.execute(sql`
      INSERT INTO device (push_token, device_secret_hash, platform) VALUES ('ExponentPushToken[legacy]', 'x', 'android')`);
    const dev = (
      await t.db.execute(sql`SELECT id FROM device WHERE push_token = 'ExponentPushToken[legacy]'`)
    ).rows[0] as { id: string };
    await t.db.execute(
      sql`INSERT INTO subscription (device_id, street_id, is_primary) VALUES (${dev.id}, ${old.id}, true)`,
    );
    const small = {
      ...mk(3, '30', [43.3, 21.9], 'Мала', ['medijana']),
      name: 'Кружна',
      nameNorm: 'kruzna',
    };
    const big = {
      ...mk(4, '40', [43.4, 22.0], 'Велика', ['pantelej']),
      name: 'Кружна',
      nameNorm: 'kruzna',
      lines: [
        [
          [43.4, 22.0],
          [43.41, 22.01],
        ] as [number, number][],
        [
          [43.41, 22.01],
          [43.42, 22.02],
        ] as [number, number][],
      ],
    };
    const r = await importGazetteer(t.db, {
      city: 'Nis',
      gazetteer: { streets: [cityStreet, trupaleStreet, small, big], settlements: [] },
    });
    expect(r.replacedLegacy).toBe(1);
    const moved = (
      await t.db.execute(sql`
        SELECT s.cluster_key FROM subscription sub JOIN street s ON s.id = sub.street_id
        WHERE sub.device_id = ${dev.id}`)
    ).rows[0];
    expect(moved).toEqual({ cluster_key: '40' });
    expect(
      (await t.db.execute(sql`SELECT count(*)::int AS n FROM street WHERE id = ${old.id}`)).rows[0],
    ).toEqual({ n: 0 });
  });

  it('exposes the settlement in the gazetteer the app downloads', async () => {
    const local = new GazetteerService(t.db);
    const app2 = buildApp({ db: t.db, gazetteers: local }, { allowDevTokens: true, logger: false });
    await app2.ready();
    const res = (await app2.inject({ method: 'GET', url: '/v1/cities/nis/gazetteer' })).json() as {
      streets: { nameNorm: string; settlement: string | null }[];
    };
    await app2.close();
    const vp = res.streets.filter((s) => s.nameNorm === 'vojvode putnika');
    expect(vp.map((s) => s.settlement).sort()).toEqual(['Сточни трг', 'Трупале']);
  });
});
