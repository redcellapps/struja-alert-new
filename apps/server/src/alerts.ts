import { sql } from 'drizzle-orm';
import type { Db } from './db/client.ts';

// Alerts are recorded here and delivered by the monitor job (email + admin push, src/monitor).
export type AlertKind =
  | 'broken_page' // a page fetched with HTTP 200 that is truncated, has no table, or lost most rows
  | 'flip_flop' // an outage whose displayed version switched more than twice
  | 'scrape_failed'
  | 'resolution_low'
  | 'unresolved_segment'
  | 'zero_rows' // every page of a city empty, two fetches in a row
  | 'spot_check_rejects'
  | 'push_failures'
  | 'scrape_stale'; // the scheduler has stopped fetching

export interface AlertInput {
  kind: AlertKind;
  // One open alert per (kind, dedupeKey): a condition that stays true raises one alert, not one per fetch.
  dedupeKey: string;
  message: string;
  details?: Record<string, unknown>;
}

/** Returns true when a new alert was raised, false when the same one is already open. */
export async function raiseAlert(db: Pick<Db, 'execute'>, a: AlertInput): Promise<boolean> {
  const r = await db.execute(sql`
    INSERT INTO alert (kind, dedupe_key, message, details)
    VALUES (${a.kind}, ${a.dedupeKey}, ${a.message}, ${JSON.stringify(a.details ?? {})}::jsonb)
    ON CONFLICT (kind, dedupe_key) WHERE resolved_at IS NULL DO NOTHING
    RETURNING id`);
  return r.rows.length > 0;
}

/** Closes open alerts of a kind and key, e.g. once a page is healthy again. */
export async function resolveAlerts(
  db: Pick<Db, 'execute'>,
  kind: AlertKind,
  dedupeKey: string,
): Promise<number> {
  const r = await db.execute(sql`
    UPDATE alert SET resolved_at = now()
    WHERE kind = ${kind} AND dedupe_key = ${dedupeKey} AND resolved_at IS NULL
    RETURNING id`);
  return r.rows.length;
}
