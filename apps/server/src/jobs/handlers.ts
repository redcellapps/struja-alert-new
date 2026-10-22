import { and, desc, eq, sql } from 'drizzle-orm';
import { raiseAlert, resolveAlerts } from '../alerts.ts';
import type { Db } from '../db/client.ts';
import { scrapeRun } from '../db/schema.ts';
import type { GazetteerService } from '../gazetteer/service.ts';
import { ingestPage } from '../ingest/ingest.ts';
import { deliverPending, processReceipts } from '../notify/deliver.ts';
import { planEveningBefore, planNotifications, planSafetyNet } from '../notify/plan.ts';
import type { PushProvider } from '../notify/provider.ts';
import type { BackupRunner } from './backup.ts';
import { boundaryTick, type BoundarySink } from './boundary.ts';
import { pageUrl, type PageSource } from './sources.ts';

// The job handlers are plain functions over a context, so they run (and are tested) without the
// scheduler. `register.ts` wires them to pg-boss on Europe/Belgrade cron.
export const JOBS = {
  scrape: 'scrape', // 07:00, 13:00, 19:00
  plan: 'plan', // after each scrape, and every 10 minutes as a backstop
  evening: 'evening-reminder', // 19:15
  deliver: 'deliver', // every minute: due notifications, held ones released after quiet hours
  receipts: 'receipts', // every 5 minutes
  boundary: 'boundary', // every minute: outage start / end signals
  safetyNet: 'safety-net', // hourly: the 12-hour safety net
  backup: 'backup', // nightly
} as const;
export type JobName = (typeof JOBS)[keyof typeof JOBS];

export interface JobContext {
  db: Db;
  gazetteers: GazetteerService;
  provider: PushProvider;
  pages: PageSource;
  boundary: BoundarySink;
  backup: BackupRunner;
  // The city slugs the app serves ("Nis").
  cities: string[];
  now: () => Date;
  // Chains a follow-up job (e.g. plan after scrape).
  enqueue: (name: JobName) => Promise<void>;
  log: (message: string, extra?: Record<string, unknown>) => void;
}

// EDS publishes today plus three days ahead.
export const DAYS = [0, 1, 2, 3] as const;

export interface ScrapeResult {
  pages: number;
  inserted: number;
  failed: number;
  unhealthy: number;
}

// The last ETag stored for a page URL, for a conditional request.
async function lastEtag(db: Db, url: string): Promise<string | null> {
  const r = await db
    .select({ etag: scrapeRun.etag })
    .from(scrapeRun)
    .where(and(eq(scrapeRun.url, url), eq(scrapeRun.httpStatus, 200)))
    .orderBy(desc(scrapeRun.id))
    .limit(1);
  return r[0]?.etag ?? null;
}

/**
 * Fetches and ingests the pages of every served city: parse, resolve, persist, detect changes.
 * A page that cannot be fetched is recorded and alerted, never counted as "missing". Plans the
 * notifications afterwards.
 */
export async function scrapeJob(ctx: JobContext): Promise<ScrapeResult> {
  const out: ScrapeResult = { pages: 0, inserted: 0, failed: 0, unhealthy: 0 };
  for (const city of ctx.cities) {
    const gaz = await ctx.gazetteers.get(city);
    for (const day of DAYS) {
      const url = pageUrl(city, day);
      let fetched;
      try {
        fetched = await ctx.pages.fetchPage(city, day, await lastEtag(ctx.db, url));
      } catch (e) {
        out.failed++;
        await recordFailure(ctx, city, url, null, e instanceof Error ? e.message : String(e));
        continue;
      }
      if (fetched === null) {
        // Days beyond the published ones are a 404; a missing day 0 is not normal.
        if (day === 0) {
          out.failed++;
          await recordFailure(ctx, city, url, 404, 'today’s page is missing');
        }
        break;
      }
      if (fetched.status === 304) continue; // unchanged: nothing to parse, nothing missing
      if (fetched.status !== 200) {
        out.failed++;
        await recordFailure(ctx, city, url, fetched.status, `HTTP ${fetched.status}`);
        continue;
      }
      try {
        const r = await ingestPage(ctx.db, gaz, {
          city,
          url,
          bytes: fetched.bytes,
          etag: fetched.etag,
          httpStatus: fetched.status,
          now: ctx.now(),
        });
        out.pages++;
        out.inserted += r.inserted;
        if (r.health === 'truncated' || r.health === 'no_table' || r.health === 'reduced') {
          out.unhealthy++;
        } else {
          await resolveAlerts(ctx.db, 'scrape_failed', url);
        }
      } catch (e) {
        out.failed++;
        await recordFailure(
          ctx,
          city,
          url,
          fetched.status,
          e instanceof Error ? e.message : String(e),
        );
      }
    }
  }
  ctx.log('scrape done', { ...out });
  await ctx.enqueue(JOBS.plan);
  return out;
}

async function recordFailure(
  ctx: JobContext,
  city: string,
  url: string,
  status: number | null,
  error: string,
): Promise<void> {
  await ctx.db.insert(scrapeRun).values({
    city,
    url,
    httpStatus: status,
    error,
    finishedAt: sql`now()` as unknown as Date,
  });
  await raiseAlert(ctx.db, {
    kind: 'scrape_failed',
    dedupeKey: url,
    message: `Fetching ${url} failed: ${error}`,
    details: { city, status },
  });
}

/** New and changed outages, cancellations, reinstatements and the 12-hour safety net. */
export async function planJob(ctx: JobContext) {
  const now = ctx.now();
  const main = await planNotifications(ctx.db, now);
  const safety = await planSafetyNet(ctx.db, now);
  await ctx.enqueue(JOBS.deliver);
  return { planned: main.planned + safety.planned };
}

/** The 19:15 reminder for tomorrow's outages. */
export async function eveningJob(ctx: JobContext) {
  const r = await planEveningBefore(ctx.db, ctx.now());
  await ctx.enqueue(JOBS.deliver);
  return r;
}

/** Sends what is due; notifications held for quiet hours go out once the window ends. */
export async function deliverJob(ctx: JobContext) {
  return deliverPending(ctx.db, ctx.provider, ctx.now());
}

export async function receiptsJob(ctx: JobContext) {
  return processReceipts(ctx.db, ctx.provider, ctx.now());
}

export async function boundaryJob(ctx: JobContext) {
  return boundaryTick(ctx.db, ctx.boundary, ctx.now());
}

export async function safetyNetJob(ctx: JobContext) {
  const r = await planSafetyNet(ctx.db, ctx.now());
  if (r.planned > 0) await ctx.enqueue(JOBS.deliver);
  return r;
}

export async function backupJob(ctx: JobContext) {
  const r = await ctx.backup.run(ctx.now());
  ctx.log('backup done', { file: r.file, bytes: r.bytes, pruned: r.pruned.length });
  return r;
}
