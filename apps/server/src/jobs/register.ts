import { PgBoss } from 'pg-boss';
import {
  backupJob,
  boundaryJob,
  deliverJob,
  eveningJob,
  JOBS,
  planJob,
  receiptsJob,
  safetyNetJob,
  scrapeJob,
  type JobContext,
  type JobName,
} from './handlers.ts';

// Everything runs on Europe/Belgrade time (BRIEF §4 Jobs). pg-boss evaluates the cron in this zone,
// so 07:00 stays 07:00 across the clock change on 25 Oct.
export const TIMEZONE = 'Europe/Belgrade';

export const SCHEDULES: Readonly<Record<JobName, string | null>> = {
  [JOBS.scrape]: '0 7,13,19 * * *', // the three daily polls
  [JOBS.evening]: '15 19 * * *', // after the 19:00 scrape
  [JOBS.plan]: '*/10 * * * *', // also chained after every scrape; this is the backstop
  [JOBS.deliver]: '* * * * *', // releases notifications held for quiet hours on time
  [JOBS.boundary]: '* * * * *', // outage start / end signals
  [JOBS.receipts]: '*/5 * * * *',
  [JOBS.safetyNet]: '5 * * * *', // hourly: the 12-hour safety net
  [JOBS.backup]: '30 3 * * *', // nightly pg_dump
};

const HANDLERS: Record<JobName, (ctx: JobContext) => Promise<unknown>> = {
  [JOBS.scrape]: scrapeJob,
  [JOBS.plan]: planJob,
  [JOBS.evening]: eveningJob,
  [JOBS.deliver]: deliverJob,
  [JOBS.receipts]: receiptsJob,
  [JOBS.boundary]: boundaryJob,
  [JOBS.safetyNet]: safetyNetJob,
  [JOBS.backup]: backupJob,
};

export type JobDeps = Omit<JobContext, 'enqueue'>;

/**
 * Creates the queues, registers the schedules (Europe/Belgrade) and the workers. Returns the full
 * context so callers can also trigger a job by hand. `boss` must already be started.
 */
export async function registerJobs(
  boss: PgBoss,
  deps: JobDeps,
  opts: { schedules?: boolean } = {},
): Promise<JobContext> {
  const ctx: JobContext = {
    ...deps,
    // Chained jobs are throttled: a burst of scrapes queues one follow-up, not ten.
    enqueue: async (name) => {
      await boss.sendThrottled(name, null, null, 5);
    },
  };
  for (const name of Object.values(JOBS)) {
    await boss.createQueue(name, { retryLimit: 2, retryDelay: 30, retryBackoff: true });
    await boss.work(name, async () => {
      await HANDLERS[name](ctx);
    });
    const cron = SCHEDULES[name];
    if (cron && opts.schedules !== false) await boss.schedule(name, cron, null, { tz: TIMEZONE });
  }
  return ctx;
}

export async function startBoss(connectionString: string): Promise<PgBoss> {
  const boss = new PgBoss(connectionString);
  boss.on('error', (e) => console.error('pg-boss error', e));
  await boss.start();
  return boss;
}
