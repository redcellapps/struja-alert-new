import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  MAX_ADDRESSES,
  type SubscriptionDto,
  createSubscriptionRequestSchema,
  patchSubscriptionRequestSchema,
  registerDeviceRequestSchema,
} from '@struja/shared';
import { cities, gazetteer } from './fixtures.ts';
import {
  cityOutages,
  findDetail,
  historyOutages,
  isScenario,
  outagesForScenario,
  visibleSubscriptions,
  type Scenario,
} from './scenarios.ts';

// A tiny stand-in for the /v1 API (docs/api.md) with in-memory state, for developing and screenshotting
// the app without a database or the real server. It answers with the same shapes the shared zod
// schemas describe; test/mock-server.test.ts parses every answer with the app's own client.

export interface MockOptions {
  now?: () => Date;
  // Development scenario (see scenarios.ts); change it at run time with POST /__dev/scenario.
  scenario?: Scenario;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const error = (res: ServerResponse, status: number, code: string, message: string) =>
  json(res, status, { error: { code, message } });

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

export function createMockServer(opts: MockOptions = {}): Server {
  const now = opts.now ?? (() => new Date());
  let scenario: Scenario = opts.scenario ?? 'upcoming';
  const devices = new Map<string, { secret: string; token: string }>();
  const subs = new Map<string, SubscriptionDto[]>();
  let nextSub = 1;

  const authed = (req: IncomingMessage): string | null => {
    const m = /^Bearer ([^.]+)\.(.+)$/.exec(req.headers.authorization ?? '');
    const d = m && devices.get(m[1] as string);
    return m && d && d.secret === m[2] ? (m[1] as string) : null;
  };

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://mock');
      const path = url.pathname;
      const method = req.method ?? 'GET';
      if (process.env.MOCK_LOG)
        console.log(method, req.url, req.headers.authorization?.slice(0, 18));

      if (path === '/healthz') return json(res, 200, { status: 'ok' });
      if (path === '/__dev/scenario') {
        if (method === 'POST') {
          const body = (await readBody(req)) as { name?: unknown } | undefined;
          if (!isScenario(body?.name))
            return error(res, 400, 'invalid_request', 'Unknown scenario');
          scenario = body.name;
          // "possible" is the state of an address saved without a house number
          if (scenario === 'possible')
            for (const list of subs.values())
              for (const sub of list) {
                sub.houseNumber = null;
                sub.houseSuffix = null;
              }
        }
        return json(res, 200, { scenario });
      }
      // the offline scenario: the connection drops, as with no network
      if (scenario === 'offline' && path.startsWith('/v1/')) return void req.socket.destroy();
      if (path === '/v1/cities') return json(res, 200, cities);
      if (path === '/v1/cities/nis/gazetteer') {
        if (req.headers['if-none-match'] === gazetteer.etag) {
          res.writeHead(304);
          return void res.end();
        }
        res.writeHead(200, { 'content-type': 'application/json', etag: gazetteer.etag });
        return void res.end(JSON.stringify(gazetteer));
      }
      if (path === '/v1/cities/nis/outages') {
        // city-wide: the outages of every device's addresses are part of the list
        const everyone = [...subs.values()].flatMap((list) => visibleSubscriptions(scenario, list));
        const mineNow = everyone.flatMap((x, i) => outagesForScenario(scenario, x, i, now()));
        return json(res, 200, { city: 'nis', outages: cityOutages(scenario, mineNow, now()) });
      }

      if (path === '/v1/devices' && method === 'POST') {
        const body = registerDeviceRequestSchema.safeParse(await readBody(req));
        if (!body.success) return error(res, 400, 'invalid_request', 'Invalid body');
        // The same rule as the server: a push token belongs to one device; registering again takes it over.
        for (const [id, d] of devices) {
          if (d.token === body.data.pushToken) {
            devices.delete(id);
            subs.delete(id);
          }
        }
        const id = crypto.randomUUID();
        const secret = crypto.randomUUID().replaceAll('-', '') + 'x'.repeat(8);
        devices.set(id, { secret, token: body.data.pushToken });
        subs.set(id, []);
        return json(res, 201, { deviceId: id, deviceSecret: secret });
      }

      const deviceId = authed(req);
      const optionalAuth = path.startsWith('/v1/outages/');
      if (!deviceId && !optionalAuth) return error(res, 401, 'unauthorized', 'Unauthorized');
      const mine = deviceId ? (subs.get(deviceId) ?? []) : [];

      if (path === '/v1/subscriptions' && method === 'GET') {
        return json(res, 200, {
          subscriptions: visibleSubscriptions(scenario, mine),
          max: MAX_ADDRESSES,
        });
      }
      if (path === '/v1/subscriptions' && method === 'POST') {
        const body = createSubscriptionRequestSchema.safeParse(await readBody(req));
        if (!body.success) return error(res, 400, 'invalid_request', 'Invalid body');
        if (mine.length >= MAX_ADDRESSES)
          return error(res, 409, 'limit_reached', 'Too many addresses');
        const street = gazetteer.streets.find((s) => s.id === body.data.streetId);
        const place = gazetteer.settlements.find((s) => s.id === body.data.settlementId);
        const found = street ?? place;
        if (!found) return error(res, 404, 'street_not_found', 'No such street');
        const sub: SubscriptionDto = {
          id: nextSub++,
          streetId: street?.id ?? null,
          settlementId: place?.id ?? null,
          name: {
            latin: (street?.nameLatin ?? found.nameCyrillic) as string,
            cyrillic: found.nameCyrillic,
          },
          houseNumber: body.data.houseNumber ?? null,
          houseSuffix: body.data.houseSuffix ?? null,
          label: body.data.label ?? null,
          isPrimary: mine.length === 0 || body.data.isPrimary === true,
        };
        if (sub.isPrimary) for (const s of mine) s.isPrimary = false;
        mine.push(sub);
        // Already published outages come back in the answer; the real server records them as told in
        // the app and pushes nothing.
        return json(res, 201, {
          subscription: sub,
          outages: outagesForScenario(scenario, sub, mine.length - 1, now()),
        });
      }
      const subId = /^\/v1\/subscriptions\/(\d+)$/.exec(path)?.[1];
      if (subId && method === 'PATCH') {
        const target = mine.find((s) => s.id === Number(subId));
        if (!target) return error(res, 404, 'not_found', 'No such address');
        const body = patchSubscriptionRequestSchema.safeParse(await readBody(req));
        if (!body.success) return error(res, 400, 'invalid_request', 'Invalid body');
        Object.assign(target, body.data);
        if (body.data.isPrimary) for (const s of mine) s.isPrimary = s === target;
        const index = visibleSubscriptions(scenario, mine).findIndex((s) => s.id === target.id);
        return json(res, 200, {
          subscription: target,
          outages: outagesForScenario(scenario, target, index, now()),
        });
      }
      if (subId && method === 'DELETE') {
        const i = mine.findIndex((s) => s.id === Number(subId));
        if (i < 0) return error(res, 404, 'not_found', 'No such address');
        const [removed] = mine.splice(i, 1);
        if (removed?.isPrimary && mine[0]) mine[0].isPrimary = true;
        res.writeHead(204);
        return void res.end();
      }

      if (path === '/v1/me/outages') {
        const history = url.searchParams.get('range') === 'history';
        return json(res, 200, {
          outages: history
            ? historyOutages(scenario, visibleSubscriptions(scenario, mine), now())
            : visibleSubscriptions(scenario, mine).flatMap((s, i) =>
                outagesForScenario(scenario, s, i, now()),
              ),
        });
      }
      const outageId = /^\/v1\/outages\/(\d+)$/.exec(path)?.[1];
      if (outageId) {
        const detail = findDetail(
          scenario,
          visibleSubscriptions(scenario, mine),
          now(),
          Number(outageId),
        );
        if (!detail) return error(res, 404, 'not_found', 'No such outage');
        return json(res, 200, detail);
      }
      if (path === '/v1/devices/me' && method === 'DELETE') {
        if (deviceId) {
          devices.delete(deviceId);
          subs.delete(deviceId);
        }
        res.writeHead(204);
        return void res.end();
      }
      if (path === '/v1/reports' && method === 'POST') return json(res, 201, { id: 1 });
      return error(res, 404, 'not_found', 'No such route');
    } catch (e) {
      return error(res, 500, 'internal', e instanceof Error ? e.message : 'error');
    }
  });
}
