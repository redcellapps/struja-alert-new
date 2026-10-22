import { sql } from 'drizzle-orm';
import { normalizeName, splitUlice } from '@struja/parser';
import type { Db } from '../db/client.ts';
import type { GazetteerService } from '../gazetteer/service.ts';

export interface Candidate {
  id: number;
  name: string;
  score: number;
}

export interface UnresolvedItem {
  segNorm: string;
  name: string;
  samples: string[];
  outages: number;
  firstStart: string;
  municipality: string;
  candidates: Candidate[];
}

export interface SpotCheckItem {
  segNorm: string;
  rawSample: string;
  streetId: number;
  streetName: string;
  minScore: number;
  rowIds: number[];
  outages: number;
}

export interface ReducedRun {
  runId: number;
  city: string;
  url: string;
  pageDate: string;
  rows: number;
  previousRows: number | null;
  fetchedAt: string;
}

// The name part of a stored segment (the alias key), or null for villages and non-names.
export function segmentKey(rawSegment: string): { name: string; norm: string } | null {
  const seg = splitUlice(rawSegment)[0];
  if (!seg || seg.village) return null;
  const norm = normalizeName(seg.name);
  return /[a-z]/.test(norm) ? { name: seg.name, norm } : null;
}

type Row = Record<string, unknown>;

// Drops the working set of outage ids from a grouped item.
function withoutIds<T extends { outageIds: Set<number> }>(g: T): Omit<T, 'outageIds'> {
  const { outageIds, ...rest } = g;
  void outageIds;
  return rest;
}

export async function unresolvedQueue(db: Db, now: Date): Promise<UnresolvedItem[]> {
  const rows = (
    await db.execute(sql`
      SELECT os.raw_segment, os.candidates, o.id AS outage_id, o.municipality, o.starts_at
      FROM outage_street os JOIN outage o ON o.id = os.outage_id
      WHERE os.resolved_by = 'unresolved' AND os.street_id IS NULL AND os.settlement_id IS NULL
        AND o.in_scope AND o.status IN ('active', 'changed') AND o.ends_at > ${now.toISOString()}::timestamptz
      ORDER BY o.starts_at LIMIT 1000`)
  ).rows as Row[];
  const dismissed = new Set(
    (
      await db.execute(
        sql`SELECT DISTINCT seg_norm FROM segment_review WHERE kind = 'unresolved' AND decision = 'dismissed'`,
      )
    ).rows.map((r) => String(r.seg_norm)),
  );
  const groups = new Map<string, UnresolvedItem & { outageIds: Set<number> }>();
  for (const r of rows) {
    const key = segmentKey(String(r.raw_segment));
    if (!key || dismissed.has(key.norm)) continue;
    let g = groups.get(key.norm);
    if (!g) {
      g = {
        segNorm: key.norm,
        name: key.name,
        samples: [],
        outages: 0,
        firstStart: new Date(String(r.starts_at)).toISOString(),
        municipality: String(r.municipality),
        candidates: [],
        outageIds: new Set(),
      };
      groups.set(key.norm, g);
    }
    g.outageIds.add(Number(r.outage_id));
    g.outages = g.outageIds.size;
    const raw = String(r.raw_segment);
    if (g.samples.length < 3 && !g.samples.includes(raw)) g.samples.push(raw);
    if (!g.candidates.length && Array.isArray(r.candidates)) {
      g.candidates = (r.candidates as Candidate[]).slice(0, 5);
    }
  }
  return [...groups.values()].map((g) => withoutIds(g));
}

export async function spotCheckList(db: Db, now: Date, limit = 50): Promise<SpotCheckItem[]> {
  const rows = (
    await db.execute(sql`
      SELECT os.id, os.raw_segment, os.street_id, os.score, o.id AS outage_id, s.name_cyrillic
      FROM outage_street os
        JOIN outage o ON o.id = os.outage_id
        JOIN street s ON s.id = os.street_id
      WHERE os.resolved_by = 'scored' AND o.in_scope AND o.ends_at > ${now.toISOString()}::timestamptz
        AND NOT EXISTS (
          SELECT 1 FROM segment_review r WHERE r.outage_street_id = os.id AND r.kind = 'spot_check')
      ORDER BY o.starts_at LIMIT 1000`)
  ).rows as Row[];
  const groups = new Map<string, SpotCheckItem & { outageIds: Set<number> }>();
  for (const r of rows) {
    const key = segmentKey(String(r.raw_segment));
    if (!key) continue;
    const k = `${key.norm}|${r.street_id}`;
    let g = groups.get(k);
    if (!g) {
      g = {
        segNorm: key.norm,
        rawSample: String(r.raw_segment),
        streetId: Number(r.street_id),
        streetName: String(r.name_cyrillic),
        minScore: Number(r.score),
        rowIds: [],
        outages: 0,
        outageIds: new Set(),
      };
      groups.set(k, g);
    }
    g.rowIds.push(Number(r.id));
    g.outageIds.add(Number(r.outage_id));
    g.outages = g.outageIds.size;
    g.minScore = Math.min(g.minScore, Number(r.score));
  }
  return [...groups.values()].slice(0, limit).map((g) => withoutIds(g));
}

