import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addressOutageSchema,
  cityOutagesResponseSchema,
  errorSchema,
  myOutagesResponseSchema,
  outageDetailSchema,
  registerDeviceResponseSchema,
  subscriptionsResponseSchema,
  subscriptionWithOutagesSchema,
} from '@struja/shared';
import { buildApp } from '../src/app.ts';
import { GazetteerService } from '../src/gazetteer/service.ts';
import { planEveningBefore } from '../src/notify/plan.ts';
import { createWorld, type World } from './helpers/world.ts';

let w: World;
let app: ReturnType<typeof buildApp>;
let seq = 0;

beforeAll(async () => {
  w = await createWorld();
  app = buildApp(
    { db: w.t.db, gazetteers: new GazetteerService(w.t.db), now: () => w.now },
    { devicesPerHour: 1000 },
  );
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  await w?.stop();
});

interface Client {
  id: string;
  secret: string;
  token: string;
  headers: { authorization: string };
}

async function register(over: Record<string, unknown> = {}): Promise<Client> {
  const token = `ExponentPushToken[api${++seq}]`;
  const res = await app.inject({
    method: 'POST',
    url: '/v1/devices',
    payload: { pushToken: token, platform: 'android', ...over },
  });
  expect(res.statusCode).toBe(201);
  const body = registerDeviceResponseSchema.parse(res.json());
  return {
    id: body.deviceId,
    secret: body.deviceSecret,
    token,
    headers: { authorization: `Bearer ${body.deviceId}.${body.deviceSecret}` },
  };
}

