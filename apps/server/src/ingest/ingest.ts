import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import {
  decodePage,
  nisMunicipality,
  normalizeName,
  parsePage,
  resolveRow,
  splitUlice,
  type PageRow,
  type SegmentResolution,
} from '@struja/parser';
import type { Db } from '../db/client.ts';
import type { LoadedGazetteer } from '../gazetteer/load.ts';
import { outage, outageStreet, scrapeRun } from '../db/schema.ts';

export interface IngestPageInput {
  // The collector's slug for the page's city ("Nis", "Kraljevo", ...).
  city: string;
  url: string;
  bytes: Uint8Array;
  httpStatus?: number;
  etag?: string | null;
  // For tests; defaults to the current time.
  now?: Date;
}

export interface IngestResult {
  runId: number;
  rows: number;
  inserted: number;
  // Rows already stored (same content): only their last-seen run was refreshed.
  seen: number;
  // New rows that replace an older one with the same identity (a changed time window).
  changed: number;
  // Rows of this page's date that were missing this time (counted towards cancellation).
  missing: number;
  // Rows that became `cancelled` after being missing for two consecutive runs.
  cancelled: number;
  outOfScope: number;
  // Rows without a readable time window: not stored.
  skippedNoTime: number;
  segments: number;
  unresolvedSegments: number;
}

// A row that disappears from its page for this many consecutive fetches is cancelled, if it has
// not started yet (BRIEF §5).
export const CANCEL_AFTER_MISSING_RUNS = 2;

// In scope = a page of a city the app serves AND, for Niš, one of the five city municipalities as
// EDS writes them. Everything else is stored (the raw data is kept) but never matched.
export function rowInScope(city: string, row: PageRow): boolean {
  return city === 'Nis' && nisMunicipality(row.opstina) !== null;
}

