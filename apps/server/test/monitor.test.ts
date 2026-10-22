import { sql } from 'drizzle-orm';
import type { Transporter } from 'nodemailer';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runChecks, SCRAPE_STALE_HOURS, SPOT_MIN_REVIEWS } from '../src/monitor/checks.ts';
import {
  deliverAlerts,
  EmailAlertSink,
  FakeAlertSink,
  MultiAlertSink,
  PushAlertSink,
} from '../src/monitor/sinks.ts';
import { FakePushProvider } from '../src/notify/provider.ts';
import { createWorld, edsPage, type World } from './helpers/world.ts';

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w?.stop();
});
beforeEach(async () => {
  await w.t.db.execute(
    sql`TRUNCATE scrape_run, outage, alert, segment_review, notification_log RESTART IDENTITY CASCADE`,
  );
});

const CHECK = { cities: ['Nis'], adminUrl: 'https://struja.example' };
const run = (at = w.now) => runChecks(w.t.db, at, CHECK);
const open = async (kind: string) =>
  Number(
    (
      await w.t.db.execute(
        sql`SELECT count(*)::int AS n FROM alert WHERE kind = ${kind} AND resolved_at IS NULL`,
      )
    ).rows[0]?.n,
  );
const messages = async (kind: string) =>
  (
    await w.t.db.execute(
      sql`SELECT message FROM alert WHERE kind = ${kind} AND resolved_at IS NULL ORDER BY id`,
    )
  ).rows.map((r) => String(r.message));

describe('zero rows on every page, two fetches in a row', () => {
  const empty = (d: string) => edsPage(d, []);
  it('raises one alert, and closes it when rows come back', async () => {
    const urls = ['https://example.test/Nis_Dan_0', 'https://example.test/Nis_Dan_1'];
    await w.ingestRaw(urls[0] as string, empty('25.11.2026.'));
    await w.ingestRaw(urls[1] as string, empty('26.11.2026.'));
    await run();
    expect(await open('zero_rows')).toBe(0); // one fetch each is not "two in a row"

    await w.ingestRaw(urls[0] as string, empty('25.11.2026.'));
    await w.ingestRaw(urls[1] as string, empty('26.11.2026.'));
    await run();
    await run(); // still true: still one alert
    expect(await open('zero_rows')).toBe(1);

    await w.ingestRaw(
      urls[0] as string,
      edsPage('25.11.2026.', [['Пантелеј', '08:00 - 09:00', 'Студеничке']]),
    );
    await run();
    expect(await open('zero_rows')).toBe(0);
  });
});

describe('resolution rate and unresolved segments', () => {
  const names = Array.from({ length: 25 }, (_, i) => `Зџќ${String.fromCharCode(0x430 + i)}х`);
  async function seed() {
    await w.page('25.11.2026.', [['Медијана', '08:00 - 12:00', names.join(', ')]]);
    await w.t.db.execute(
      sql`UPDATE outage_street SET resolved_by = 'exact', street_id = ${w.sid('kosmajska')}, candidates = NULL`,
    );
  }
  const unresolve = (n: number) =>
    w.t.db.execute(sql`UPDATE outage_street SET resolved_by = 'unresolved', street_id = NULL
      WHERE id IN (SELECT id FROM outage_street ORDER BY id LIMIT ${n})`);

  it('alerts below 95% of upcoming segments, and stops once it recovers', async () => {
    await seed();
    await unresolve(2); // 23 of 25 = 92%
    await run();
    expect(await open('resolution_low')).toBe(1);
    expect((await messages('resolution_low'))[0]).toContain('92.0%');
    await w.t.db
      .execute(sql`UPDATE outage_street SET resolved_by = 'exact', street_id = ${w.sid('kosmajska')}
      WHERE id = (SELECT min(id) FROM outage_street)`);
    await run(); // 24 of 25 = 96%
    expect(await open('resolution_low')).toBe(0);
  });

  it('a small sample never alerts', async () => {
    await w.page('26.11.2026.', [['Медијана', '08:00 - 12:00', 'Зџќах, Зџќбх']]);
    await w.t.db.execute(
      sql`UPDATE outage_street SET resolved_by = 'unresolved', street_id = NULL`,
    );
    await run();
    expect(await open('resolution_low')).toBe(0);
  });

  it('raises one alert per unresolved segment name with the admin link, closes it when resolved', async () => {
    await seed();
    await unresolve(2);
    await run();
    expect(await open('unresolved_segment')).toBe(2);
    expect((await messages('unresolved_segment'))[0]).toContain('https://struja.example/admin');
    await run();
    expect(await open('unresolved_segment')).toBe(2); // not one per tick
    await w.t.db
      .execute(sql`UPDATE outage_street SET resolved_by = 'manual', street_id = ${w.sid('kosmajska')}
      WHERE id = (SELECT min(id) FROM outage_street)`);
    await run();
    expect(await open('unresolved_segment')).toBe(1);
  });
});

describe('spot-check rejects', () => {
  const review = (n: number, rejected: number) =>
    w.t.db.execute(sql`
      INSERT INTO segment_review (seg_norm, kind, decision)
      SELECT 'x', 'spot_check', CASE WHEN g <= ${rejected} THEN 'rejected' ELSE 'confirmed' END
      FROM generate_series(1, ${n}) g`);
  it('alerts when more than 1% of the reviewed auto-accepts were wrong, with enough reviews', async () => {
    await review(SPOT_MIN_REVIEWS - 1, 5);
    await run();
    expect(await open('spot_check_rejects')).toBe(0); // too few reviews to judge
    await review(1, 0);
    await run();
    expect(await open('spot_check_rejects')).toBe(1);
    await w.t.db.execute(sql`DELETE FROM segment_review WHERE decision = 'rejected'`);
    await run();
    expect(await open('spot_check_rejects')).toBe(0);
  });
});