const call = (
  c: Client,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    headers: c.headers,
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

const sid = (norm: string) => w.sid(norm);
const delivered = (token: string) =>
  w.provider.sent.filter((m) => m.to === token).map((m) => m.title);

describe('devices and authentication', () => {
  it('registers a device and stores only a hash of its secret', async () => {
    const c = await register();
    const row = (
      await w.t.db.execute(sql`SELECT device_secret_hash FROM device WHERE id = ${c.id}`)
    ).rows[0];
    expect(String(row?.device_secret_hash)).toMatch(/^scrypt\$/);
    expect(String(row?.device_secret_hash)).not.toContain(c.secret);
    expect(c.secret.length).toBeGreaterThanOrEqual(40);
  });

  it('a push token already on file is taken over: the old device and its addresses are dropped', async () => {
    const c = await register();
    expect(
      (await call(c, 'POST', '/v1/subscriptions', { streetId: sid('studenicka') })).statusCode,
    ).toBe(201);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/devices',
      payload: { pushToken: c.token, platform: 'ios' },
    });
    expect(res.statusCode).toBe(201);
    const fresh = res.json() as { deviceId: string; deviceSecret: string };
    expect(fresh.deviceId).not.toBe(c.id);
    // the old credentials stop working, the new ones work
    const old = await app.inject({
      method: 'GET',
      url: '/v1/devices/me',
      headers: { authorization: `Bearer ${c.id}.${c.secret}` },
    });
    expect(old.statusCode).toBe(401);
    const now = await app.inject({
      method: 'GET',
      url: '/v1/devices/me',
      headers: { authorization: `Bearer ${fresh.deviceId}.${fresh.deviceSecret}` },
    });
    expect(now.statusCode).toBe(200);
    // the old addresses are gone: the app registers its own list again
    const mine = subscriptionsResponseSchema.parse(
      (
        await call(
          {
            ...c,
            id: fresh.deviceId,
            headers: { authorization: `Bearer ${fresh.deviceId}.${fresh.deviceSecret}` },
          },
          'GET',
          '/v1/subscriptions',
        )
      ).json(),
    );
    expect(mine.subscriptions).toHaveLength(0);
    const left = await w.t.db.execute(
      sql`SELECT count(*)::int AS n FROM subscription WHERE device_id = ${c.id}`,
    );
    expect(Number(left.rows[0]?.n)).toBe(0);
  });

  it('validates input with a 400 that names the problem', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/devices',
      payload: { pushToken: 'ExponentPushToken[x1]', platform: 'windows' },
    });
    expect(res.statusCode).toBe(400);
    const e = errorSchema.parse(res.json());
    expect(e.error.code).toBe('invalid_request');
    expect(e.error.message).toContain('platform');
  });

  it('rejects missing, malformed and wrong credentials the same way', async () => {
    const c = await register();
    const bad = [
      undefined,
      'Bearer nonsense',
      `Bearer ${c.id}.${'x'.repeat(43)}`,
      `Bearer 00000000-0000-0000-0000-000000000000.${c.secret}`,
    ];
    for (const authorization of bad) {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/devices/me',
        headers: authorization ? { authorization } : {},
      });
      expect(res.statusCode, String(authorization)).toBe(401);
      expect(errorSchema.parse(res.json()).error.code).toBe('unauthorized');
    }
    expect((await call(c, 'GET', '/v1/devices/me')).statusCode).toBe(200);
  });

  it('updates language, script, quiet hours and notification kinds', async () => {
    const c = await register();
    const res = await call(c, 'PATCH', '/v1/devices/me', {
      locale: 'en',
      script: 'cyrl',
      quietHours: { start: '23:00', end: '06:30' },
      enabledKinds: ['new', 'cancelled'],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      locale: 'en',
      script: 'cyrl',
      quietHours: { start: '23:00', end: '06:30' },
      enabledKinds: ['new', 'cancelled'],
    });
    expect(
      (await call(c, 'PATCH', '/v1/devices/me', { quietHours: null })).json().quietHours,
    ).toBeNull();
  });

  it('refreshes the push token, but not onto another device’s token', async () => {
    const a = await register();
    const b = await register();
    expect(
      (await call(a, 'PATCH', '/v1/devices/me', { pushToken: 'ExponentPushToken[fresh1]' }))
        .statusCode,
    ).toBe(200);
    const clash = await call(b, 'PATCH', '/v1/devices/me', {
      pushToken: 'ExponentPushToken[fresh1]',
    });
    expect(clash.statusCode).toBe(409);
  });

  it('rejects empty or invalid patches', async () => {
    const c = await register();
    expect((await call(c, 'PATCH', '/v1/devices/me', {})).statusCode).toBe(400);
    expect(
      (await call(c, 'PATCH', '/v1/devices/me', { quietHours: { start: '25:00', end: '07:00' } }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call(c, 'PATCH', '/v1/devices/me', { enabledKinds: ['nonsense'] })).statusCode,
    ).toBe(400);
  });

  it('rate limits registrations per IP', async () => {
    const limited = buildApp(
      { db: w.t.db, gazetteers: new GazetteerService(w.t.db) },
      { devicesPerHour: 2 },
    );
    await limited.ready();
    const reg = (n: number) =>
      limited.inject({
        method: 'POST',
        url: '/v1/devices',
        payload: { pushToken: `ExponentPushToken[rl${seq}-${n}]`, platform: 'android' },
      });
    expect((await reg(1)).statusCode).toBe(201);
    expect((await reg(2)).statusCode).toBe(201);
    const third = await reg(3);
    expect(third.statusCode).toBe(429);
    expect(errorSchema.parse(third.json()).error.code).toBe('rate_limited');
    await limited.close();
  });

  it('returns a JSON error for an unknown route', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/nothing' });
    expect(res.statusCode).toBe(404);
    expect(errorSchema.parse(res.json()).error.code).toBe('not_found');
  });
});