const iso = (d: { year: number; month: number; day: number }) =>
  `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// Content hash: the full published row, so any change (street list or time) is a new row.
export function contentHash(city: string, date: string, row: PageRow): string {
  return sha256(JSON.stringify([city, row.ogranak, row.opstina, date, row.vreme, row.ulice]));
}

// Identity key (BRIEF §4): city + municipality + date + sorted normalized street set. The time
// window is deliberately not part of it, so a changed time is "changed", not "new" + "cancelled".
export function identityKey(city: string, date: string, row: PageRow): string {
  const names = new Set(splitUlice(row.ulice).map((s) => normalizeName(s.name)));
  return [city, normalizeName(row.opstina), date, [...names].sort().join(',')].join('|');
}

/**
 * Stores one EDS page: parse, split, resolve and persist, then work out what changed since the
 * previous fetch of the same date:
 *  - a row seen before (same content) only refreshes `last_seen_run`;
 *  - a new row with the identity of an older row that is no longer on the page is a `changed`
 *    version of it (the older row becomes `cancelled`, linked through `supersedes_outage_id`);
 *  - a row of this date that is missing for two consecutive fetches, and has not started, is
 *    `cancelled`.
 * Safe to run again on the same page.
 */
export async function ingestPage(
  db: Db,
  gaz: LoadedGazetteer,
  input: IngestPageInput,
): Promise<IngestResult> {
  const now = input.now ?? new Date();
  const { text } = decodePage(input.bytes);
  const page = parsePage(text);

  const [run] = await db
    .insert(scrapeRun)
    .values({
      city: input.city,
      url: input.url,
      httpStatus: input.httpStatus ?? 200,
      etag: input.etag ?? null,
    })
    .returning({ id: scrapeRun.id });
  const runId = run?.id as number;
  const result: IngestResult = {
    runId,
    rows: page.rows.length,
    inserted: 0,
    seen: 0,
    changed: 0,
    missing: 0,
    cancelled: 0,
    outOfScope: 0,
    skippedNoTime: 0,
    segments: 0,
    unresolvedSegments: 0,
  };

  if (!page.date) {
    await db
      .update(scrapeRun)
      .set({ finishedAt: sql`now()`, rowsFound: 0, error: 'page date not found' })
      .where(eq(scrapeRun.id, runId));
    throw new Error(`No date in the header of ${input.url}`);
  }
  const date = iso(page.date);

  const prepared = page.rows.flatMap((row) =>
    row.startsAt && row.endsAt
      ? [
          {
            row,
            startsAt: row.startsAt,
            endsAt: row.endsAt,
            hash: contentHash(input.city, date, row),
          },
        ]
      : [],
  );
  result.skippedNoTime = page.rows.length - prepared.length;
  const present = new Set(prepared.map((p) => p.hash));

  await db.transaction(async (tx) => {
    for (const { row, startsAt, endsAt, hash } of prepared) {
      const inScope = rowInScope(input.city, row);

      const existing = await tx
        .select({ id: outage.id, status: outage.status })
        .from(outage)
        .where(eq(outage.contentHash, hash));
      if (existing[0]) {
        // Seen before. A row that had been cancelled and is published again is active again.
        await tx
          .update(outage)
          .set({
            lastSeenRun: runId,
            missingRuns: 0,
            ...(existing[0].status === 'cancelled' ? { status: 'active' as const } : {}),
          })
          .where(eq(outage.id, existing[0].id));
        result.seen++;
        if (!inScope) result.outOfScope++;
        continue;
      }

      // Same identity, different content, and the older row is no longer on the page: a change.
      const key = identityKey(input.city, date, row);
      const olderRows = await tx.execute(sql`
        SELECT o.id, o.content_hash FROM outage o
        WHERE o.city = ${input.city} AND o.identity_key = ${key}
          AND o.status IN ('active', 'changed')
          AND NOT EXISTS (SELECT 1 FROM outage n WHERE n.supersedes_outage_id = o.id)
        ORDER BY o.id DESC`);
      const older = (olderRows.rows as { id: number; content_hash: string }[]).find(
        (o) => !present.has(o.content_hash),
      );

      const [created] = await tx
        .insert(outage)
        .values({
          sourceUrl: input.url,
          contentHash: hash,
          identityKey: key,
          city: input.city,
          branch: row.ogranak,
          municipality: row.opstina,
          inScope,
          outageDate: date,
          startsAt,
          endsAt,
          rawStreets: row.ulice,
          firstSeenRun: runId,
          lastSeenRun: runId,
          status: older ? 'changed' : 'active',
          supersedesOutageId: older?.id ?? null,
        })
        .returning({ id: outage.id });
      result.inserted++;
      if (older) {
        await tx.update(outage).set({ status: 'cancelled' }).where(eq(outage.id, older.id));
        result.changed++;
      }
      if (!inScope) {
        result.outOfScope++;
        continue;
      }

      const segments = splitUlice(row.ulice);
      const resolutions = resolveRow(segments, {
        resolver: gaz.resolver,
        settlements: gaz.settlementIndex,
        municipality: nisMunicipality(row.opstina),
        aliases: gaz.aliases,
        addressNumbers: gaz.addressNumbers,
      });
      const values = resolutions.flatMap((res, i) => segmentRows(created?.id as number, i, res));
      result.segments += resolutions.length;
      result.unresolvedSegments += resolutions.filter((r) => r.by === 'unresolved').length;
      if (values.length) await tx.insert(outageStreet).values(values);
    }

    // Rows of this date that were not on the page this time. Only a successful fetch of the page
    // gets here, so an unreachable page never counts as "missing".
    const missing = await tx
      .update(outage)
      .set({ missingRuns: sql`${outage.missingRuns} + 1` })
      .where(
        and(
          eq(outage.city, input.city),
          eq(outage.outageDate, date),
          sql`${outage.status} IN ('active', 'changed')`,
          sql`${outage.lastSeenRun} <> ${runId}`,
        ),
      )
      .returning({ id: outage.id });
    result.missing = missing.length;
    if (missing.length) {
      const cancelled = await tx
        .update(outage)
        .set({ status: 'cancelled' })
        .where(
          and(
            eq(outage.city, input.city),
            eq(outage.outageDate, date),
            sql`${outage.status} IN ('active', 'changed')`,
            sql`${outage.missingRuns} >= ${CANCEL_AFTER_MISSING_RUNS}`,
            // An outage that already started is just rolling off the page, not cancelled.
            sql`${outage.startsAt} > ${now.toISOString()}::timestamptz`,
          ),
        )
        .returning({ id: outage.id });
      result.cancelled = cancelled.length;
    }

    await tx
      .update(scrapeRun)
      .set({
        finishedAt: sql`now()`,
        rowsFound: page.rows.length,
        error: result.skippedNoTime ? `${result.skippedNoTime} rows without a time window` : null,
      })
      .where(eq(scrapeRun.id, runId));
  });
  return result;
}

// One row per house range; a segment with no ranges (the whole street) is one row.
function segmentRows(
  outageId: number,
  index: number,
  res: SegmentResolution,
): (typeof outageStreet.$inferInsert)[] {
  const base = {
    outageId,
    segmentIndex: index,
    streetId: res.street ? Number(res.street.id) : null,
    settlementId: res.settlement ? Number(res.settlement.id) : null,
    rawSegment: res.segment.raw,
    partial: res.segment.partial,
    resolvedBy: res.by,
    score: res.score,
    // Top candidates stay on the row for admin review (unresolved or only scored).
    candidates: res.candidates.length && res.by !== 'exact' ? res.candidates.slice(0, 5) : null,
  };
  const ranges = res.segment.ranges;
  if (ranges.length === 0) {
    return [{ ...base, houseFrom: null, houseTo: null, houseRaw: null, parity: null }];
  }
  return ranges.map((r) => ({
    ...base,
    houseFrom: r.from,
    houseTo: r.to,
    houseRaw: r.raw,
    parity: r.parity,
  }));
}
