import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import {
  decodePage,
  isCompletePage,
  nisMunicipality,
  normalizeName,
  parsePage,
  resolveRow,
  splitUlice,
  type PageRow,
  type SegmentResolution,
} from '@struja/parser';
import { raiseAlert, resolveAlerts } from '../alerts.ts';
import type { Db } from '../db/client.ts';
import type { LoadedGazetteer } from '../gazetteer/load.ts';
import { outage, outageStreet, scrapeRun } from '../db/schema.ts';
import { pairChanges, type PairRow } from './pairing.ts';

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

// How a fetched page looked (the broken page guard):
//  - truncated / no_table: HTTP 200 but cut off or without an outage table: not used at all.
//  - reduced: fewer than half the rows of the previous healthy fetch (which had at least 5) for the same date: its new rows
//    are stored, but it does not count towards "missing" (no cancellation, no pairing).
//  - confirmed_reduced: a reduced fetch right after another reduced one: taken as real (a mass cancellation).
export const MIN_BASELINE_ROWS = 5;
export type PageHealth = 'ok' | 'truncated' | 'no_table' | 'reduced' | 'confirmed_reduced';

export interface IngestResult {
  runId: number;
  health: PageHealth;
  rows: number;
  inserted: number;
  // Rows already stored (same content): only their last-seen run was refreshed.
  seen: number;
  // New rows that replace an older one (a changed time or an edited street list).
  changed: number;
  // Ambiguous changes: groups of rows that could not be paired one to one.
  groups: number;
  // A replaced row that came back (EDS reverted a change).
  reverted: number;
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

const streetSet = (ulice: string) => new Set(splitUlice(ulice).map((s) => normalizeName(s.name)));

// Identity key (BRIEF §4): city + municipality + date + sorted normalized street set. The time
// window is deliberately not part of it, so a changed time is "changed", not "new" + "cancelled".
export function identityKey(city: string, date: string, row: PageRow): string {
  return [city, normalizeName(row.opstina), date, [...streetSet(row.ulice)].sort().join(',')].join(
    '|',
  );
}

/**
 * Stores one EDS page: parse, split, resolve and persist, then work out what changed since the
 * previous fetch of the same date:
 *  - a row seen before (same content) only refreshes `last_seen_run`;
 *  - a new row that replaces an old row which left the page is `changed` (a different time
 *    window, or an edited street list); the old row becomes `cancelled` and is linked to its
 *    replacement through `superseded_by_outage_id`, so it never produces a "cancelled" notice;
 *  - when old and new rows cannot be paired one to one without guessing, they share a change
 *    group (`change_group_id`);
 *  - a replaced row that is published again (EDS reverted the change) is `changed` back to the
 *    original, and the newer row it had replaced becomes the superseded one;
 *  - a row of this date missing for two consecutive fetches, which has not started, is `cancelled`.
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
    health: 'ok',
    rows: page.rows.length,
    inserted: 0,
    seen: 0,
    changed: 0,
    groups: 0,
    reverted: 0,
    missing: 0,
    cancelled: 0,
    outOfScope: 0,
    skippedNoTime: 0,
    segments: 0,
    unresolvedSegments: 0,
  };

  const alertKey = `${input.city}|${input.url}`;
  const structural: PageHealth | null = !isCompletePage(text)
    ? 'truncated'
    : !page.tableFound
      ? 'no_table'
      : null;
  if (structural) {
    // Treated as a failed fetch: nothing is stored and nothing counts as missing.
    await db
      .update(scrapeRun)
      .set({
        finishedAt: sql`now()`,
        rowsFound: page.rows.length,
        health: structural,
        pageDate: page.date ? iso(page.date) : null,
        error: `page ${structural}`,
      })
      .where(eq(scrapeRun.id, runId));
    await raiseAlert(db, {
      kind: 'broken_page',
      dedupeKey: alertKey,
      message: `${input.url} came back with HTTP ${input.httpStatus ?? 200} but is ${
        structural === 'truncated' ? 'cut off' : 'missing the outage table'
      }; treated as a failed fetch`,
      details: { health: structural, bytes: input.bytes.length, rowsParsed: page.rows.length },
    });
    result.health = structural;
    return result;
  }

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

  // Fewer than half the rows of the previous healthy fetch for the same date? Then this page may be
  // broken even though it parses: it must not count towards "missing". The same reduced page twice
  // in a row is taken as real (e.g. most outages of the day really were cancelled).
  const history = (
    await db.execute(sql`
      SELECT rows_found, health FROM scrape_run
      WHERE city = ${input.city} AND page_date = ${date}
        AND health IN ('ok', 'confirmed_reduced', 'reduced') AND id <> ${runId}
      ORDER BY id DESC LIMIT 20`)
  ).rows as { rows_found: number; health: string }[];
  const baseline = history.find((h) => h.health !== 'reduced');
  let health: PageHealth = 'ok';
  // Small pages (under MIN_BASELINE_ROWS) follow the normal two-missed-fetches rule: going from one
  // outage to none is an ordinary cancellation, not a broken page.
  if (
    baseline &&
    baseline.rows_found >= MIN_BASELINE_ROWS &&
    page.rows.length * 2 < baseline.rows_found
  ) {
    // Below half again right after a reduced fetch: the drop is real.
    health = history[0]?.health === 'reduced' ? 'confirmed_reduced' : 'reduced';
  }
  result.health = health;
  const trusted = health !== 'reduced';

  await db.transaction(async (tx) => {
    const created: PairRow[] = [];

    for (const { row, startsAt, endsAt, hash } of prepared) {
      const inScope = rowInScope(input.city, row);

      const existing = (
        await tx
          .select({
            id: outage.id,
            status: outage.status,
            supersededBy: outage.supersededByOutageId,
            changeGroupId: outage.changeGroupId,
          })
          .from(outage)
          .where(eq(outage.contentHash, hash))
      )[0];
      if (existing) {
        await tx
          .update(outage)
          .set({ lastSeenRun: runId, missingRuns: 0 })
          .where(eq(outage.id, existing.id));
        if (existing.status === 'cancelled') {
          const reverted = await reappear(tx, existing, present);
          if (reverted) result.reverted++;
        }
        result.seen++;
        if (!inScope) result.outOfScope++;
        continue;
      }

      const key = identityKey(input.city, date, row);
      const [inserted] = await tx
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
        })
        .returning({ id: outage.id });
      const id = inserted?.id as number;
      result.inserted++;
      created.push({
        id,
        identityKey: key,
        municipality: normalizeName(row.opstina),
        date,
        startsAt,
        endsAt,
        streets: streetSet(row.ulice),
      });
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
        settlementAliases: gaz.settlementAliases,
        addressNumbers: gaz.addressNumbers,
      });
      const values = resolutions.flatMap((res, i) => segmentRows(id, i, res));
      result.segments += resolutions.length;
      result.unresolvedSegments += resolutions.filter((r) => r.by === 'unresolved').length;
      if (values.length) await tx.insert(outageStreet).values(values);
    }

    // Pair the new rows with the stored rows of this date that left the page.
    if (trusted) {
      const p = await pairDate(tx, input.city, date, created, present);
      result.changed += p.changed;
      result.groups += p.groups;
    }

    if (trusted) {
      const r = await countMissing(tx, input.city, date, runId, now);
      result.missing = r.missing;
      result.cancelled = r.cancelled;
    }

    await tx
      .update(scrapeRun)
      .set({
        finishedAt: sql`now()`,
        rowsFound: page.rows.length,
        pageDate: date,
        health,
        error: result.skippedNoTime ? `${result.skippedNoTime} rows without a time window` : null,
      })
      .where(eq(scrapeRun.id, runId));
  });

  if (health === 'reduced') {
    await raiseAlert(db, {
      kind: 'broken_page',
      dedupeKey: alertKey,
      message: `${input.url} has ${page.rows.length} rows, fewer than half of the ${baseline?.rows_found} of the previous fetch for ${date}; not counted towards cancellations`,
      details: { health, rows: page.rows.length, previousRows: baseline?.rows_found, date },
    });
  } else {
    await resolveAlerts(db, 'broken_page', alertKey);
  }
  return result;
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

// Pairs the new rows of a date with the stored rows of that date that left the page: a changed
// time or an edited street list becomes "changed" (old row superseded), not cancelled + new.
async function pairDate(
  tx: Tx,
  city: string,
  date: string,
  created: PairRow[],
  present: ReadonlySet<string>,
): Promise<{ changed: number; groups: number }> {
  const out = { changed: 0, groups: 0 };
  if (created.length === 0) return out;
  const newIds = new Set(created.map((c) => c.id));
  const candidates = (
    await tx.execute(sql`
          SELECT id, identity_key, municipality, outage_date::text AS d, starts_at, ends_at,
                 raw_streets, content_hash
          FROM outage
          WHERE city = ${city} AND outage_date = ${date}
            AND status IN ('active', 'changed')
            AND superseded_by_outage_id IS NULL AND change_group_id IS NULL`)
  ).rows as {
    id: number;
    identity_key: string;
    municipality: string;
    d: string;
    starts_at: string;
    ends_at: string;
    raw_streets: string;
    content_hash: string;
  }[];
  const olds: PairRow[] = candidates
    .filter((o) => !newIds.has(o.id) && !present.has(o.content_hash))
    .map((o) => ({
      id: o.id,
      identityKey: o.identity_key,
      municipality: normalizeName(o.municipality),
      date: o.d,
      startsAt: new Date(o.starts_at),
      endsAt: new Date(o.ends_at),
      streets: streetSet(o.raw_streets),
    }));

  const { pairs, groups } = pairChanges(created, olds);
  for (const p of pairs) {
    const before = await flipsOf(tx, [p.oldId]);
    await tx
      .update(outage)
      .set({ status: 'changed', flips: before + 1 })
      .where(eq(outage.id, p.newId));
    await flagFlips(tx, p.newId, before + 1);
    await tx
      .update(outage)
      .set({ status: 'cancelled', supersededByOutageId: p.newId })
      .where(eq(outage.id, p.oldId));
    out.changed++;
  }
  for (const g of groups) {
    const groupId = Math.min(...g.newIds);
    const before = await flipsOf(tx, g.oldIds);
    for (const id of g.newIds) {
      await tx
        .update(outage)
        .set({ status: 'changed', changeGroupId: groupId, flips: before + 1 })
        .where(eq(outage.id, id));
      await flagFlips(tx, id, before + 1);
    }
    for (const id of g.oldIds) {
      await tx
        .update(outage)
        .set({ status: 'cancelled', changeGroupId: groupId })
        .where(eq(outage.id, id));
    }
    out.changed += g.newIds.length;
    out.groups++;
  }
  return out;
}

// Rows of a date that were not on the page this time. Only a successful fetch of the page gets
// here, so an unreachable page never counts as "missing". Two misses cancel a not-yet-started outage.
async function countMissing(
  tx: Tx,
  city: string,
  date: string,
  runId: number,
  now: Date,
): Promise<{ missing: number; cancelled: number }> {
  const missing = await tx
    .update(outage)
    .set({ missingRuns: sql`${outage.missingRuns} + 1` })
    .where(
      and(
        eq(outage.city, city),
        eq(outage.outageDate, date),
        sql`${outage.status} IN ('active', 'changed')`,
        sql`${outage.lastSeenRun} <> ${runId}`,
      ),
    )
    .returning({ id: outage.id });
  if (!missing.length) return { missing: 0, cancelled: 0 };
  const cancelled = await tx
    .update(outage)
    .set({ status: 'cancelled', revision: sql`${outage.revision} + 1` })
    .where(
      and(
        eq(outage.city, city),
        eq(outage.outageDate, date),
        sql`${outage.status} IN ('active', 'changed')`,
        sql`${outage.missingRuns} >= ${CANCEL_AFTER_MISSING_RUNS}`,
        // An outage that already started is just rolling off the page, not cancelled.
        sql`${outage.startsAt} > ${now.toISOString()}::timestamptz`,
      ),
    )
    .returning({ id: outage.id });
  return { missing: missing.length, cancelled: cancelled.length };
}

// A reduced page is only taken as real when it is the latest fetch of its date: the admin confirms
// it ("this really happened"), which runs the missing/cancel pass that the page skipped.
export async function confirmReducedRun(
  db: Db,
  runId: number,
  now: Date = new Date(),
): Promise<'confirmed' | 'not_reduced' | 'superseded'> {
  return db.transaction(async (tx) => {
    const run = (
      await tx.execute(
        sql`SELECT city, page_date::text AS d, health FROM scrape_run WHERE id = ${runId} FOR UPDATE`,
      )
    ).rows[0] as { city: string; d: string; health: string } | undefined;
    if (!run || run.health !== 'reduced') return 'not_reduced';
    const later = await tx.execute(
      sql`SELECT 1 FROM scrape_run WHERE city = ${run.city} AND page_date = ${run.d} AND id > ${runId} AND health IN ('ok','confirmed_reduced','reduced') LIMIT 1`,
    );
    if (later.rows.length) return 'superseded';
    // The same steps as a normal fetch: pair the rows this page added with the rows it dropped
    // (a changed time is "changed", not cancelled + new), then count the rest as missing.
    const added = (
      await tx.execute(sql`
        SELECT id, identity_key, municipality, starts_at, ends_at, raw_streets FROM outage
        WHERE city = ${run.city} AND outage_date = ${run.d} AND first_seen_run = ${runId}`)
    ).rows as {
      id: number;
      identity_key: string;
      municipality: string;
      starts_at: string;
      ends_at: string;
      raw_streets: string;
    }[];
    const onPage = (
      await tx.execute(
        sql`SELECT content_hash FROM outage WHERE city = ${run.city} AND last_seen_run = ${runId}`,
      )
    ).rows.map((r) => String(r.content_hash));
    await pairDate(
      tx,
      run.city,
      run.d,
      added.map((o) => ({
        id: o.id,
        identityKey: o.identity_key,
        municipality: normalizeName(o.municipality),
        date: run.d,
        startsAt: new Date(o.starts_at),
        endsAt: new Date(o.ends_at),
        streets: streetSet(o.raw_streets),
      })),
      new Set(onPage),
    );
    await countMissing(tx, run.city, run.d, runId, now);
    await tx.execute(sql`UPDATE scrape_run SET health = 'confirmed_reduced' WHERE id = ${runId}`);
    await tx.execute(
      sql`UPDATE alert SET resolved_at = now() WHERE kind = 'broken_page' AND resolved_at IS NULL AND dedupe_key LIKE ${`${run.city}|%`} AND details->>'date' = ${run.d}`,
    );
    return 'confirmed';
  });
}

// The highest flip count among some rows (0 for none).
async function flipsOf(tx: Tx, ids: number[]): Promise<number> {
  let max = 0;
  for (const id of ids) {
    const r = await tx.select({ f: outage.flips }).from(outage).where(eq(outage.id, id));
    max = Math.max(max, r[0]?.f ?? 0);
  }
  return max;
}

// An outage whose displayed version switched more than twice (A->B->A->B ...) raises an alert.
export const FLIP_ALERT_OVER = 2;
async function flagFlips(tx: Tx, outageId: number, flips: number): Promise<void> {
  if (flips <= FLIP_ALERT_OVER) return;
  const r = (
    await tx
      .select({
        key: outage.identityKey,
        date: outage.outageDate,
        municipality: outage.municipality,
      })
      .from(outage)
      .where(eq(outage.id, outageId))
  )[0];
  if (!r) return;
  await raiseAlert(tx, {
    kind: 'flip_flop',
    dedupeKey: `identity:${r.key}`,
    message: `The outage in ${r.municipality} on ${r.date} has switched its published version ${flips} times`,
    details: { outageId, flips, identityKey: r.key },
  });
}

/**
 * A `cancelled` row is published again. If it had been replaced (a changed time or an edited
 * street list), EDS reverted the change: this row is now the `changed` one (back to the original)
 * and the rows that replaced it become the superseded ones, so there is an "Izmena" back and never
 * a "cancelled" for the newer row (KNOWN GAP 2). Otherwise it had only been cancelled by the
 * missing-runs rule and is simply active again. Returns true for a revert.
 */
async function reappear(
  tx: Tx,
  row: { id: number; supersededBy: number | null; changeGroupId: number | null },
  present: ReadonlySet<string>,
): Promise<boolean> {
  const replacements: { id: number; content_hash: string; flips: number }[] = [];
  if (row.supersededBy !== null) {
    const r = await tx.execute(
      sql`SELECT id, content_hash, flips FROM outage WHERE id = ${row.supersededBy}`,
    );
    replacements.push(...(r.rows as typeof replacements));
  } else if (row.changeGroupId !== null) {
    const r = await tx.execute(sql`
      SELECT id, content_hash, flips FROM outage
      WHERE change_group_id = ${row.changeGroupId} AND status = 'changed' AND id <> ${row.id}`);
    replacements.push(...(r.rows as typeof replacements));
  }

  const gone = replacements.filter((r) => !present.has(r.content_hash));
  if (gone.length === 0) {
    // Nothing it was replaced by has left the page (or it was never replaced): simply active.
    // An undone cancellation: a new revision, so "reinstated" can be told to those who got "Otkazano".
    await tx
      .update(outage)
      .set({
        status: 'active',
        supersededByOutageId: null,
        changeGroupId: null,
        revision: sql`${outage.revision} + 1`,
      })
      .where(eq(outage.id, row.id));
    return false;
  }
  // A reverted change: a new revision, so this "Izmena" is not swallowed by the earlier one.
  const flips = Math.max(...gone.map((g) => g.flips)) + 1;
  await tx
    .update(outage)
    .set({
      status: 'changed',
      supersededByOutageId: null,
      changeGroupId: null,
      revision: sql`${outage.revision} + 1`,
      flips,
    })
    .where(eq(outage.id, row.id));
  await flagFlips(tx, row.id, flips);
  for (const g of gone) {
    await tx
      .update(outage)
      .set({ status: 'cancelled', supersededByOutageId: row.id, changeGroupId: null })
      .where(eq(outage.id, g.id));
  }
  return true;
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
    // All of them for a name that several streets share (each one is told "Moguće"); else the top five.
    candidates: res.candidates.length
      ? res.by === 'ambiguous'
        ? res.candidates
        : res.by !== 'exact'
          ? res.candidates.slice(0, 5)
          : null
      : null,
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