describe('saved addresses', () => {
  it('the first address is primary; at most three; a fourth is refused', async () => {
    const c = await register();
    const make = (norm: string, extra: object = {}) =>
      call(c, 'POST', '/v1/subscriptions', { streetId: sid(norm), ...extra });
    const first = subscriptionWithOutagesSchema.parse(
      (await make('studenicka', { label: 'Kuća' })).json(),
    );
    expect(first.subscription).toMatchObject({ isPrimary: true, label: 'Kuća' });
    expect(first.subscription.name.cyrillic).toBe('Студеничка');
    const second = subscriptionWithOutagesSchema.parse(
      (await make('cegarska', { houseNumber: 31 })).json(),
    );
    expect(second.subscription.isPrimary).toBe(false);
    await make('kosmajska');
    const fourth = await make('trebinjska');
    expect(fourth.statusCode).toBe(409);
    expect(errorSchema.parse(fourth.json()).error.code).toBe('limit_reached');

    const list = subscriptionsResponseSchema.parse(
      (await call(c, 'GET', '/v1/subscriptions')).json(),
    );
    expect(list.subscriptions).toHaveLength(3);
    expect(list.max).toBe(3);
  });

  it('refuses unknown streets, inactive cities, and ambiguous requests', async () => {
    const c = await register();
    expect((await call(c, 'POST', '/v1/subscriptions', { streetId: 99999999 })).statusCode).toBe(
      404,
    );
    expect(
      (await call(c, 'POST', '/v1/subscriptions', { city: 'beograd', streetId: sid('cegarska') }))
        .statusCode,
    ).toBe(404);
    expect(
      (await call(c, 'POST', '/v1/subscriptions', { city: 'atlantida', streetId: sid('cegarska') }))
        .statusCode,
    ).toBe(404);
    expect(
      (await call(c, 'POST', '/v1/subscriptions', { streetId: 1, settlementId: 1 })).statusCode,
    ).toBe(400);
    expect((await call(c, 'POST', '/v1/subscriptions', {})).statusCode).toBe(400);
  });

  it('a village can be saved instead of a street', async () => {
    const c = await register();
    const village = w.gaz.settlements.find((s) => s.name === 'Трупале');
    const res = await call(c, 'POST', '/v1/subscriptions', { settlementId: Number(village?.id) });
    expect(res.statusCode).toBe(201);
    expect(res.json().subscription).toMatchObject({
      streetId: null,
      name: { cyrillic: 'Трупале' },
    });
  });

  it('changes label and primary, but never leaves the person without a primary address', async () => {
    const c = await register();
    const a = (await call(c, 'POST', '/v1/subscriptions', { streetId: sid('studenicka') })).json()
      .subscription;
    const b = (await call(c, 'POST', '/v1/subscriptions', { streetId: sid('cegarska') })).json()
      .subscription;
    expect(
      (await call(c, 'PATCH', `/v1/subscriptions/${a.id}`, { isPrimary: false })).statusCode,
    ).toBe(400);
    const made = await call(c, 'PATCH', `/v1/subscriptions/${b.id}`, {
      isPrimary: true,
      label: 'Posao',
    });
    expect(made.json().subscription).toMatchObject({ isPrimary: true, label: 'Posao' });
    const list = (await call(c, 'GET', '/v1/subscriptions')).json().subscriptions;
    expect(list.filter((s: { isPrimary: boolean }) => s.isPrimary)).toHaveLength(1);
  });

  it('deleting the primary address promotes another one', async () => {
    const c = await register();
    const a = (await call(c, 'POST', '/v1/subscriptions', { streetId: sid('studenicka') })).json()
      .subscription;
    await call(c, 'POST', '/v1/subscriptions', { streetId: sid('cegarska') });
    expect((await call(c, 'DELETE', `/v1/subscriptions/${a.id}`)).statusCode).toBe(204);
    const list = (await call(c, 'GET', '/v1/subscriptions')).json().subscriptions;
    expect(list).toHaveLength(1);
    expect(list[0].isPrimary).toBe(true);
  });

  it('nobody can read, change or delete another device’s address', async () => {
    const mine = await register();
    const theirs = await register();
    const s = (
      await call(mine, 'POST', '/v1/subscriptions', { streetId: sid('studenicka') })
    ).json().subscription;
    expect(
      (await call(theirs, 'PATCH', `/v1/subscriptions/${s.id}`, { label: 'x' })).statusCode,
    ).toBe(404);
    expect((await call(theirs, 'DELETE', `/v1/subscriptions/${s.id}`)).statusCode).toBe(404);
    expect((await call(theirs, 'GET', '/v1/subscriptions')).json().subscriptions).toEqual([]);
  });
});

