import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
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
}

export interface IngestResult {
  runId: number;
  rows: number;
  inserted: number;
  // Rows already stored (same content): only their last-seen run was refreshed.
  seen: number;
  outOfScope: number;
  // Rows without a readable time window: not stored.
  skippedNoTime: number;
  segments: number;
  unresolvedSegments: number;
}

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
 * Stores one EDS page: parse, split, resolve and persist. Safe to run again on the same page:
 * rows are keyed by content hash, so a repeat only refreshes `last_seen_run`.
 */
export async function ingestPage(
  db: Db,
  gaz: LoadedGazetteer,
  input: IngestPageInput,
): Promise<IngestResult> {
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

  await db.transaction(async (tx) => {
    for (const row of page.rows) {
      if (!row.startsAt || !row.endsAt) {
        result.skippedNoTime++;
        continue;
      }
      const inScope = rowInScope(input.city, row);
      const hash = contentHash(input.city, date, row);

      const existing = await tx
        .select({ id: outage.id })
        .from(outage)
        .where(eq(outage.contentHash, hash));
      if (existing[0]) {
        await tx
          .update(outage)
          .set({ lastSeenRun: runId, missingRuns: 0 })
          .where(eq(outage.id, existing[0].id));
        result.seen++;
        if (!inScope) result.outOfScope++;
        continue;
      }

      const [created] = await tx
        .insert(outage)
        .values({
          sourceUrl: input.url,
          contentHash: hash,
          identityKey: identityKey(input.city, date, row),
          city: input.city,
          branch: row.ogranak,
          municipality: row.opstina,
          inScope,
          outageDate: date,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          rawStreets: row.ulice,
          firstSeenRun: runId,
          lastSeenRun: runId,
        })
        .returning({ id: outage.id });
      result.inserted++;
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