// Confirms that a segment name means a street: pins it as an alias, re-resolves the unresolved
// segments with that name and rebuilds the in-memory gazetteer. The planner then notifies the
// people the newly resolved streets concern.
export async function confirmAlias(
  db: Db,
  gazetteers: GazetteerService,
  input: { segNorm: string; streetId: number; raw?: string },
): Promise<{ resolved: number } | null> {
  const st = (await db.execute(sql`SELECT city FROM street WHERE id = ${input.streetId}`))
    .rows[0] as Row | undefined;
  if (!st) return null;
  const resolved = await db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO street_alias (street_id, raw, raw_norm, confidence, source, reviewed_at, rejected)
      VALUES (${input.streetId}, ${input.raw ?? input.segNorm}, ${input.segNorm}, 1, 'manual', now(), false)
      ON CONFLICT (raw_norm) DO UPDATE
        SET street_id = EXCLUDED.street_id, confidence = 1, source = 'manual',
            reviewed_at = now(), rejected = false`);
    const open = (
      await tx.execute(sql`
        SELECT id, raw_segment FROM outage_street
        WHERE resolved_by = 'unresolved' AND street_id IS NULL AND settlement_id IS NULL`)
    ).rows as Row[];
    const ids = open
      .filter((r) => segmentKey(String(r.raw_segment))?.norm === input.segNorm)
      .map((r) => Number(r.id));
    if (ids.length) {
      const json = JSON.stringify(ids);
      await tx.execute(sql`
        UPDATE outage_street SET street_id = ${input.streetId}, resolved_by = 'manual', score = 1,
               candidates = NULL
        WHERE id IN (SELECT jsonb_array_elements_text(${json}::jsonb)::int)`);
      await tx.execute(sql`
        INSERT INTO segment_review (outage_street_id, seg_norm, kind, decision, street_id)
        SELECT jsonb_array_elements_text(${json}::jsonb)::int, ${input.segNorm},
               'unresolved', 'confirmed', ${input.streetId}`);
    }
    return ids.length;
  });
  gazetteers.invalidate(String(st.city));
  return { resolved };
}

// "This is not a street" (a note, a typo nobody can place): hidden from the queue from now on.
export async function dismissSegment(db: Db, segNorm: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO segment_review (seg_norm, kind, decision) VALUES (${segNorm}, 'unresolved', 'dismissed')`);
}

// Spot check of auto-accepted (scored) matches: "confirmed" keeps them, "rejected" sends the
// segments back to unresolved (candidates are kept) so they show up in the queue.
export async function reviewSpotCheck(
  db: Db,
  input: { rowIds: number[]; decision: 'confirmed' | 'rejected' },
): Promise<number> {
  if (!input.rowIds.length) return 0;
  const json = JSON.stringify(input.rowIds);
  return db.transaction(async (tx) => {
    const rows = (
      await tx.execute(sql`
        SELECT id, raw_segment, street_id FROM outage_street
        WHERE resolved_by = 'scored'
          AND id IN (SELECT jsonb_array_elements_text(${json}::jsonb)::int)`)
    ).rows as Row[];
    if (!rows.length) return 0;
    for (const r of rows) {
      await tx.execute(sql`
        INSERT INTO segment_review (outage_street_id, seg_norm, kind, decision, street_id)
        VALUES (${Number(r.id)}, ${segmentKey(String(r.raw_segment))?.norm ?? ''}, 'spot_check',
                ${input.decision}, ${Number(r.street_id)})`);
    }
    if (input.decision === 'rejected') {
      const ids = JSON.stringify(rows.map((r) => Number(r.id)));
      await tx.execute(sql`
        UPDATE outage_street SET street_id = NULL, resolved_by = 'unresolved', score = NULL
        WHERE id IN (SELECT jsonb_array_elements_text(${ids}::jsonb)::int)`);
    }
    return rows.length;
  });
}

