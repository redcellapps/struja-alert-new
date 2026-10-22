import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GazetteerService } from '../src/gazetteer/service.ts';
import { backupFileName, pruneBackups, type BackupRunner } from '../src/jobs/backup.ts';
import { boundaryTick, FakeBoundarySink, type BoundarySink } from '../src/jobs/boundary.ts';
import {
  backupJob,
  deliverJob,
  JOBS,
  planJob,
  scrapeJob,
  type JobContext,
  type JobName,
} from '../src/jobs/handlers.ts';
import { registerJobs, SCHEDULES, startBoss, TIMEZONE } from '../src/jobs/register.ts';
import {
  FixturePageSource,
  HttpPageSource,
  pageUrl,
  scraperUserAgent,
  type PageSource,
} from '../src/jobs/sources.ts';
import { createWorld, type World } from './helpers/world.ts';

const winPath = (u: URL) => u.pathname.replace(/^\/([A-Za-z]:)/, '$1');
const EDS_DIR = winPath(new URL('../../../fixtures/eds', import.meta.url));
// 07:30 local (outside quiet hours) and before every outage of the saved 22 Oct pages.
const MORNING = new Date('2026-10-22T05:30:00Z');

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w?.stop();
});

function makeCtx(over: Partial<JobContext> = {}): JobContext & { queued: JobName[] } {
  const queued: JobName[] = [];
  const noBackup: BackupRunner = { run: async () => ({ file: 'x', bytes: 0, pruned: [] }) };
  return {
    db: w.t.db,
    gazetteers: new GazetteerService(w.t.db),
    provider: w.provider,
    pages: new FixturePageSource(EDS_DIR),
    boundary: new FakeBoundarySink(),
    backup: noBackup,
    cities: ['Nis'],
    now: () => MORNING,
    enqueue: async (name) => {
      queued.push(name);
    },
    log: () => {},
    queued,
    ...over,
  };
}

describe('page sources', () => {
  it('the fixture source reads the newest saved snapshot, and nothing for a missing day', async () => {
    const src = new FixturePageSource(EDS_DIR);
    const page = await src.fetchPage('Nis', 0);
    expect(page?.status).toBe(200);
    expect(page?.url).toBe(pageUrl('Nis', 0));
    expect(page?.bytes.length).toBeGreaterThan(1000);
    expect(await src.fetchPage('Nis', 9)).toBeNull();
    expect(await src.fetchPage('Nowhere', 0)).toBeNull();
  });

  it('the HTTP source is polite: identified, paced, conditional, and honest about 404 and redirects', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const sleeps: number[] = [];
    const responses = new Map<string, Response>([
      [
        pageUrl('Nis', 0),
        new Response('<html>ok</html>', { status: 200, headers: { etag: '"v1"' } }),
      ],
      [pageUrl('Nis', 1), new Response(null, { status: 304 })],
      [pageUrl('Nis', 2), new Response('nope', { status: 404 })],
    ]);
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: init?.headers as Record<string, string> });
      return responses.get(url) ?? new Response('x', { status: 500 });
    }) as unknown as typeof fetch;
    const src = new HttpPageSource({
      userAgent: 'StrujaAlert/0.0.0 (+mailto:ops@example.rs)',
      fetchFn,
      delayMs: 1500,
      sleep: async (ms) => void sleeps.push(ms),
    });
    const ok = await src.fetchPage('Nis', 0);
    expect(ok).toMatchObject({ status: 200, etag: '"v1"' });
    expect(await src.fetchPage('Nis', 1, '"v1"')).toMatchObject({ status: 304, etag: '"v1"' });
    expect(await src.fetchPage('Nis', 2)).toBeNull();
    expect(sleeps).toEqual([1500, 1500, 1500]); // a pause before every request
    expect(calls.every((c) => c.headers['User-Agent']?.includes('mailto:ops@example.rs'))).toBe(
      true,
    );
    expect(calls[1]?.headers['If-None-Match']).toBe('"v1"');
    expect(calls[0]?.headers['If-None-Match']).toBeUndefined();
  });

  it('refuses to scrape without a contact address', () => {
    expect(scraperUserAgent('1.0.0', 'me@example.rs')).toBe(
      'StrujaAlert/1.0.0 (+mailto:me@example.rs)',
    );
    expect(() => scraperUserAgent('1.0.0', undefined)).toThrow(/SCRAPER_CONTACT_EMAIL/);
    expect(() => scraperUserAgent('1.0.0', 'nonsense')).toThrow(/SCRAPER_CONTACT_EMAIL/);
  });
});

