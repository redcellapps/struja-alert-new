import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cityOutagesResponseSchema,
  deviceSchema,
  myOutagesResponseSchema,
  outageDetailSchema,
  subscriptionWithOutagesSchema,
  subscriptionsResponseSchema,
} from '@struja/shared';
import { createMockServer } from './server.ts';
import { SCENARIOS } from './scenarios.ts';

// Every development scenario answers with shapes the app's schemas accept, and means what its name says.
const NOW = new Date('2026-11-03T05:00:00Z'); // 06:00 in Belgrade
const MIN = 60_000;
let server: ReturnType<typeof createMockServer>;
let base: string;
let auth: { authorization: string };

const get = (path: string) => fetch(`${base}${path}`, { headers: auth });
const scenario = (name: string) =>
  fetch(`${base}/__dev/scenario`, { method: 'POST', body: JSON.stringify({ name }) });
const outages = async () =>
  myOutagesResponseSchema.parse(await (await get('/v1/me/outages?range=upcoming')).json()).outages;

beforeAll(async () => {
  server = createMockServer({ now: () => NOW });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const dev = (await (
    await fetch(`${base}/v1/devices`, {
      method: 'POST',
      body: JSON.stringify({
        pushToken: 'dev-token:t',
        platform: 'android',
        locale: 'sr',
        script: 'latn',
      }),
    })
  ).json()) as { deviceId: string; deviceSecret: string };
  auth = { authorization: `Bearer ${dev.deviceId}.${dev.deviceSecret}` };
  const added = await fetch(`${base}/v1/subscriptions`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ city: 'nis', streetId: 1, houseNumber: 34, label: 'Kuća' }),
  });
  subscriptionWithOutagesSchema.parse(await added.json());
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('mock scenarios', () => {
  it('rejects an unknown scenario and reports the current one', async () => {
    expect((await scenario('nope')).status).toBe(400);
    expect(await (await scenario('upcoming')).json()).toEqual({ scenario: 'upcoming' });
  });

  it('clear: no outages', async () => {
    await scenario('clear');
    expect(await outages()).toEqual([]);
  });

  it('imminent: starts in 2 h 20 min', async () => {
    await scenario('imminent');
    const [o] = await outages();
    expect(Date.parse(o!.startsAt) - NOW.getTime()).toBe(140 * MIN);
  });

  it('active: running now, ends in 1 h 12 min', async () => {
    await scenario('active');
    const [o] = await outages();
    expect(Date.parse(o!.startsAt)).toBeLessThan(NOW.getTime());
    expect(Date.parse(o!.endsAt) - NOW.getTime()).toBe(72 * MIN);
  });

  it('cancelled: the outage is cancelled', async () => {
    await scenario('cancelled');
    expect((await outages())[0]?.status).toBe('cancelled');
  });

  it('three: three addresses, an active, an imminent and a partial-possible outage', async () => {
    await scenario('three');
    const subs = subscriptionsResponseSchema.parse(await (await get('/v1/subscriptions')).json());
    expect(subs.subscriptions.map((s) => s.name.latin)).toEqual([
      'Vojvode Mišića',
      'Studenička',
      'Bulevar Nemanjića',
    ]);
    const list = await outages();
    expect(list).toHaveLength(3);
    expect(list[2]).toMatchObject({ match: 'possible', reason: 'partial' });
  });

  it('possible: the address loses its number, the outage is a possible match, adding the number settles it', async () => {
    await scenario('possible');
    const sub = subscriptionsResponseSchema.parse(await (await get('/v1/subscriptions')).json())
      .subscriptions[0]!;
    expect(sub.houseNumber).toBeNull();
    expect((await outages())[0]).toMatchObject({ match: 'possible', reason: 'no_number' });
    const patched = await fetch(`${base}/v1/subscriptions/${sub.id}`, {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({ houseNumber: 34, houseSuffix: null }),
    });
    expect(subscriptionWithOutagesSchema.parse(await patched.json()).outages[0]?.match).toBe(
      'affected',
    );
    expect((await outages())[0]?.match).toBe('affected');
  });

  it('offline: the connection drops for /v1, not for the dev control', async () => {
    await scenario('offline');
    await expect(get('/v1/me/outages')).rejects.toThrow();
    expect((await scenario('upcoming')).status).toBe(200);
    expect((await outages()).length).toBeGreaterThan(0);
  });

  it('fail: every /v1 request is a 500 in the shape of the server, the dev control still works', async () => {
    await scenario('fail');
    for (const path of ['/v1/me/outages', '/v1/cities/nis/outages', '/v1/subscriptions']) {
      const res = await get(path);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: { code: 'internal', message: 'Something went wrong' },
      });
    }
    expect((await scenario('upcoming')).status).toBe(200);
    expect((await outages()).length).toBeGreaterThan(0);
  });

  it('knows the scenarios the screenshot script uses', () => {
    expect([...SCENARIOS]).toEqual([
      'clear',
      'upcoming',
      'imminent',
      'active',
      'cancelled',
      'possible',
      'three',
      'offline',
      'fail',
    ]);
  });
});