describe('push failures', () => {
  it('alerts when more than 10% of the last 24 hours of sends failed', async () => {
    const subs = [];
    for (let i = 0; i < 25; i++) subs.push(await w.addSub({ norm: 'kosmajska' }));
    await w.page('25.11.2026.', [['Палилула - Ниш', '08:00 - 10:00', 'Космајске']]);
    await w.plan();
    await w.t.db.execute(sql`UPDATE notification_log SET status = 'sent'`);
    const today = new Date(); // log rows are stamped with the real clock
    await run(today);
    expect(await open('push_failures')).toBe(0);
    await w.t.db.execute(sql`UPDATE notification_log SET status = 'failed'
      WHERE id IN (SELECT id FROM notification_log ORDER BY id LIMIT 5)`);
    await run(today); // 5 of 25 = 20%
    expect(await open('push_failures')).toBe(1);
  });
});

describe('the scheduler has stopped', () => {
  it('alerts when no fetch succeeded for more than 14 hours, not before, not on a fresh install', async () => {
    await run(new Date(w.now.getTime() + 100 * 3_600_000));
    expect(await open('scrape_stale')).toBe(0); // never fetched: nothing to compare with
    await w.page('25.11.2026.', []);
    await run(new Date());
    await w.t.db.execute(
      sql`UPDATE scrape_run SET started_at = ${w.now.toISOString()}::timestamptz`,
    );
    await run(new Date(w.now.getTime() + (SCRAPE_STALE_HOURS - 1) * 3_600_000));
    expect(await open('scrape_stale')).toBe(0);
    await run(new Date(w.now.getTime() + (SCRAPE_STALE_HOURS + 1) * 3_600_000));
    expect(await open('scrape_stale')).toBe(1);
    await run(new Date(w.now.getTime() + 2 * 3_600_000));
    expect(await open('scrape_stale')).toBe(0);
  });
});

describe('delivering alerts', () => {
  const raise = (kind: string, key: string) =>
    w.t.db.execute(
      sql`INSERT INTO alert (kind, dedupe_key, message) VALUES (${kind}, ${key}, ${'msg ' + key})`,
    );

  it('sends open, unannounced alerts once, as one batch', async () => {
    await raise('broken_page', 'a');
    await raise('flip_flop', 'b');
    await w.t.db.execute(sql`UPDATE alert SET resolved_at = now() WHERE dedupe_key = 'b'`);
    const sink = new FakeAlertSink();
    expect(await deliverAlerts(w.t.db, sink)).toBe(1); // 'b' was already resolved
    expect(sink.batches[0]?.map((a) => a.message)).toEqual(['msg a']);
    expect(await deliverAlerts(w.t.db, sink)).toBe(0);
  });

  it('keeps alerts pending when the sink fails and retries them', async () => {
    await raise('broken_page', 'a');
    const sink = new FakeAlertSink();
    sink.failNext = true;
    await expect(deliverAlerts(w.t.db, sink)).rejects.toThrow('sink down');
    expect(await deliverAlerts(w.t.db, sink)).toBe(1);
  });

  it('sends an email with a subject and the messages', async () => {
    const sent: { subject: string; text: string; to: string[] }[] = [];
    const transport = {
      sendMail: async (m: (typeof sent)[number]) => void sent.push(m),
    } as unknown as Transporter;
    await raise('broken_page', 'a');
    await raise('flip_flop', 'b');
    await deliverAlerts(
      w.t.db,
      new EmailAlertSink(transport, 'alerts@struja.example', ['ops@example.rs']),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe('[Struja Alert] 2 alerts');
    expect(sent[0]?.text).toContain('msg a');
    expect(sent[0]?.text).toContain('flip_flop');
    expect(sent[0]?.to).toEqual(['ops@example.rs']);
  });

  it('pushes to the admin device(s), and fails when every ticket fails', async () => {
    const provider = new FakePushProvider();
    const sink = new PushAlertSink(provider, ['ExponentPushToken[admin1]']);
    await raise('broken_page', 'a');
    await deliverAlerts(w.t.db, sink);
    expect(provider.sent[0]).toMatchObject({
      to: 'ExponentPushToken[admin1]',
      title: 'Struja Alert: broken_page',
      body: 'msg a',
    });
    provider.failTokens.set('ExponentPushToken[admin1]', 'MessageRateExceeded');
    await raise('flip_flop', 'b');
    await expect(deliverAlerts(w.t.db, sink)).rejects.toThrow('MessageRateExceeded');
  });

  it('one working channel is enough; all failing is a failure', async () => {
    const good = new FakeAlertSink();
    const bad1 = new FakeAlertSink();
    bad1.failNext = true;
    await new MultiAlertSink([bad1, good]).send([
      { id: 1, kind: 'k', message: 'm', createdAt: new Date().toISOString() },
    ]);
    expect(good.batches).toHaveLength(1);
    const bad2 = new FakeAlertSink();
    const bad3 = new FakeAlertSink();
    bad2.failNext = bad3.failNext = true;
    await expect(
      new MultiAlertSink([bad2, bad3]).send([
        { id: 1, kind: 'k', message: 'm', createdAt: new Date().toISOString() },
      ]),
    ).rejects.toThrow('sink down');
  });
});

describe('/healthz', () => {
  it('answers ok with a database', async () => {
    const { buildApp } = await import('../src/app.ts');
    const { GazetteerService } = await import('../src/gazetteer/service.ts');
    const app = buildApp(
      { db: w.t.db, gazetteers: new GazetteerService(w.t.db) },
      { logger: false },
    );
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});