describe('scrape -> plan -> deliver on the real saved Niš pages', () => {
  it('ingests today and the days after, then plans and delivers to a subscriber on a real street', async () => {
    const sub = await w.addSub({ norm: 'cegarska', house: 31 }); // odd 9-53 and even 30-44 in the real row
    const ctx = makeCtx();
    const scrape = await scrapeJob(ctx);
    expect(scrape.failed).toBe(0);
    expect(scrape.pages).toBe(4);
    expect(scrape.inserted).toBe(26); // the 26 rows of the 22 Oct snapshot
    expect(ctx.queued).toEqual([JOBS.plan]);

    await planJob(ctx);
    expect(ctx.queued).toEqual([JOBS.plan, JOBS.deliver]);
    const sent = await deliverJob(ctx);
    expect(sent.sent).toBeGreaterThan(0);
    const titles = w.titles(sub.token, null);
    expect(titles).toHaveLength(1);
    expect(titles[0]).toMatch(/^Isključenje struje: Čegarska 31, danas/);
  });

  it('a second scrape of unchanged pages stores and sends nothing new', async () => {
    const ctx = makeCtx();
    const again = await scrapeJob(ctx);
    expect(again.inserted).toBe(0);
    await planJob(ctx);
    expect((await deliverJob(ctx)).sent).toBe(0);
  });

  it('a page that cannot be fetched is recorded and alerted, and never counted as missing', async () => {
    const down: PageSource = {
      fetchPage: async () => {
        throw new Error('connection refused');
      },
    };
    const ctx = makeCtx({ pages: down });
    const r = await scrapeJob(ctx);
    expect(r.failed).toBe(4);
    const missing = await w.t.db.execute(sql`SELECT max(missing_runs)::int AS n FROM outage`);
    expect(missing.rows[0]?.n).toBe(0);
    const alerts = await w.t.db.execute(
      sql`SELECT count(*)::int AS n FROM alert WHERE kind = 'scrape_failed' AND resolved_at IS NULL`,
    );
    expect(alerts.rows[0]?.n).toBe(4);
    // and the alerts close once the pages come back
    await scrapeJob(makeCtx());
    const open = await w.t.db.execute(
      sql`SELECT count(*)::int AS n FROM alert WHERE kind = 'scrape_failed' AND resolved_at IS NULL`,
    );
    expect(open.rows[0]?.n).toBe(0);
  });

  it('a missing page for today is a failure; missing later days just end the list', async () => {
    const partial: PageSource = {
      fetchPage: async (city, day) =>
        day === 0 ? null : new FixturePageSource(EDS_DIR).fetchPage(city, day),
    };
    expect((await scrapeJob(makeCtx({ pages: partial }))).failed).toBe(1);
    const onlyToday: PageSource = {
      fetchPage: async (city, day) =>
        day === 0 ? new FixturePageSource(EDS_DIR).fetchPage(city, 0) : null,
    };
    expect((await scrapeJob(makeCtx({ pages: onlyToday }))).failed).toBe(0);
  });

  it('a 304 (unchanged) page is skipped without parsing', async () => {
    const unchanged: PageSource = {
      fetchPage: async (city, day) => ({
        url: pageUrl(city, day),
        status: 304,
        bytes: new Uint8Array(),
        etag: '"v"',
      }),
    };
    const r = await scrapeJob(makeCtx({ pages: unchanged }));
    expect(r).toMatchObject({ pages: 0, failed: 0 });
  });
});

describe('outage start and end signals', () => {
  it('signals each boundary once, to the people the outage affects', async () => {
    const sink = new FakeBoundarySink();
    // the real Čegarska row (12:00-14:00 CEST = 10:00Z-12:00Z)
    const before = await boundaryTick(w.t.db, sink, new Date('2026-10-22T09:59:00Z'));
    expect(before.started).toBe(0);
    const at = await boundaryTick(w.t.db, sink, new Date('2026-10-22T10:00:30Z'));
    expect(at.started).toBeGreaterThan(0);
    const cegarska = sink.started_.find((s) => s.recipients.some((r) => r.possible || !r.possible));
    expect(cegarska?.recipients.length).toBeGreaterThan(0);
    expect(cegarska?.recipients[0]).toMatchObject({ platform: 'android' });

    // a repeated tick, or a second worker, signals nothing again
    const again = await boundaryTick(w.t.db, sink, new Date('2026-10-22T10:00:45Z'));
    expect(again).toEqual({ started: 0, ended: 0 });

    const ends = await boundaryTick(w.t.db, sink, new Date('2026-10-22T12:00:30Z'));
    expect(ends.ended).toBeGreaterThan(0);
    expect(sink.ended_.every((e) => e.recipients !== undefined)).toBe(true);
  });

  it('releases the claim when the sink fails, so the next tick retries', async () => {
    await w.page('20.12.2026.', [['Пантелеј', '10:00 - 11:00', 'Студеничке']]);
    const at = new Date('2026-12-20T09:00:30Z'); // 10:00:30 local (winter)
    let failOnce = true;
    const flaky: BoundarySink = {
      started: async () => {
        if (failOnce) {
          failOnce = false;
          throw new Error('push provider down');
        }
      },
      ended: async () => {},
    };
    await expect(boundaryTick(w.t.db, flaky, at)).rejects.toThrow(/push provider down/);
    const retry = await boundaryTick(w.t.db, flaky, new Date(at.getTime() + 60_000));
    expect(retry.started).toBeGreaterThan(0);
  });

  it('does not signal a stale boundary (the job runner was down for hours)', async () => {
    await w.page('21.12.2026.', [['Пантелеј', '10:00 - 11:00', 'Чегарске']]);
    const sink = new FakeBoundarySink();
    const r = await boundaryTick(w.t.db, sink, new Date('2026-12-21T14:00:00Z')); // 4 hours later
    expect(r.started).toBe(0);
  });
});

