import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEV_PUSH_TOKEN_PREFIX } from '@struja/shared';
import { createMockServer } from './server.ts';
import { createClient } from '../src/api/client.ts';
import {
  ensureRegistered,
  getCredentials,
  recoverDevice,
  type DeviceDeps,
  type LocalAddress,
  type SecretStore,
} from '../src/api/device.ts';
import { endpoints } from '../src/api/endpoints.ts';

// The contract test: the app's own client (which parses every answer with the shared zod schemas)
// talks to the mock API. A drift between fixtures and schemas fails here.
const NOW = new Date('2026-11-02T10:00:00Z');
let server: ReturnType<typeof createMockServer>;
let baseUrl: string;

beforeAll(async () => {
  server = createMockServer({ now: () => NOW });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

function memorySecrets(): SecretStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    remove: async (k) => void data.delete(k),
  };
}

function app(secrets: SecretStore, addresses: () => LocalAddress[] = () => []) {
  const publicApi = endpoints(
    createClient({ baseUrl, fetch, getCredentials: () => getCredentials(secrets) }),
  );
  let n = 0;
  const deps: DeviceDeps = {
    secrets,
    api: publicApi,
    platform: 'android',
    locale: () => ({ language: 'sr', script: 'latn' }),
    randomId: () => `id-${++n}-${Math.random().toString(16).slice(2)}`,
    addresses,
  };
  const client = createClient({
    baseUrl,
    fetch,
    getCredentials: async () => (await getCredentials(secrets)) ?? ensureRegistered(deps),
    onUnauthorized: () => recoverDevice(deps),
  });
  return { api: endpoints(client), deps, secrets };
}

describe('mock API contract', () => {
  it('serves cities and the gazetteer (with an ETag)', async () => {
    const { api } = app(memorySecrets());
    const cities = await api.cities();
    expect(cities.cities.find((c) => c.id === 'nis')?.active).toBe(true);
    const g = await api.gazetteer('nis');
    expect(g?.streets.length).toBeGreaterThan(3);
    expect(await api.gazetteer('nis', g?.etag)).toBeNull();
  });

  it('registers on first use with a development token, then adds an address and sees its outages', async () => {
    const secrets = memorySecrets();
    const { api } = app(secrets);
    const added = await api.addSubscription({ city: 'nis', streetId: 1, houseNumber: 34 });
    expect(added.subscription).toMatchObject({ isPrimary: true, houseNumber: 34 });
    expect(added.outages[0]).toMatchObject({ match: 'affected', status: 'active' });
    expect((await api.subscriptions()).max).toBe(3);
    expect((await api.myOutages()).outages).toHaveLength(1);
    const detail = await api.outage(added.outages[0]?.id as number);
    expect(detail.rawStreets).toContain('Војводе');
    expect(secrets.data.get('push-token')?.startsWith(DEV_PUSH_TOKEN_PREFIX)).toBe(true);
  });

  it('city outages, history, reports and delete-my-data answer in the shared shapes', async () => {
    const { api } = app(memorySecrets());
    await api.addSubscription({ city: 'nis', streetId: 2 });
    // the city list holds the person's own outage and others; the history is the past of their address
    expect((await api.cityOutages('nis')).outages.length).toBeGreaterThan(1);
    expect((await api.myOutages('history')).outages.length).toBeGreaterThan(0);
    expect(await api.report({ message: 'Pogrešna ulica' })).toEqual({ id: 1 });
    await api.deleteMyData();
  });

  it('enforces the limit of three addresses', async () => {
    const { api } = app(memorySecrets());
    for (const id of [1, 2, 3]) await api.addSubscription({ city: 'nis', streetId: id });
    await expect(api.addSubscription({ city: 'nis', streetId: 4 })).rejects.toMatchObject({
      status: 409,
      code: 'limit_reached',
    });
  });

  it('after the secret is lost, registers again with the same token and re-adds the local addresses', async () => {
    const local: LocalAddress[] = [
      { localId: 'home', request: { city: 'nis', streetId: 1, houseNumber: 34, isPrimary: true } },
      { localId: 'work', request: { city: 'nis', streetId: 2 } },
    ];
    const secrets = memorySecrets();
    const { api } = app(secrets, () => local);
    for (const l of local) await api.addSubscription(l.request);
    const tokenBefore = secrets.data.get('push-token');
    const credsBefore = secrets.data.get('device-credentials');

    // The server forgets this device's secret (a restore, or the secret was invalidated): the next
    // authenticated call gets a 401, recovers once, and the answer is the same list again.
    secrets.data.set('device-credentials', 'unknown.device');
    const subs = await api.subscriptions();
    expect(subs.subscriptions.map((s) => s.streetId)).toEqual([1, 2]);
    expect(subs.subscriptions[0]?.isPrimary).toBe(true);
    expect(secrets.data.get('push-token')).toBe(tokenBefore);
    expect(secrets.data.get('device-credentials')).not.toBe(credsBefore);
  });

  it('registering with a token that is already on file takes the device over', async () => {
    const secrets = memorySecrets();
    const { api, deps } = app(secrets);
    await api.addSubscription({ city: 'nis', streetId: 1 });
    // a second install with the same token: the first one's addresses are gone, the secret is new
    const second = memorySecrets();
    second.data.set('push-token', secrets.data.get('push-token') as string);
    const other = app(second);
    await ensureRegistered(other.deps);
    expect((await other.api.subscriptions()).subscriptions).toEqual([]);
    void deps;
  });

  it('returns the shared JSON error: 404 for an unknown route, 401 for a device route without credentials', async () => {
    const res = await fetch(`${baseUrl}/v1/nothing`);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('not_found');
    const noAuth = await fetch(`${baseUrl}/v1/subscriptions`);
    expect(noAuth.status).toBe(401);
    expect((await noAuth.json()).error.code).toBe('unauthorized');
  });
});