describe('a new address: shown on screen, not pushed (decision of 22 Oct)', () => {
  const date = '10.11.2026.';
  const keep: [string, string, string] = ['Палилула - Ниш', '20:00 - 21:00', 'Требињске'];

  it('returns the already published outages, records them as told in the app, and pushes nothing', async () => {
    await w.page(date, [['Пантелеј', '08:00 - 10:00', 'Студеничке'], keep]);
    const c = await register();
    const res = await call(c, 'POST', '/v1/subscriptions', { streetId: sid('studenicka') });
    const body = subscriptionWithOutagesSchema.parse(res.json());
    expect(body.outages).toHaveLength(1);
    expect(body.outages[0]).toMatchObject({
      match: 'affected',
      status: 'active',
      municipality: 'Пантелеј',
    });
    expect(body.outages[0]?.startsAt).toBe('2026-11-10T07:00:00.000Z'); // 08:00 CET

    const log = await w.t.db.execute(
      sql`SELECT kind, status, revision FROM notification_log WHERE subscription_id = ${body.subscription.id}`,
    );
    expect(log.rows).toEqual([{ kind: 'new', status: 'in_app', revision: 0 }]);

    await w.plan();
    await w.deliver();
    expect(delivered(c.token)).toEqual([]); // nothing was pushed for what is already published
  });

  it('later changes still reach the person: "Izmena" for a changed time', async () => {
    const c = await register();
    await call(c, 'POST', '/v1/subscriptions', { streetId: sid('studenicka') });
    await w.page(date, [['Пантелеј', '09:00 - 11:00', 'Студеничке'], keep]); // EDS moves it
    await w.plan();
    await w.deliver();
    expect(delivered(c.token)).toHaveLength(1);
    expect(delivered(c.token)[0]).toMatch(/^Izmena: Studenič.+, novo vreme 09:00–11:00$/);
  });

  it('later cancellations still reach the person: "Otkazano"', async () => {
    const d = '11.11.2026.';
    const k: [string, string, string] = ['Палилула - Ниш', '20:00 - 21:00', 'Требињске'];
    const k2: [string, string, string] = ['Палилула - Ниш', '21:00 - 22:00', 'Космајске'];
    await w.page(d, [['Пантелеј', '08:00 - 10:00', 'Чегарске'], k, k2]);
    const c = await register();
    await call(c, 'POST', '/v1/subscriptions', { streetId: sid('cegarska') });
    await w.page(d, [k, k2]);
    await w.page(d, [k, k2]); // gone twice
    await w.plan();
    await w.deliver();
    expect(delivered(c.token)).toHaveLength(1);
    expect(delivered(c.token)[0]).toMatch(/^Otkazano: isključenje .+, Čegarska$/);
  });

  it('the 19:15 reminder still goes out', async () => {
    const d = '12.11.2026.';
    await w.page(d, [['Нишка бања', '08:00 - 10:00', 'Космајске'], keep]);
    const c = await register();
    await call(c, 'POST', '/v1/subscriptions', { streetId: sid('kosmajska') });
    const evening = new Date('2026-11-11T18:15:00Z'); // 19:15 local the day before
    await planEveningBefore(w.t.db, evening);
    await w.deliver(evening);
    expect(delivered(c.token)).toHaveLength(1);
    expect(delivered(c.token)[0]).toMatch(/^Sutra bez struje: Kosmajska, 08:00–10:00$/);
  });

  it('house numbers decide which published outages are returned, and changing the number re-evaluates', async () => {
    const d = '13.11.2026.';
    await w.page(d, [
      ['Нишка бања', '12:00 - 14:00', 'Чегарске (непарни бр. 9-53, парни бр. 30-44)'],
      keep,
    ]);
    const c = await register();
    const made = await call(c, 'POST', '/v1/subscriptions', {
      streetId: sid('cegarska'),
      houseNumber: 10,
    });
    const sub = made.json().subscription;
    expect(
      made.json().outages.filter((o: { outageDate: string }) => o.outageDate === '2026-11-13'),
    ).toEqual([]);
    const moved = await call(c, 'PATCH', `/v1/subscriptions/${sub.id}`, { houseNumber: 31 });
    const hit = moved
      .json()
      .outages.filter((o: { outageDate: string }) => o.outageDate === '2026-11-13');
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ match: 'affected' });
  });

  it('no house number on a ranged outage is "possibly affected" with a reason', async () => {
    const c = await register();
    const made = await call(c, 'POST', '/v1/subscriptions', { streetId: sid('cegarska') });
    const found = made
      .json()
      .outages.find((o: { outageDate: string }) => o.outageDate === '2026-11-13');
    expect(found).toMatchObject({ match: 'possible', reason: 'no_number' });
  });
});

