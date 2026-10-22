import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ipAllowed } from '../src/admin/auth.ts';
import { buildApp } from '../src/app.ts';
import { runChecks } from '../src/monitor/checks.ts';
import { GazetteerService } from '../src/gazetteer/service.ts';
import { ingestPage } from '../src/ingest/ingest.ts';
import { createWorld, edsPage, type World } from './helpers/world.ts';

let w: World;
let app: ReturnType<typeof buildApp>;
let gazetteers: GazetteerService;
const TOKEN = 'a-long-enough-admin-token';
const auth = { authorization: `Bearer ${TOKEN}` };

beforeAll(async () => {
  w = await createWorld();
  gazetteers = new GazetteerService(w.t.db);
  app = buildApp(
    {
      db: w.t.db,
      gazetteers,
      now: () => w.now,
      admin: { token: TOKEN, ipAllowlist: ['127.0.0.1', '10.1.0.0/16'] },
    },
    { logger: false },
  );
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  await w?.stop();
});

const get = (url: string, headers: Record<string, string> = auth, remoteAddress?: string) =>
  app.inject({ method: 'GET', url, headers, remoteAddress });
const post = (url: string, payload: unknown, headers: Record<string, string> = auth) =>
  app.inject({ method: 'POST', url, headers, payload: payload as object });
const count = async (q: ReturnType<typeof sql>) => Number((await w.t.db.execute(q)).rows[0]?.n);

describe('access', () => {
  it('is not served at all without an ADMIN_TOKEN', async () => {
    const bare = buildApp({ db: w.t.db, gazetteers }, { logger: false });
    const res = await bare.inject({ method: 'GET', url: '/admin/health', headers: auth });
    expect(res.statusCode).toBe(404);
    await bare.close();
  });

  it('needs the token (Bearer, or Basic with the token as password)', async () => {
    const none = await get('/admin/health', {});
    expect(none.statusCode).toBe(401);
    expect(none.headers['www-authenticate']).toContain('Basic');
    expect(
      (await get('/admin/health', { authorization: 'Bearer wrong-token-value-xx' })).statusCode,
    ).toBe(401);
    expect((await get('/admin/health')).statusCode).toBe(200);
    const basic = Buffer.from(`admin:${TOKEN}`).toString('base64');
    expect((await get('/admin/health', { authorization: `Basic ${basic}` })).statusCode).toBe(200);
  });

  it('only from allowed addresses (exact or CIDR)', async () => {
    expect((await get('/admin/health', auth, '203.0.113.9')).statusCode).toBe(403);
    expect((await get('/admin/health', auth, '10.1.7.7')).statusCode).toBe(200);
    expect(ipAllowed('::ffff:127.0.0.1', ['127.0.0.1'])).toBe(true);
    expect(ipAllowed('10.2.0.1', ['10.1.0.0/16'])).toBe(false);
  });

  it('refuses cross-site posts even with valid credentials', async () => {
    const res = await post(
      '/admin/unresolved/dismiss',
      { segNorm: 'x' },
      {
        ...auth,
        origin: 'https://evil.example',
        host: 'admin.struja.example',
      },
    );
    expect(res.statusCode).toBe(403);
    const site = await post(
      '/admin/unresolved/dismiss',
      { segNorm: 'x' },
      {
        ...auth,
        'sec-fetch-site': 'cross-site',
      },
    );
    expect(site.statusCode).toBe(403);
  });

  it('has security headers on the admin page only, and no CORS anywhere', async () => {
    const page = await get('/admin');
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-security-policy']).toContain("default-src 'none'");
    expect(page.headers['x-content-type-options']).toBe('nosniff');
    expect(page.headers['cache-control']).toBe('no-store');
    const health = await app.inject({ method: 'GET', url: '/healthz' });
    expect(health.headers['content-security-policy']).toBeUndefined();
    const cities = await app.inject({ method: 'GET', url: '/v1/cities' });
    expect(cities.headers['content-security-policy']).toBeUndefined();
    for (const r of [page, health, cities]) {
      expect(r.headers['access-control-allow-origin']).toBeUndefined();
    }
  });
});

