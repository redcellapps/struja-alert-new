import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { PossibleReason } from '@struja/shared';
import type { Db } from '../db/client.ts';
import { notificationLog, outage, outageStreet } from '../db/schema.ts';
import { matchSubscription, type OutageStreetRow, type SubscriptionTarget } from './match.ts';

// What is on screen for a saved address. When a person adds an address they are not pushed the
// outages that are already published: the app shows them right away (the /v1 response returns
// them) and they are recorded in notification_log as `in_app` ("told in the app"). That keeps the
// rule "what a person was last told matches what EDS shows" true, so a later "Izmena" or "Otkazano"
// still reaches them and the 19:15 reminder still goes out.
export interface AddressOutage {
  id: number;
  status: 'active' | 'changed' | 'cancelled';
  startsAt: Date;
  endsAt: Date;
  outageDate: string;
  municipality: string;
  revision: number;
  match: 'affected' | 'possible';
  reason: PossibleReason | null;
}

export type Range = 'published' | 'upcoming' | 'history';

const toRow = (r: typeof outageStreet.$inferSelect): OutageStreetRow => ({
  segmentIndex: r.segmentIndex,
  streetId: r.streetId,
  settlementId: r.settlementId,
  partial: r.partial,
  houseFrom: r.houseFrom,
  houseTo: r.houseTo,
  houseRaw: r.houseRaw,
  parity: r.parity,
  resolvedBy: r.resolvedBy,
  candidates: (r.candidates as OutageStreetRow['candidates']) ?? null,
});

/**
 * Outages that concern an address.
 *  - `published`: active or changed, not over: what exists to be shown when an address is added;
 *  - `upcoming`: published plus cancelled (not replaced) ones, so the app can show them struck out;
 *  - `history`: already over, newest first.
 */
export async function outagesForAddress(
  db: Pick<Db, 'select'>,
  target: SubscriptionTarget,
  range: Range,
  now: Date,
  limit = 200,
): Promise<AddressOutage[]> {
  const key =
    target.streetId !== null
      ? // the street itself, or an ambiguous name that lists this street among its candidates
        or(
          eq(outageStreet.streetId, target.streetId),
          and(
            eq(outageStreet.resolvedBy, 'ambiguous'),
            sql`${outageStreet.candidates} @> ${JSON.stringify([{ id: target.streetId }])}::jsonb`,
          ),
        )
      : target.settlementId !== null
        ? eq(outageStreet.settlementId, target.settlementId)
        : null;
  if (!key) return [];
  const nowIso = now.toISOString();
  const notReplaced = sql`${outage.supersededByOutageId} IS NULL AND ${outage.changeGroupId} IS NULL`;
  const time =
    range === 'history'
      ? sql`${outage.endsAt} <= ${nowIso}::timestamptz`
      : sql`${outage.endsAt} > ${nowIso}::timestamptz`;
  const status = range === 'published' ? inArray(outage.status, ['active', 'changed']) : sql`true`;

  const found = await db
    .select({ o: outage, os: outageStreet })
    .from(outageStreet)
    .innerJoin(outage, eq(outage.id, outageStreet.outageId))
    .where(and(key, eq(outage.inScope, true), time, status, notReplaced))
    .orderBy(range === 'history' ? sql`${outage.startsAt} DESC` : sql`${outage.startsAt} ASC`);

  const byOutage = new Map<number, { o: typeof outage.$inferSelect; rows: OutageStreetRow[] }>();
  for (const { o, os } of found) {
    const e = byOutage.get(o.id) ?? { o, rows: [] };
    e.rows.push(toRow(os));
    byOutage.set(o.id, e);
  }
  const out: AddressOutage[] = [];
  for (const { o, rows } of byOutage.values()) {
    const m = matchSubscription(target, rows);
    if (!m) continue;
    out.push({
      id: o.id,
      status: o.status,
      startsAt: o.startsAt,
      endsAt: o.endsAt,
      outageDate: o.outageDate,
      municipality: o.municipality,
      revision: o.revision,
      match: m.kind,
      reason: m.kind === 'possible' ? m.reason : null,
    });
  }
  return out.slice(0, limit);
}

/**
 * Records outages as told in the app (status `in_app`, kind `new`, revision 0). Outages the
 * subscription already has a record for are left alone. Returns how many were recorded.
 */
export async function recordInApp(
  db: Pick<Db, 'insert'>,
  subscriptionId: number,
  outages: readonly { id: number }[],
): Promise<number> {
  let recorded = 0;
  for (const o of outages) {
    const r = await db
      .insert(notificationLog)
      .values({
        subscriptionId,
        outageId: o.id,
        kind: 'new',
        revision: 0,
        status: 'in_app',
        sentAt: new Date(),
      })
      .onConflictDoNothing({
        target: [
          notificationLog.subscriptionId,
          notificationLog.outageId,
          notificationLog.kind,
          notificationLog.revision,
        ],
      })
      .returning({ id: notificationLog.id });
    recorded += r.length;
  }
  return recorded;
}