describe('outages for the app', () => {
  const date = '14.11.2026.';
  const keep: [string, string, string] = ['Палилула - Ниш', '20:00 - 21:00', 'Требињске'];

  it('lists upcoming and past outages for my addresses; replaced rows never appear', async () => {
    await w.page(date, [['Пантелеј', '08:00 - 10:00', 'Бубањске долине'], keep]);
    await w.page(date, [['Пантелеј', '09:00 - 11:00', 'Бубањске долине'], keep]); // replaces the first
    const c = await register();
    await call(c, 'POST', '/v1/subscriptions', { streetId: sid('bubanjska dolina') });
    const up = myOutagesResponseSchema.parse(
      (await call(c, 'GET', '/v1/me/outages?range=upcoming')).json(),
    );
    const mine = up.outages.filter((o) => o.outageDate === '2026-11-14');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ status: 'changed', startsAt: '2026-11-14T08:00:00.000Z' });

    const history = await app.inject({
      method: 'GET',
      url: '/v1/me/outages?range=history',
      headers: c.headers,
    });
    expect(history.statusCode).toBe(200);
    expect(myOutagesResponseSchema.parse(history.json()).outages).toEqual([]);
    expect((await call(c, 'GET', '/v1/me/outages?range=nonsense')).statusCode).toBe(400);
  });

  it('shows a really cancelled outage as cancelled', async () => {
    const d2 = '15.11.2026.';
    const k2: [string, string, string] = ['Палилула - Ниш', '21:00 - 22:00', 'Космајске'];
    await w.page(d2, [['Пантелеј', '08:00 - 10:00', 'Требињске'], keep, k2]);
    const c = await register();
    await call(c, 'POST', '/v1/subscriptions', { streetId: sid('trebinjska') });
    await w.page(d2, [keep, k2]);
    await w.page(d2, [keep, k2]);
    const up = (await call(c, 'GET', '/v1/me/outages?range=upcoming')).json().outages;
    expect(up.find((o: { outageDate: string }) => o.outageDate === '2026-11-15')).toMatchObject({
      status: 'cancelled',
    });
  });

  it('outage detail: parsed streets and ranges, the raw text verbatim, geometry, the source', async () => {
    const d3 = '16.11.2026.';
    const raw = 'Чегарске (непарни бр. 9-53, парни бр. 30-44), Студеничке';
    const page = await w.page(d3, [['Нишка бања', '12:00 - 14:00', raw], keep]);
    expect(page.inserted).toBe(2);
    const id = Number(
      (await w.t.db.execute(sql`SELECT id FROM outage WHERE raw_streets = ${raw}`)).rows[0]?.id,
    );
    const c = await register();
    await call(c, 'POST', '/v1/subscriptions', { streetId: sid('cegarska'), houseNumber: 31 });

    const anon = outageDetailSchema.parse(
      (await app.inject({ method: 'GET', url: `/v1/outages/${id}` })).json(),
    );
    expect(anon.rawStreets).toBe(raw);
    expect(anon.segments.map((s) => s.name?.cyrillic)).toEqual(['Чегарска', 'Студеничка']);
    expect(anon.segments[0]?.ranges).toEqual([
      { raw: 'непарни бр. 9-53', from: 9, to: 53, parity: 'odd' },
      { raw: 'парни бр. 30-44', from: 30, to: 44, parity: 'even' },
    ]);
    expect(anon.geometry.features.length).toBeGreaterThanOrEqual(1);
    expect((anon.geometry.features[0] as { geometry: { type: string } }).geometry.type).toBe(
      'MultiLineString',
    );
    expect(anon.source.name).toBe('Elektrodistribucija Srbije');
    expect(anon.mine).toEqual([]); // not signed in: nothing personal

    const signed = outageDetailSchema.parse((await call(c, 'GET', `/v1/outages/${id}`)).json());
    expect(signed.mine).toHaveLength(1);
    expect(signed.mine[0]).toMatchObject({ match: 'affected' });
  });

  it('does not expose rows outside the app’s scope, and 404s an unknown id', async () => {
    const out = await w.t.db.execute(sql`SELECT id FROM outage WHERE NOT in_scope LIMIT 1`);
    if (out.rows[0]) {
      expect(
        (await app.inject({ method: 'GET', url: `/v1/outages/${out.rows[0].id}` })).statusCode,
      ).toBe(404);
    }
    expect((await app.inject({ method: 'GET', url: '/v1/outages/99999999' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/v1/outages/abc' })).statusCode).toBe(404);
  });

  it('city-wide browse, by day', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/cities/nis/outages?date=2026-11-14' });
    const body = cityOutagesResponseSchema.parse(res.json());
    expect(body.city).toBe('nis');
    expect(body.outages.length).toBeGreaterThan(0);
    expect(body.outages.every((o) => o.outageDate === '2026-11-14')).toBe(true);
    expect(body.outages.some((o) => o.streets.some((s) => s.startsWith('Bubanjska')))).toBe(true);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/cities/nis/outages?date=tomorrow' })).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/cities/beograd/outages' })).statusCode,
    ).toBe(404);
    const all = cityOutagesResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/v1/cities/nis/outages' })).json(),
    );
    expect(all.outages.length).toBeGreaterThanOrEqual(body.outages.length);
  });
});

