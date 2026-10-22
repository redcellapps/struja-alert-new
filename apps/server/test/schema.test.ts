import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  device,
  notificationLog,
  outage,
  scrapeRun,
  street,
  streetAlias,
  subscription,
} from '../src/db/schema.ts';
import { pgCode, startTestDb, type TestDb } from './helpers/db.ts';

let t: TestDb;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t?.stop();
});

async function seed() {
  const [s] = await t.db
    .insert(street)
    .values({ city: 'Nis', nameCyrillic: 'Студеничка', nameNorm: `studenicka-${Math.random()}` })
    .returning();
  const [d] = await t.db
    .insert(device)
    .values({
      pushToken: `ExponentPushToken[${Math.random()}]`,
      deviceSecretHash: 'hash',
      platform: 'android',
    })
    .returning();
  const [sub] = await t.db
    .insert(subscription)
    .values({ deviceId: d!.id, streetId: s!.id })
    .returning();
  const [run] = await t.db.insert(scrapeRun).values({ url: 'https://example.test/' }).returning();
  const [o] = await t.db
    .insert(outage)
    .values({
      sourceUrl: 'https://example.test/',
      contentHash: `hash-${Math.random()}`,
      identityKey: 'k',
      city: 'Nis',
      municipality: 'Пантелеј',
      outageDate: '2026-10-22',
      startsAt: new Date('2026-10-22T06:30:00Z'),
      endsAt: new Date('2026-10-22T08:30:00Z'),
      rawStreets: 'делови Студеничке;',
      firstSeenRun: run!.id,
      lastSeenRun: run!.id,
    })
    .returning();
  return { street: s!, device: d!, subscription: sub!, outage: o! };
}

describe('migrations on a real PostGIS database', () => {
  it('create the extensions and every table of BRIEF §4', async () => {
    const ext = await t.db.execute(sql`SELECT extname FROM pg_extension`);
    const names = ext.rows.map((r) => r.extname);
    expect(names).toEqual(expect.arrayContaining(['postgis', 'pg_trgm']));

    const tables = await t.db.execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining([
        'street',
        'settlement',
        'address_point',
        'street_alias',
        'gazetteer_version',
        'scrape_run',
        'outage',
        'outage_street',
        'device',
        'subscription',
        'notification_log',
        'live_activity_token',
        'report',
      ]),
    );
  });

  it('are idempotent: running them again changes nothing', async () => {
    const { runMigrations } = await import('../src/db/client.ts');
    await expect(runMigrations(t.db)).resolves.toBeUndefined();
  });
});

describe('notification_log dedupe (must never be dropped, BRIEF §8)', () => {
  it('rejects a second notification of the same kind for the same subscription and outage', async () => {
    const x = await seed();
    await t.db
      .insert(notificationLog)
      .values({ subscriptionId: x.subscription.id, outageId: x.outage.id, kind: 'new' });
    const dup = t.db
      .insert(notificationLog)
      .values({ subscriptionId: x.subscription.id, outageId: x.outage.id, kind: 'new' });
    await expect(dup).rejects.toSatisfy((e) => pgCode(e) === '23505');
  });
  it('allows a different kind, e.g. the evening-before reminder', async () => {
    const x = await seed();
    await t.db
      .insert(notificationLog)
      .values({ subscriptionId: x.subscription.id, outageId: x.outage.id, kind: 'new' });
    await expect(
      t.db.insert(notificationLog).values({
        subscriptionId: x.subscription.id,
        outageId: x.outage.id,
        kind: 'evening_before',
      }),
    ).resolves.toBeDefined();
  });
  it('still has the constraint in the database', async () => {
    const r = await t.db.execute(
      sql`SELECT conname FROM pg_constraint WHERE conname = 'notification_log_dedupe'`,
    );
    expect(r.rows).toHaveLength(1);
  });
});

describe('other constraints', () => {
  it('a subscription follows exactly one of street / settlement', async () => {
    const x = await seed();
    const none = t.db.insert(subscription).values({ deviceId: x.device.id });
    await expect(none).rejects.toSatisfy((e) => pgCode(e) === '23514');
  });
  it('street names are unique per city, aliases unique by normalized text', async () => {
    const s = await t.db
      .insert(street)
      .values({ city: 'Nis', nameCyrillic: 'Чегарска', nameNorm: 'cegarska' })
      .returning();
    await expect(
      t.db.insert(street).values({ city: 'Nis', nameCyrillic: 'Чегарска', nameNorm: 'cegarska' }),
    ).rejects.toSatisfy((e) => pgCode(e) === '23505');
    // The same name in another city is a different street.
    await expect(
      t.db
        .insert(street)
        .values({ city: 'Kraljevo', nameCyrillic: 'Чегарска', nameNorm: 'cegarska' }),
    ).resolves.toBeDefined();
    await t.db.insert(streetAlias).values({
      streetId: s[0]!.id,
      raw: 'Чегарске',
      rawNorm: 'cegarske',
      confidence: 1,
      source: 'manual',
    });
    await expect(
      t.db.insert(streetAlias).values({
        streetId: s[0]!.id,
        raw: 'ЧЕГАРСКЕ',
        rawNorm: 'cegarske',
        confidence: 1,
        source: 'manual',
      }),
    ).rejects.toSatisfy((e) => pgCode(e) === '23505');
  });
  it('an outage with the same content hash is stored once', async () => {
    const x = await seed();
    const again = t.db.insert(outage).values({
      sourceUrl: 'x',
      contentHash: x.outage.contentHash,
      identityKey: 'k',
      city: 'Nis',
      municipality: 'Пантелеј',
      outageDate: '2026-10-22',
      startsAt: new Date(),
      endsAt: new Date(),
      rawStreets: '',
      firstSeenRun: x.outage.firstSeenRun,
      lastSeenRun: x.outage.lastSeenRun,
    });
    await expect(again).rejects.toSatisfy((e) => pgCode(e) === '23505');
  });
  it('deleting a device removes its subscriptions and their notification log (delete my data)', async () => {
    const x = await seed();
    await t.db
      .insert(notificationLog)
      .values({ subscriptionId: x.subscription.id, outageId: x.outage.id, kind: 'new' });
    await t.db.execute(sql`DELETE FROM device WHERE id = ${x.device.id}`);
    const left = await t.db.execute(
      sql`SELECT count(*)::int AS n FROM notification_log WHERE subscription_id = ${x.subscription.id}`,
    );
    expect(left.rows[0]?.n).toBe(0);
  });
});

describe('PostGIS geometry', () => {
  it('stores a street as a MultiLineString and reads it back as GeoJSON', async () => {
    await t.db.execute(sql`
      INSERT INTO street (city, name_cyrillic, name_norm, geom)
      VALUES ('Nis', 'Геом', 'geom-test',
              ST_GeomFromText('MULTILINESTRING((21.9 43.3, 21.91 43.31),(21.92 43.32, 21.93 43.33))', 4326))`);
    const r = await t.db.execute(
      sql`SELECT ST_AsGeoJSON(geom)::json AS g, ST_NumGeometries(geom) AS n FROM street WHERE name_norm = 'geom-test'`,
    );
    expect(r.rows[0]?.n).toBe(2);
    expect((r.rows[0]?.g as { type: string }).type).toBe('MultiLineString');
  });
  it('pg_trgm similarity works on street names', async () => {
    const r = await t.db.execute(sql`SELECT similarity('studenicka', 'studenika') AS s`);
    expect(Number(r.rows[0]?.s)).toBeGreaterThan(0.4);
  });
});