describe('mock city list, history and detail', () => {
  const cityList = async () =>
    cityOutagesResponseSchema.parse(await (await fetch(`${base}/v1/cities/nis/outages`)).json());
  const outageDetail = async (id: number) =>
    outageDetailSchema.parse(await (await get(`/v1/outages/${id}`)).json());

  it('lists the outages of the city, soonest first, with the person’s own among them', async () => {
    await scenario('upcoming');
    const { outages } = await cityList();
    expect(outages.length).toBeGreaterThanOrEqual(6);
    const starts = outages.map((o) => Date.parse(o.startsAt));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(outages.some((o) => o.status === 'cancelled')).toBe(true);
    expect(outages.some((o) => o.status === 'changed')).toBe(true);
    for (const o of outages) expect(Date.parse(o.endsAt)).toBeGreaterThan(NOW.getTime());
  });

  it('a quiet city and a new person: nothing to list in "clear"', async () => {
    await scenario('clear');
    expect((await cityList()).outages).toEqual([]);
    const history = myOutagesResponseSchema.parse(
      await (await get('/v1/me/outages?range=history')).json(),
    );
    expect(history.outages).toEqual([]);
  });

  it('keeps a history of past outages for the person’s addresses, one cancelled', async () => {
    await scenario('upcoming');
    const { outages } = myOutagesResponseSchema.parse(
      await (await get('/v1/me/outages?range=history')).json(),
    );
    expect(outages.length).toBeGreaterThanOrEqual(5);
    for (const o of outages) expect(Date.parse(o.endsAt)).toBeLessThan(NOW.getTime());
    expect(outages.some((o) => o.status === 'cancelled')).toBe(true);
  });

  it('answers the detail of a city outage, a history outage and an own outage', async () => {
    await scenario('upcoming');
    const city = (await cityList()).outages.find((o) => o.id === 2002)!;
    const d = await outageDetail(2002);
    expect(d.startsAt).toBe(city.startsAt);
    expect(d.mine).toEqual([]);
    expect(d.segments.map((s) => s.name?.cyrillic)).toEqual(city.streets);
    expect(d.segments[0]?.name?.latin).toBe('Bulevar Nemanjića');
    const history = myOutagesResponseSchema.parse(
      await (await get('/v1/me/outages?range=history')).json(),
    ).outages;
    expect((await outageDetail(history[0]!.id)).startsAt).toBe(history[0]!.startsAt);
    const own = (await outages())[0]!;
    expect((await outageDetail(own.id)).mine[0]?.subscriptionId).toBe(own.subscriptionId);
    expect((await get('/v1/outages/999999')).status).toBe(404);
  });
});

describe('mock device settings', () => {
  const device = async () => deviceSchema.parse(await (await get('/v1/devices/me')).json());

  it('starts with the default quiet hours and every kind, and takes changes', async () => {
    expect(await device()).toMatchObject({
      locale: 'sr',
      script: 'latn',
      quietHours: { start: '22:00', end: '07:00' },
      enabledKinds: ['new', 'evening_before', 'changed', 'cancelled'],
    });
    const res = await fetch(`${base}/v1/devices/me`, {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({
        locale: 'en',
        script: 'cyrl',
        quietHours: null,
        enabledKinds: ['new'],
      }),
    });
    expect(deviceSchema.parse(await res.json())).toMatchObject({
      locale: 'en',
      script: 'cyrl',
      quietHours: null,
      enabledKinds: ['new'],
    });
    expect(await device()).toMatchObject({ locale: 'en', quietHours: null });
  });

  it('refuses an empty change', async () => {
    const res = await fetch(`${base}/v1/devices/me`, {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