describe('the nightly backup', () => {
  it('runs through the job and reports the file', async () => {
    let ran = 0;
    const runner: BackupRunner = {
      run: async () => {
        ran++;
        return { file: '/backups/struja.dump', bytes: 123, pruned: ['old.dump'] };
      },
    };
    const r = await backupJob(makeCtx({ backup: runner }));
    expect(ran).toBe(1);
    expect(r.bytes).toBe(123);
  });

  it('names dumps by UTC time and prunes only our own files older than 14 days', () => {
    expect(backupFileName(new Date('2026-10-22T01:30:15Z'))).toBe('struja-20261022T013015Z.dump');
    const dir = mkdtempSync(join(tmpdir(), 'backups-'));
    try {
      const now = new Date('2026-11-30T12:00:00Z');
      const make = (name: string, daysOld: number) => {
        const p = join(dir, name);
        writeFileSync(p, 'x');
        const t = new Date(now.getTime() - daysOld * 24 * 3600_000);
        utimesSync(p, t, t);
      };
      make('struja-20261101T033000Z.dump', 29); // old: pruned
      make('struja-20261120T033000Z.dump', 10); // recent: kept
      make('notes.txt', 400); // not ours: never touched
      mkdirSync(join(dir, 'sub'));
      const removed = pruneBackups(dir, now);
      expect(removed).toEqual(['struja-20261101T033000Z.dump']);
      expect(existsSync(join(dir, 'struja-20261120T033000Z.dump'))).toBe(true);
      expect(existsSync(join(dir, 'notes.txt'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the scheduler (a real pg-boss on the same database)', () => {
  it('schedules every job on Europe/Belgrade time', async () => {
    const boss = await startBoss(w.t.url);
    try {
      const ctx = makeCtx();
      await registerJobs(boss, ctx);
      const schedules = await boss.getSchedules();
      const byName = new Map(schedules.map((s) => [s.name, s]));
      for (const [name, cron] of Object.entries(SCHEDULES)) {
        if (!cron) continue;
        expect(byName.get(name)?.cron, name).toBe(cron);
        expect(byName.get(name)?.timezone, name).toBe(TIMEZONE);
      }
      expect(byName.get(JOBS.scrape)?.cron).toBe('0 7,13,19 * * *');
      expect(byName.get(JOBS.evening)?.cron).toBe('15 19 * * *');
    } finally {
      await boss.stop({ graceful: false, timeout: 5000 });
    }
  });

  it('keeps 07:00, 13:00 and 19:00 local across the clock change of 25 Oct 2026', async () => {
    const boss = await startBoss(w.t.url);
    try {
      const next = boss.previewSchedule(SCHEDULES[JOBS.scrape] as string, {
        tz: TIMEZONE,
        from: new Date('2026-10-24T00:00:00Z'),
        count: 9,
      });
      expect(next.map((d) => d.toISOString())).toEqual([
        '2026-10-24T05:00:00.000Z', // 07:00 CEST
        '2026-10-24T11:00:00.000Z', // 13:00 CEST
        '2026-10-24T17:00:00.000Z', // 19:00 CEST
        '2026-10-25T06:00:00.000Z', // 07:00 CET: the clocks changed at 03:00 that night
        '2026-10-25T12:00:00.000Z', // 13:00 CET
        '2026-10-25T18:00:00.000Z', // 19:00 CET
        '2026-10-26T06:00:00.000Z', // 07:00 CET
        '2026-10-26T12:00:00.000Z',
        '2026-10-26T18:00:00.000Z',
      ]);
    } finally {
      await boss.stop({ graceful: false, timeout: 5000 });
    }
  });

  it('really runs a queued job through its worker', async () => {
    const boss = await startBoss(w.t.url);
    try {
      let ran = 0;
      const runner: BackupRunner = {
        run: async () => {
          ran++;
          return { file: 'f', bytes: 1, pruned: [] };
        },
      };
      await registerJobs(boss, makeCtx({ backup: runner }), { schedules: false });
      await boss.send(JOBS.backup, null);
      const deadline = Date.now() + 20_000;
      while (ran === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
      expect(ran).toBe(1);
    } finally {
      await boss.stop({ graceful: false, timeout: 5000 });
    }
  });
});
