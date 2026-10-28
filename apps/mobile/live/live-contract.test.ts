import { afterAll, describe, expect, it } from 'vitest';
import { createClient } from '../src/api/client.ts';
import {
  ensureRegistered,
  getCredentials,
  type DeviceDeps,
  type SecretStore,
} from '../src/api/device.ts';
import { endpoints } from '../src/api/endpoints.ts';

// The live contract test: the app's own client (which parses every answer with the shared zod schemas)
// talks to a REAL local server (docker/compose.yaml + `pnpm --filter @struja/server dev`, with some outages
// ingested: see docs/api.md and `dev:fixtures` / `dev:scrape`). Run it with `pnpm --filter @struja/mobile live-contract`.
// It only runs when LIVE_API_URL is set; each test uses its own device and deletes it at the end.
const BASE = process.env.LIVE_API_URL;

function memorySecrets(): SecretStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    remove: async (k) => void data.delete(k),
  };
}

function app() {
  const secrets = memorySecrets();
  const baseUrl = BASE as string;
  const publicApi = endpoints(
    createClient({ baseUrl, fetch, getCredentials: () => getCredentials(secrets) }),
  );
  const deps: DeviceDeps = {
    secrets,
    api: publicApi,
    platform: 'android',
    locale: () => ({ language: 'sr', script: 'latn' }),
    randomId: () => `live-${Math.random().toString(16).slice(2)}-${Date.now()}`,
    addresses: () => [],
  };
  const client = createClient({
    baseUrl,
    fetch,
    getCredentials: async () => (await getCredentials(secrets)) ?? ensureRegistered(deps),
  });
  return { api: endpoints(client), publicApi, secrets };
}

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Belgrade' });

describe.skipIf(!BASE)('live API contract', () => {
  const cleanups: Array<() => Promise<unknown>> = [];
  afterAll(async () => {
    for (const c of cleanups) await c().catch(() => undefined);
  });

  it('serves cities and the gazetteer (ETag and 304)', async () => {
    const { publicApi } = app();
    const cities = await publicApi.cities();
    const nis = cities.cities.find((c) => c.id === 'nis');
    expect(nis?.active).toBe(true);
    const g = await publicApi.gazetteer('nis');
    expect(g?.streets.length).toBeGreaterThan(100);
    expect(await publicApi.gazetteer('nis', g?.etag)).toBeNull();
    // streets that share a name in different places are different streets, told apart by settlement
    const vp = g?.streets.filter((s) => s.nameNorm === 'vojvode putnika') ?? [];
    expect(vp.length).toBeGreaterThanOrEqual(2);
    expect(new Set(vp.map((s) => s.settlement)).size).toBe(vp.length);
    expect(vp.map((s) => s.settlement)).toContain('Трупале');
  });

  it('city browse answers with and without a date', async () => {
    const { publicApi } = app();
    const all = await publicApi.cityOutages('nis');
    const day = await publicApi.cityOutages('nis', today());
    expect(Array.isArray(all.outages)).toBe(true);
    expect(Array.isArray(day.outages)).toBe(true);
  });

  it('register on first use, add a street with a number, read the outages and the detail', async () => {
    const { api, publicApi } = app();
    const g = await publicApi.gazetteer('nis');
    const street = g?.streets.find((s) => s.nameNorm.includes('trebinjsk'));
    expect(street, 'Trebinjska is in the Niš gazetteer').toBeDefined();
    const added = await api.addSubscription({
      city: 'nis',
      streetId: street?.id,
      houseNumber: 34,
      label: 'Kuća',
    });
    cleanups.push(() => api.deleteMyData());
    expect(added.subscription).toMatchObject({ isPrimary: true, houseNumber: 34 });
    expect((await api.subscriptions()).max).toBe(3);

    const mine = await api.myOutages();
    expect(mine.outages.length).toBe(added.outages.length);
    for (const o of added.outages) expect(['affected', 'possible']).toContain(o.match);
    await api.myOutages('history');

    const first = added.outages[0];
    if (first) {
      const detail = await api.outage(first.id);
      expect(detail.rawStreets.length).toBeGreaterThan(0);
      expect(detail.geometry.features.length).toBeGreaterThan(0);
      // Trebinjska 34 is a house OSM knows: the map can mark it
      expect(detail.mine[0]?.point).toEqual({ lng: expect.any(Number), lat: expect.any(Number) });
    }
  });

  it('a settlement can be followed too', async () => {
    const { api, publicApi } = app();
    const g = await publicApi.gazetteer('nis');
    const settlement = g?.settlements[0];
    expect(settlement).toBeDefined();
    const added = await api.addSubscription({ city: 'nis', settlementId: settlement?.id });
    cleanups.push(() => api.deleteMyData());
    expect(added.subscription.isPrimary).toBe(true);
  });

  it('changes an address and the device settings, files a report, limits to three, deletes everything', async () => {
    const { api, publicApi } = app();
    const g = await publicApi.gazetteer('nis');
    const ids = (g?.streets ?? []).slice(0, 4).map((s) => s.id);
    const first = await api.addSubscription({ city: 'nis', streetId: ids[0] });
    cleanups.push(() => api.deleteMyData());

    const patched = await api.patchSubscription(first.subscription.id, {
      houseNumber: 40,
      label: 'Posao',
    });
    expect(patched.subscription).toMatchObject({ houseNumber: 40, label: 'Posao' });

    const device = await api.patchDevice({
      quietHours: { start: '22:00', end: '07:00' },
      enabledKinds: ['new'],
    });
    expect(device.quietHours).toEqual({ start: '22:00', end: '07:00' });
    expect((await api.device()).enabledKinds).toEqual(['new']);
    expect((await api.patchDevice({ quietHours: null })).quietHours).toBeNull();

    expect(typeof (await api.report({ message: 'Pogrešna ulica (live test)' })).id).toBe('number');

    await api.addSubscription({ city: 'nis', streetId: ids[1] });
    await api.addSubscription({ city: 'nis', streetId: ids[2] });
    await expect(api.addSubscription({ city: 'nis', streetId: ids[3] })).rejects.toMatchObject({
      status: 409,
      code: 'limit_reached',
    });

    await api.deleteMyData();
    // the device is gone: its credentials no longer open anything
    await expect(api.device()).rejects.toMatchObject({ status: 401 });
  });

  it('answers unknown routes and bad credentials with the shared error shape', async () => {
    const res = await fetch(`${BASE}/v1/nothing`);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('not_found');
    const bad = await fetch(`${BASE}/v1/subscriptions`, {
      headers: { authorization: 'Bearer nope.nope' },
    });
    expect(bad.status).toBe(401);
  });
});
