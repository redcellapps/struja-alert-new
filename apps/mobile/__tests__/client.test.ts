import { z } from 'zod';
import { ApiError, createClient, type ClientDeps } from '../src/api/client';

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
  over: Partial<ClientDeps> = {},
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const client = createClient({
    baseUrl: 'http://api',
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return handler(url, init);
    }) as unknown as typeof fetch,
    getCredentials: async () => 'dev.secret',
    ...over,
  });
  return { client, calls };
}

const schema = z.object({ n: z.number() });

describe('client', () => {
  it('parses a good answer with the schema', async () => {
    const { client } = setup(() => ok({ n: 3 }));
    expect(await client.request({ path: '/x', schema })).toEqual({ n: 3 });
  });

  it('turns a contract mismatch into a visible error', async () => {
    const { client } = setup(() => ok({ n: 'three' }));
    await expect(client.request({ path: '/x', schema })).rejects.toMatchObject({
      code: 'contract',
      status: 200,
    });
  });

  it('reads the server error shape', async () => {
    const { client } = setup(() =>
      ok({ error: { code: 'limit_reached', message: 'Too many' } }, 409),
    );
    const e = await client.request({ path: '/x', schema }).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 409, code: 'limit_reached', message: 'Too many' });
  });

  it('wraps network failures', async () => {
    const { client } = setup(() => {
      throw new TypeError('Network request failed');
    });
    await expect(client.request({ path: '/x', schema })).rejects.toMatchObject({
      code: 'network',
      status: 0,
    });
  });

  it('sends credentials only when asked, and JSON bodies with a content type', async () => {
    const { client, calls } = setup(() => ok({ n: 1 }));
    await client.request({ path: '/a', schema });
    await client.request({ method: 'POST', path: '/b', schema, body: { q: 1 }, auth: true });
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBeUndefined();
    const second = calls[1]?.init.headers as Record<string, string>;
    expect(second.authorization).toBe('Bearer dev.secret');
    expect(second['content-type']).toBe('application/json');
    expect(calls[1]?.init.body).toBe('{"q":1}');
  });

  it('refuses a required-auth request without credentials, but not an optional one', async () => {
    const { client } = setup(() => ok({ n: 1 }), { getCredentials: async () => null });
    await expect(client.request({ path: '/x', schema, auth: true })).rejects.toMatchObject({
      status: 401,
    });
    expect(await client.request({ path: '/x', schema, auth: 'optional' })).toEqual({ n: 1 });
  });

  it('recovers once from a 401 and retries', async () => {
    let creds = 'old.secret';
    let recovered = 0;
    const { client, calls } = setup(
      (_u, init) =>
        (init.headers as Record<string, string>).authorization === 'Bearer new.secret'
          ? ok({ n: 2 })
          : ok({ error: { code: 'unauthorized', message: 'no' } }, 401),
      {
        getCredentials: async () => creds,
        onUnauthorized: async () => {
          recovered++;
          creds = 'new.secret';
          return true;
        },
      },
    );
    expect(await client.request({ path: '/x', schema, auth: true })).toEqual({ n: 2 });
    expect(recovered).toBe(1);
    expect(calls).toHaveLength(2);
  });

  it('does not loop when recovery does not help', async () => {
    let recovered = 0;
    const { client, calls } = setup(
      () => ok({ error: { code: 'unauthorized', message: 'no' } }, 401),
      {
        onUnauthorized: async () => {
          recovered++;
          return true;
        },
      },
    );
    await expect(client.request({ path: '/x', schema, auth: true })).rejects.toMatchObject({
      status: 401,
    });
    expect(recovered).toBe(1);
    expect(calls).toHaveLength(2);
  });

  it('returns undefined for 204', async () => {
    const { client } = setup(() => new Response(null, { status: 204 }));
    expect(await client.request({ method: 'DELETE', path: '/x', auth: true })).toBeUndefined();
  });
});