// Reduced pages still waiting for an admin decision (the latest fetch of their date).
export async function reducedRuns(db: Db): Promise<ReducedRun[]> {
  const rows = (
    await db.execute(sql`
      SELECT r.id, r.city, r.url, r.page_date::text AS d, r.rows_found, r.started_at,
        (SELECT p.rows_found FROM scrape_run p
          WHERE p.city = r.city AND p.page_date = r.page_date AND p.id < r.id
            AND p.health IN ('ok', 'confirmed_reduced') ORDER BY p.id DESC LIMIT 1) AS prev
      FROM scrape_run r
      WHERE r.health = 'reduced'
        AND NOT EXISTS (
          SELECT 1 FROM scrape_run n
          WHERE n.city = r.city AND n.page_date = r.page_date AND n.id > r.id
            AND n.health IN ('ok', 'confirmed_reduced', 'reduced'))
      ORDER BY r.id DESC LIMIT 50`)
  ).rows as Row[];
  return rows.map((r) => ({
    runId: Number(r.id),
    city: String(r.city),
    url: String(r.url),
    pageDate: String(r.d),
    rows: Number(r.rows_found),
    previousRows: r.prev === null ? null : Number(r.prev),
    fetchedAt: new Date(String(r.started_at)).toISOString(),
  }));
}

export async function recentReports(db: Db, limit = 100) {
  const rows = (
    await db.execute(sql`
      SELECT r.id, r.message, r.created_at, r.outage_id, o.municipality, o.outage_date::text AS d,
             o.raw_streets
      FROM report r LEFT JOIN outage o ON o.id = r.outage_id
      ORDER BY r.id DESC LIMIT ${limit}`)
  ).rows as Row[];
  return rows.map((r) => ({
    id: Number(r.id),
    message: String(r.message),
    createdAt: new Date(String(r.created_at)).toISOString(),
    outageId: r.outage_id === null ? null : Number(r.outage_id),
    municipality: r.municipality === null ? null : String(r.municipality),
    date: r.d === null ? null : String(r.d),
    rawStreets: r.raw_streets === null ? null : String(r.raw_streets),
  }));
}

export async function healthSummary(db: Db, now: Date) {
  const iso = now.toISOString();
  const one = async (q: ReturnType<typeof sql>) => Number((await db.execute(q)).rows[0]?.n ?? 0);
  const runs = (
    await db.execute(sql`
      SELECT DISTINCT ON (city, url) city, url, started_at, http_status, rows_found,
             page_date::text AS d, health, error
      FROM scrape_run ORDER BY city, url, id DESC`)
  ).rows as Row[];
  const alerts = (
    await db.execute(sql`
      SELECT id, kind, message, created_at FROM alert WHERE resolved_at IS NULL ORDER BY id DESC LIMIT 50`)
  ).rows as Row[];
  const delivery = (
    await db.execute(sql`
      SELECT status, count(*)::int AS n FROM notification_log
      WHERE created_at > ${iso}::timestamptz - interval '24 hours' GROUP BY status`)
  ).rows as Row[];
  const segs = (
    await db.execute(sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE os.resolved_by = 'unresolved')::int AS unresolved
      FROM outage_street os JOIN outage o ON o.id = os.outage_id
      WHERE o.in_scope AND o.status IN ('active', 'changed') AND o.ends_at > ${iso}::timestamptz`)
  ).rows[0] as Row;
  const review = (
    await db.execute(sql`
      SELECT count(*) FILTER (WHERE decision = 'rejected')::int AS rejected, count(*)::int AS total
      FROM segment_review WHERE kind = 'spot_check' AND decided_at > ${iso}::timestamptz - interval '30 days'`)
  ).rows[0] as Row;
  return {
    now: iso,
    scrapes: runs.map((r) => ({
      city: String(r.city),
      url: String(r.url),
      startedAt: new Date(String(r.started_at)).toISOString(),
      httpStatus: r.http_status === null ? null : Number(r.http_status),
      rows: r.rows_found === null ? null : Number(r.rows_found),
      pageDate: r.d === null ? null : String(r.d),
      health: r.health === null ? null : String(r.health),
      error: r.error === null ? null : String(r.error),
    })),
    alerts: alerts.map((a) => ({
      id: Number(a.id),
      kind: String(a.kind),
      message: String(a.message),
      createdAt: new Date(String(a.created_at)).toISOString(),
    })),
    upcomingOutages: await one(
      sql`SELECT count(*)::int AS n FROM outage WHERE in_scope AND status IN ('active','changed') AND ends_at > ${iso}::timestamptz`,
    ),
    segments: { total: Number(segs.total), unresolved: Number(segs.unresolved) },
    resolutionRate: Number(segs.total) ? 1 - Number(segs.unresolved) / Number(segs.total) : null,
    spotChecks30d: { total: Number(review.total), rejected: Number(review.rejected) },
    delivery24h: Object.fromEntries(delivery.map((d) => [String(d.status), Number(d.n)])),
    devices: await one(sql`SELECT count(*)::int AS n FROM device`),
    subscriptions: await one(sql`SELECT count(*)::int AS n FROM subscription`),
  };
}
