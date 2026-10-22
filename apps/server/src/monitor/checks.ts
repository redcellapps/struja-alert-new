import { sql } from 'drizzle-orm';
import { raiseAlert, resolveAlerts, type AlertKind } from '../alerts.ts';
import { unresolvedQueue } from '../admin/service.ts';
import type { Db } from '../db/client.ts';

// Thresholds (BRIEF §4 Monitoring). The sample minimums keep one odd row from paging anyone.
export const RESOLUTION_ALERT_BELOW = 0.95;
export const RESOLUTION_MIN_SEGMENTS = 20;
export const SPOT_REJECT_ALERT_OVER = 0.01;
export const SPOT_MIN_REVIEWS = 20;
export const PUSH_FAILURE_ALERT_OVER = 0.1;
export const PUSH_MIN_ATTEMPTS = 20;
// The scheduler polls at 07, 13 and 19: no good fetch for this long means it is not running.
export const SCRAPE_STALE_HOURS = 14;

type Row = Record<string, unknown>;

export interface CheckOptions {
  cities: string[];
  // Base URL of the admin page, put in alerts that need a human decision.
  adminUrl?: string;
}

// An alert exists while its condition holds and is closed when it stops holding.
async function setAlert(
  db: Db,
  holds: boolean,
  kind: AlertKind,
  dedupeKey: string,
  message: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  if (holds) await raiseAlert(db, { kind, dedupeKey, message, details });
  else await resolveAlerts(db, kind, dedupeKey);
}

/** Evaluates the monitoring conditions and raises or closes the matching alerts. */
export async function runChecks(db: Db, now: Date, opts: CheckOptions): Promise<void> {
  const iso = now.toISOString();

  // 1. Zero rows on every page of a city, two fetches in a row.
  for (const city of opts.cities) {
    const runs = (
      await db.execute(sql`
        SELECT url, rows_found, rn FROM (
          SELECT url, rows_found, row_number() OVER (PARTITION BY url ORDER BY id DESC) AS rn
          FROM scrape_run
          WHERE city = ${city} AND http_status = 200 AND rows_found IS NOT NULL
        ) t WHERE rn <= 2`)
    ).rows as Row[];
    const urls = new Set(runs.map((r) => String(r.url)));
    const complete = urls.size > 0 && runs.length === urls.size * 2;
    const allZero = complete && runs.every((r) => Number(r.rows_found) === 0);
    await setAlert(
      db,
      allZero,
      'zero_rows',
      city,
      `${city}: every page had zero outage rows in the last two fetches. Either EDS is empty or the page format changed.`,
      { city, pages: urls.size },
    );
  }

  // 2. The share of segments of upcoming outages that resolved to a street or settlement.
  const seg = (
    await db.execute(sql`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE os.resolved_by = 'unresolved')::int AS unresolved
      FROM outage_street os JOIN outage o ON o.id = os.outage_id
      WHERE o.in_scope AND o.status IN ('active', 'changed') AND o.ends_at > ${iso}::timestamptz`)
  ).rows[0] as Row;
  const total = Number(seg.total);
  const rate = total ? 1 - Number(seg.unresolved) / total : 1;
  await setAlert(
    db,
    total >= RESOLUTION_MIN_SEGMENTS && rate < RESOLUTION_ALERT_BELOW,
    'resolution_low',
    'all',
    `Only ${(rate * 100).toFixed(1)}% of ${total} upcoming segments resolved (alert below ${RESOLUTION_ALERT_BELOW * 100}%).${opts.adminUrl ? ` Review: ${opts.adminUrl}/admin` : ''}`,
    { rate, total },
  );

  // 3. A new unresolved segment of a future outage, one alert per segment name.
  const queue = await unresolvedQueue(db, now);
  for (const item of queue) {
    await raiseAlert(db, {
      kind: 'unresolved_segment',
      dedupeKey: item.segNorm,
      message: `Unresolved segment "${item.name}" (${item.municipality}) in ${item.outages} upcoming outage(s), first ${item.firstStart.slice(0, 16)}Z.${opts.adminUrl ? ` Review: ${opts.adminUrl}/admin` : ''}`,
      details: { segNorm: item.segNorm, candidates: item.candidates.map((c) => c.name) },
    });
  }
  await db.execute(sql`
    UPDATE alert SET resolved_at = now()
    WHERE kind = 'unresolved_segment' AND resolved_at IS NULL
      AND dedupe_key NOT IN (SELECT jsonb_array_elements_text(${JSON.stringify(queue.map((q) => q.segNorm))}::jsonb))`);

  // 4. Auto-accepted matches the admin rejected in the spot check.
  const rev = (
    await db.execute(sql`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE decision = 'rejected')::int AS rejected
      FROM segment_review
      WHERE kind = 'spot_check' AND decided_at > ${iso}::timestamptz - interval '30 days'`)
  ).rows[0] as Row;
  const reviews = Number(rev.total);
  const rejected = Number(rev.rejected);
  await setAlert(
    db,
    reviews >= SPOT_MIN_REVIEWS && rejected / reviews > SPOT_REJECT_ALERT_OVER,
    'spot_check_rejects',
    'all',
    `${rejected} of ${reviews} spot-checked auto-accepts were rejected (alert over ${SPOT_REJECT_ALERT_OVER * 100}%): the scoring needs another look.`,
    { reviews, rejected },
  );

  // 5. Push sends that failed in the last 24 hours.
  const push = (
    await db.execute(sql`
      SELECT count(*) FILTER (WHERE status = 'failed')::int AS failed,
             count(*) FILTER (WHERE status IN ('sent', 'failed'))::int AS attempts
      FROM notification_log WHERE created_at > ${iso}::timestamptz - interval '24 hours'`)
  ).rows[0] as Row;
  const attempts = Number(push.attempts);
  const failed = Number(push.failed);
  await setAlert(
    db,
    attempts >= PUSH_MIN_ATTEMPTS && failed / attempts > PUSH_FAILURE_ALERT_OVER,
    'push_failures',
    'all',
    `${failed} of ${attempts} push notifications failed in the last 24 hours (alert over ${PUSH_FAILURE_ALERT_OVER * 100}%).`,
    { failed, attempts },
  );

  // 6. The scheduler has stopped fetching.
  const last = (
    await db.execute(sql`
      SELECT max(started_at) AS at FROM scrape_run WHERE http_status = 200`)
  ).rows[0] as Row;
  const lastAt = last.at ? new Date(String(last.at)) : null;
  const ageH = lastAt ? (now.getTime() - lastAt.getTime()) / 3_600_000 : 0;
  await setAlert(
    db,
    lastAt !== null && ageH > SCRAPE_STALE_HOURS,
    'scrape_stale',
    'all',
    `No successful fetch for ${ageH.toFixed(1)} hours (the scheduler polls at 07, 13 and 19).`,
    { lastAt: lastAt?.toISOString() },
  );
}