describe('reports and deleting my data', () => {
  it('accepts a report about an outage, from the person who owns the address', async () => {
    const c = await register();
    const sub = (await call(c, 'POST', '/v1/subscriptions', { streetId: sid('studenicka') })).json()
      .subscription;
    const outageId = Number((await w.t.db.execute(sql`SELECT id FROM outage LIMIT 1`)).rows[0]?.id);
    const ok = await call(c, 'POST', '/v1/reports', {
      outageId,
      subscriptionId: sub.id,
      message: 'Struje ima, a piše da nema',
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().id).toBeGreaterThan(0);
    const other = await register();
    expect(
      (await call(other, 'POST', '/v1/reports', { subscriptionId: sub.id, message: 'tuđa adresa' }))
        .statusCode,
    ).toBe(404);
    expect(
      (await call(c, 'POST', '/v1/reports', { outageId: 99999999, message: 'nepostojeće' }))
        .statusCode,
    ).toBe(404);
    expect((await call(c, 'POST', '/v1/reports', { message: 'x' })).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/reports',
          payload: { message: 'bez prijave' },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('"Obriši sve moje podatke" removes the device, its addresses, its log and its reports', async () => {
    const c = await register();
    const sub = (await call(c, 'POST', '/v1/subscriptions', { streetId: sid('studenicka') })).json()
      .subscription;
    await call(c, 'POST', '/v1/reports', { subscriptionId: sub.id, message: 'moja prijava' });
    const counts = async () =>
      Number(
        (
          await w.t.db.execute(sql`
            SELECT (SELECT count(*) FROM device WHERE id = ${c.id})
                 + (SELECT count(*) FROM subscription WHERE device_id = ${c.id})
                 + (SELECT count(*) FROM notification_log WHERE subscription_id = ${sub.id})
                 + (SELECT count(*) FROM report WHERE subscription_id = ${sub.id} OR message = 'moja prijava') AS n`)
        ).rows[0]?.n,
      );
    expect(await counts()).toBeGreaterThan(0);
    expect((await call(c, 'DELETE', '/v1/devices/me')).statusCode).toBe(204);
    expect(await counts()).toBe(0);
    expect((await call(c, 'GET', '/v1/devices/me')).statusCode).toBe(401); // the credentials are gone too
  });
});

describe('contracts', () => {
  it('every address outage matches the shared schema', async () => {
    const c = await register();
    const made = await call(c, 'POST', '/v1/subscriptions', { streetId: sid('studenicka') });
    for (const o of made.json().outages) addressOutageSchema.parse(o);
  });
});
