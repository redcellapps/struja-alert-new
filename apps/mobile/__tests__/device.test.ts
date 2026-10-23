import {
  ensureRegistered,
  getCredentials,
  recoverDevice,
  singleFlightRecovery,
  type DeviceDeps,
  type LocalAddress,
  type SecretStore,
} from '../src/api/device';

const memorySecrets = (): SecretStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    remove: async (k) => void data.delete(k),
  };
};

function setup(addresses: LocalAddress[] = []) {
  const secrets = memorySecrets();
  const registered: { pushToken: string }[] = [];
  const added: unknown[] = [];
  let n = 0;
  const deps: DeviceDeps = {
    secrets,
    api: {
      registerDevice: jest.fn(async (body) => {
        registered.push({ pushToken: body.pushToken });
        n++;
        return { deviceId: `d${n}`, deviceSecret: `s${n}` };
      }),
      addSubscription: jest.fn(async (body) => {
        added.push(body);
        return {} as never;
      }),
    },
    platform: 'android',
    locale: () => ({ language: 'sr', script: 'latn' }),
    randomId: () => 'uuid-1',
    addresses: () => addresses,
  };
  return { deps, secrets, registered, added };
}

describe('device registration', () => {
  it('registers once with a development token and keeps the credentials', async () => {
    const { deps, secrets, registered } = setup();
    expect(await ensureRegistered(deps)).toBe('d1.s1');
    expect(await ensureRegistered(deps)).toBe('d1.s1');
    expect(registered).toEqual([{ pushToken: 'dev-token:uuid-1' }]);
    expect(await getCredentials(secrets)).toBe('d1.s1');
  });

  it('uses the real push token when there is one', async () => {
    const { deps, registered } = setup();
    await ensureRegistered({ ...deps, realPushToken: async () => 'ExponentPushToken[abc]' });
    expect(registered[0]?.pushToken).toBe('ExponentPushToken[abc]');
  });
});

describe('recovery from a lost secret', () => {
  const home: LocalAddress = { localId: 'a', request: { city: 'nis', streetId: 1 } };
  const work: LocalAddress = { localId: 'b', request: { city: 'nis', streetId: 2 } };

  it('registers again with the same push token and re-adds the addresses of the device', async () => {
    const { deps, secrets, registered, added } = setup([home, work]);
    await ensureRegistered(deps);
    await recoverDevice(deps);
    expect(registered.map((r) => r.pushToken)).toEqual(['dev-token:uuid-1', 'dev-token:uuid-1']);
    expect(await getCredentials(secrets)).toBe('d2.s2');
    expect(added).toEqual([home.request, work.request]);
  });

  it('runs once when several requests fail together, and the late ones just retry', async () => {
    const { deps, secrets, registered, added } = setup([home]);
    await ensureRegistered(deps);
    const recover = singleFlightRecovery(deps);
    // three requests, all sent with the old credentials, all got 401
    const results = await Promise.all([recover('d1.s1'), recover('d1.s1'), recover('d1.s1')]);
    expect(results).toEqual([true, true, true]);
    expect(registered).toHaveLength(2); // the first registration and one recovery
    expect(added).toEqual([home.request]);
    // a request that was sent before the recovery and fails after it: nothing to recover
    expect(await recover('d1.s1')).toBe(true);
    expect(registered).toHaveLength(2);
    // new credentials failing again start a new recovery
    expect(await recover(await getCredentials(secrets))).toBe(true);
    expect(registered).toHaveLength(3);
  });
});