describe('the unresolved queue', () => {
  const date = '20.11.2026.';
  const garbled = 'Космајскаа';
  it('lists a segment no step could place, with candidates; confirming pins an alias and re-resolves', async () => {
    const a = await w.addSub({ norm: 'kosmajska' });
    await w.page(date, [['Палилула - Ниш', '08:00 - 10:00', garbled]]);
    const seg = (
      await w.t.db.execute(sql`SELECT id, resolved_by FROM outage_street ORDER BY id DESC LIMIT 1`)
    ).rows[0];
    // whichever rung took it, force the interesting case: nothing placed it
    await w.t.db
      .execute(sql`UPDATE outage_street SET resolved_by = 'unresolved', street_id = NULL, score = NULL,
      candidates = ${JSON.stringify([{ id: w.sid('kosmajska'), name: 'Космајска', score: 0.7 }])}::jsonb
      WHERE id = ${seg?.id as number}`);

    const queue = (await get('/admin/unresolved')).json() as {
      items: { segNorm: string; candidates: { id: number }[] }[];
    };
    const item = queue.items.find((i) => i.segNorm === 'kosmajskaa');
    expect(item?.candidates[0]?.id).toBe(w.sid('kosmajska'));

    // a form post from the page confirms and redirects back to it
    const res = await app.inject({
      method: 'POST',
      url: '/admin/unresolved/confirm',
      headers: {
        ...auth,
        accept: 'text/html',
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `segNorm=kosmajskaa&streetId=${w.sid('kosmajska')}&raw=${encodeURIComponent(garbled)}`,
    });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/admin');

    expect(
      await count(
        sql`SELECT count(*)::int AS n FROM street_alias WHERE raw_norm = 'kosmajskaa' AND source = 'manual' AND confidence = 1`,
      ),
    ).toBe(1);
    const row = (
      await w.t.db.execute(
        sql`SELECT resolved_by, street_id FROM outage_street WHERE id = ${seg?.id as number}`,
      )
    ).rows[0];
    expect(row).toMatchObject({ resolved_by: 'manual', street_id: w.sid('kosmajska') });
    const after = (await get('/admin/unresolved')).json() as { items: { segNorm: string }[] };
    expect(after.items.find((i) => i.segNorm === 'kosmajskaa')).toBeUndefined();

    // the planner now tells the person whose street it is; nothing was pushed before
    expect(w.titles(a.token, '2026-11-20')).toHaveLength(0);
    await w.plan();
    await w.deliver();
    expect(w.titles(a.token, '2026-11-20')).toHaveLength(1);

    // and the next page that spells it the same way resolves by alias
    const again = (await gazetteers.get('Nis')).aliases.get('kosmajskaa');
    expect(again).toBe(w.sid('kosmajska'));
  });

  it('a street that does not exist is a 404; "not a street" hides the segment for good', async () => {
    expect(
      (await post('/admin/unresolved/confirm', { segNorm: 'x', streetId: 99999999 })).statusCode,
    ).toBe(404);
    await w.page('21.11.2026.', [['Пантелеј', '08:00 - 09:00', 'нешто нејасно']]);
    await w.t.db
      .execute(sql`UPDATE outage_street SET resolved_by = 'unresolved', street_id = NULL, score = NULL
      WHERE raw_segment LIKE '%нејасно%'`);
    const q = (await get('/admin/unresolved')).json() as { items: { segNorm: string }[] };
    const norm = q.items.find((i) => i.segNorm.includes('nejasno'))?.segNorm as string;
    expect(norm).toBeTruthy();
    expect((await post('/admin/unresolved/dismiss', { segNorm: norm })).statusCode).toBe(200);
    const q2 = (await get('/admin/unresolved')).json() as { items: { segNorm: string }[] };
    expect(q2.items.find((i) => i.segNorm === norm)).toBeUndefined();
  });
});

describe('the spot check of auto-accepted matches', () => {
  async function scoredSegment(date: string, street: string) {
    await w.page(date, [['Медијана', '09:00 - 10:00', street]]);
    const seg = (
      await w.t.db
        .execute(sql`SELECT os.id FROM outage_street os JOIN outage o ON o.id = os.outage_id
        WHERE o.outage_date = ${date.slice(6, 10) + '-' + date.slice(3, 5) + '-' + date.slice(0, 2)} LIMIT 1`)
    ).rows[0];
    const id = seg?.id as number;
    await w.t.db.execute(
      sql`UPDATE outage_street SET resolved_by = 'scored', score = 0.9 WHERE id = ${id}`,
    );
    return id;
  }

  it('"correct" records the review; "wrong" sends the segment back to the queue', async () => {
    const ok = await scoredSegment('22.11.2026.', 'Требињске');
    const bad = await scoredSegment('23.11.2026.', 'Чегарске');
    const list = (await get('/admin/spot-checks')).json() as { items: { rowIds: number[] }[] };
    const okItem = list.items.find((i) => i.rowIds.includes(ok));
    const badItem = list.items.find((i) => i.rowIds.includes(bad));
    expect(okItem && badItem).toBeTruthy();

    expect(
      (
        await post('/admin/spot-checks/review', { rowIds: okItem?.rowIds, decision: 'confirmed' })
      ).json(),
    ).toEqual({ reviewed: 1 });
    expect(
      (
        await post('/admin/spot-checks/review', {
          rowIds: badItem?.rowIds.join(','),
          decision: 'rejected',
        })
      ).json(),
    ).toEqual({ reviewed: 1 });

    const rows = (
      await w.t.db.execute(
        sql`SELECT id, resolved_by, street_id FROM outage_street WHERE id IN (${ok}, ${bad})`,
      )
    ).rows;
    expect(rows.find((r) => r.id === ok)).toMatchObject({ resolved_by: 'scored' });
    expect(rows.find((r) => r.id === bad)).toMatchObject({
      resolved_by: 'unresolved',
      street_id: null,
    });

    // reviewed once, not offered again; the rate shows in the health summary
    const again = (await get('/admin/spot-checks')).json() as { items: { rowIds: number[] }[] };
    expect(again.items.some((i) => i.rowIds.includes(ok) || i.rowIds.includes(bad))).toBe(false);
    const health = (await get('/admin/health')).json() as {
      spotChecks30d: { total: number; rejected: number };
    };
    expect(health.spotChecks30d).toEqual({ total: 2, rejected: 1 });
  });
});

describe('reduced pages', () => {
  const date = '24.11.2026.';
  const six: [string, string, string][] = [1, 2, 3, 4, 5, 6].map((h) => [
    'Пантелеј',
    `0${h}:00 - 0${h}:30`,
    'Студеничке',
  ]);
  it('the page lists a reduced fetch; "confirm as real" runs the missing pass; a second try is a 409', async () => {
    await w.page(date, six);
    const r = await w.page(date, six.slice(0, 1));
    expect(r.health).toBe('reduced');
    const list = (await get('/admin/reduced')).json() as {
      runs: { runId: number; rows: number; previousRows: number }[];
    };
    const run = list.runs.find((x) => x.runId === r.runId);
    expect(run).toMatchObject({ rows: 1, previousRows: 6 });
    expect((await get('/admin')).body).toContain('Confirm as real');

    expect((await post(`/admin/runs/${r.runId}/confirm-reduced`, {})).json()).toEqual({
      result: 'confirmed',
    });
    expect(
      await count(
        sql`SELECT count(*)::int AS n FROM outage WHERE outage_date = '2026-11-24' AND missing_runs = 1`,
      ),
    ).toBe(5);
    const second = await post(`/admin/runs/${r.runId}/confirm-reduced`, {});
    expect(second.statusCode).toBe(409);
  });
});

describe('confirming a reduced page pairs changes like a normal fetch', () => {
  it('a changed time on the reduced page is an "Izmena", not "Otkazano" plus "new"', async () => {
    const date = '29.11.2026.';
    const streets = [
      'Космајске',
      'Требињске',
      'Чегарске',
      'Студеничке',
      'Бубањске долине',
      'Војводе Путника',
    ];
    const rows = (first: string): [string, string, string][] =>
      streets.map((st, i) => ['Медијана', i === 0 ? first : `1${i}:00 - 1${i}:30`, st]);
    const a = await w.addSub({ norm: 'kosmajska' });
    await w.page(date, rows('08:00 - 09:00'));
    await w.plan();
    await w.deliver();
    // the page loses five rows and the first one moves by an hour
    const r = await w.page(date, [['Медијана', '09:00 - 10:00', 'Космајске']]);
    expect(r.health).toBe('reduced');
    expect(await post(`/admin/runs/${r.runId}/confirm-reduced`, {})).toMatchObject({
      statusCode: 200,
    });
    await w.plan();
    await w.deliver();
    expect(await w.kinds(a.subId, '2026-11-29')).toEqual(['new:sent:0', 'changed:sent:0']);
    expect(
      await count(
        sql`SELECT count(*)::int AS n FROM outage WHERE outage_date = '2026-11-29' AND status = 'changed'`,
      ),
    ).toBe(1);
  });
});

describe('health and reports', () => {
  it('health shows the latest fetch per page, open alerts and the resolution rate', async () => {
    const h = (await get('/admin/health')).json() as {
      scrapes: unknown[];
      alerts: unknown[];
      resolutionRate: number | null;
      upcomingOutages: number;
    };
    expect(h.scrapes.length).toBeGreaterThan(0);
    expect(h.upcomingOutages).toBeGreaterThan(0);
    expect(typeof h.resolutionRate).toBe('number');
  });

  it('lists the reports from the app', async () => {
    await w.t.db.execute(sql`INSERT INTO report (message) VALUES ('Ulica je pogrešna <b>')`);
    const res = (await get('/admin/reports')).json() as { reports: { message: string }[] };
    expect(res.reports[0]?.message).toBe('Ulica je pogrešna <b>');
    // the page escapes it
    const page = (await get('/admin')).body;
    expect(page).toContain('Ulica je pogrešna &lt;b&gt;');
    expect(page).not.toContain('pogrešna <b>');
  });
});

describe('village segments', () => {
  it('reach the queue, raise an alert, and confirming pins a settlement alias that reaches subscribers', async () => {
    const vil = (
      await w.t.db.execute(sql`SELECT id, name_cyrillic FROM settlement ORDER BY id LIMIT 1`)
    ).rows[0];
    const settlementId = Number(vil?.id);
    const vilName = String(vil?.name_cyrillic);
    const sub = await w.addSub({ norm: 'kosmajska' });
    await w.t.db.execute(
      sql`UPDATE subscription SET street_id = NULL, settlement_id = ${settlementId} WHERE id = ${sub.subId}`,
    );
    await w.page('27.11.2026.', [['Нишка бања', '08:00 - 10:00', 'Део села Зџќах']]);
    const seg = (
      await w.t.db.execute(
        sql`SELECT resolved_by, settlement_id FROM outage_street WHERE raw_segment LIKE '%Зџќах%'`,
      )
    ).rows[0];
    expect(seg).toMatchObject({ resolved_by: 'unresolved', settlement_id: null });

    const queue = (await get('/admin/unresolved')).json() as {
      items: { segNorm: string; kind: string }[];
    };
    const item = queue.items.find((i) => i.kind === 'village');
    expect(item?.segNorm.startsWith('village:')).toBe(true);

    await runChecks(w.t.db, w.now, { cities: ['Nis'], adminUrl: 'https://struja.example' });
    const alerts = await count(
      sql`SELECT count(*)::int AS n FROM alert WHERE kind = 'unresolved_segment' AND dedupe_key = ${item?.segNorm}`,
    );
    expect(alerts).toBe(1);

    // no candidates: the page offers a name search, which lists settlements to pick from
    expect((await get('/admin')).body).toContain('/admin/search');
    const found = (
      await get(
        `/admin/search?segNorm=${encodeURIComponent(item?.segNorm ?? '')}&q=${encodeURIComponent(vilName)}`,
      )
    ).json() as { items: { id: number }[] };
    expect(found.items.map((i) => i.id)).toContain(settlementId);
    const htmlPage = await app.inject({
      method: 'GET',
      url: `/admin/search?segNorm=${encodeURIComponent(item?.segNorm ?? '')}&q=${encodeURIComponent(vilName)}`,
      headers: { ...auth, accept: 'text/html' },
    });
    expect(htmlPage.body).toContain('settlementId');
    const res = await post('/admin/unresolved/confirm', {
      segNorm: item?.segNorm,
      settlementId,
      raw: 'Зџќах',
    });
    expect(res.json()).toEqual({ resolved: 1 });
    expect(
      await count(
        sql`SELECT count(*)::int AS n FROM settlement_alias WHERE raw_norm = 'zdzkah' OR settlement_id = ${settlementId}`,
      ),
    ).toBeGreaterThan(0);

    // the people who live there are told, nobody was before
    expect(w.titles(sub.token, '2026-11-27')).toHaveLength(0);
    await w.plan();
    await w.deliver();
    expect(w.titles(sub.token, '2026-11-27')).toHaveLength(1);

    // the same spelling on a later page now resolves by alias
    // (a gazetteer loaded after the confirmation, as the service does)
    await ingestPage(w.t.db, await gazetteers.get('Nis'), {
      city: 'Nis',
      url: 'https://example.test/28',
      bytes: edsPage('28.11.2026.', [['Нишка бања', '08:00 - 10:00', 'Део села Зџќах']]),
      now: w.now,
    });
    const again = (
      await w.t.db.execute(
        sql`SELECT resolved_by, settlement_id FROM outage_street os JOIN outage o ON o.id = os.outage_id
            WHERE o.outage_date = '2026-11-28'`,
      )
    ).rows[0];
    expect(again).toMatchObject({ resolved_by: 'alias', settlement_id: settlementId });
  });
});
