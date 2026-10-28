import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { belgradeLocal, cyrillicToLatin } from '@struja/parser';
import {
  renderMessage,
  type NotificationKind,
  type PossibleReason,
  type Script,
} from '@struja/shared';
import type { Db } from '../db/client.ts';
import {
  device,
  notificationLog,
  outage,
  outageStreet,
  settlement,
  street,
  subscription,
} from '../db/schema.ts';
import {
  matchSubscription,
  type MatchResult,
  type OutageStreetRow,
  type SubscriptionTarget,
} from './match.ts';
import { parseQuietHours, planDelivery } from './quiet.ts';

// Who gets which notification (BRIEF §5 and the review rules). Everything here only PLANS: each
// notification is claimed by inserting a `notification_log` row (the unique constraint on
// subscription + outage + kind is the dedupe guarantee) and delivered later by `deliverPending`.
//
// The rules:
//  1. A changed outage sends only "Izmena" to people already notified; never also a "new".
//  2. A street-list edit notifies only the difference: added streets "new", removed streets
//     "Otkazano", unchanged streets nothing.
//  3. An ambiguous change (several old/new rows that could not be paired) sends ONE "Izmena"
//     listing the new windows instead of guessing which replaced which.
//  4. A reverted change is another "Izmena" back to the original time, never a cancellation.
//  5. "Otkazano" only for an outage that is really cancelled, never for a replaced row.

interface OutageInfo {
  id: number;
  status: 'active' | 'changed' | 'cancelled';
  startsAt: Date;
  endsAt: Date;
  supersededBy: number | null;
  changeGroupId: number | null;
  revision: number;
}

export interface Sub extends SubscriptionTarget {
  id: number;
  deviceId: string;
  platform: 'android' | 'ios';
  houseSuffix: string | null;
  pushToken: string;
  locale: string;
  script: Script;
  quietHours: unknown;
  enabledKinds: string[];
}

export interface PlanResult {
  planned: number;
  suppressed: number;
  // Notifications that already existed (a repeat run).
  duplicates: number;
}

const empty = (): PlanResult => ({ planned: 0, suppressed: 0, duplicates: 0 });
const add = (a: PlanResult, b: PlanResult) => {
  a.planned += b.planned;
  a.suppressed += b.suppressed;
  a.duplicates += b.duplicates;
};

// A notification the person has (or will, once delivered) been told about: pushed, queued, or seen
// on screen when they added the address.
const TOLD_STATUSES = ['pending', 'sending', 'sent', 'in_app'];

const CHANNEL: Record<NotificationKind, string> = {
  new: 'new',
  evening_before: 'evening_before',
  changed: 'changed',
  cancelled: 'cancelled',
  // Shares the "Izmena" channel.
  reinstated: 'changed',
};

// ---------------------------------------------------------------- loading

async function outageInfo(db: Db, id: number): Promise<OutageInfo | null> {
  const r = (
    await db
      .select({
        id: outage.id,
        status: outage.status,
        startsAt: outage.startsAt,
        endsAt: outage.endsAt,
        supersededBy: outage.supersededByOutageId,
        changeGroupId: outage.changeGroupId,
        revision: outage.revision,
      })
      .from(outage)
      .where(eq(outage.id, id))
  )[0];
  return r ?? null;
}

async function segmentRows(db: Db, outageId: number): Promise<OutageStreetRow[]> {
  const rows = await db.select().from(outageStreet).where(eq(outageStreet.outageId, outageId));
  return rows.map((r) => ({
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
  }));
}

// Everyone with a saved address that could be on these rows (street, settlement, or, for the
// safety net, a candidate street of an unresolved segment).
async function candidateSubs(
  db: Db,
  rows: readonly OutageStreetRow[],
  safetyNet = false,
): Promise<Sub[]> {
  const streetIds = new Set<number>();
  const settlementIds = new Set<number>();
  for (const r of rows) {
    if (r.streetId !== null) streetIds.add(r.streetId);
    if (r.settlementId !== null) settlementIds.add(r.settlementId);
    // every street an ambiguous name may mean (always), and any candidate of an unresolved segment (safety net)
    if (safetyNet || r.resolvedBy === 'ambiguous') {
      for (const c of r.candidates ?? []) streetIds.add(Number(c.id));
    }
  }
  const conditions = [];
  if (streetIds.size) conditions.push(inArray(subscription.streetId, [...streetIds]));
  if (settlementIds.size) conditions.push(inArray(subscription.settlementId, [...settlementIds]));
  if (conditions.length === 0) return [];
  const found = await db
    .select({
      id: subscription.id,
      streetId: subscription.streetId,
      settlementId: subscription.settlementId,
      houseNumber: subscription.houseNumber,
      houseSuffix: subscription.houseSuffix,
      deviceId: subscription.deviceId,
      platform: device.platform,
      pushToken: device.pushToken,
      locale: device.locale,
      script: device.script,
      quietHours: device.quietHours,
      enabledKinds: device.enabledKinds,
    })
    .from(subscription)
    .innerJoin(device, eq(device.id, subscription.deviceId))
    .where(or(...conditions));
  return found as Sub[];
}

async function subById(db: Db, ids: number[]): Promise<Sub[]> {
  if (ids.length === 0) return [];
  const found = await db
    .select({
      id: subscription.id,
      streetId: subscription.streetId,
      settlementId: subscription.settlementId,
      houseNumber: subscription.houseNumber,
      houseSuffix: subscription.houseSuffix,
      deviceId: subscription.deviceId,
      platform: device.platform,
      pushToken: device.pushToken,
      locale: device.locale,
      script: device.script,
      quietHours: device.quietHours,
      enabledKinds: device.enabledKinds,
    })
    .from(subscription)
    .innerJoin(device, eq(device.id, subscription.deviceId))
    .where(inArray(subscription.id, ids));
  return found as Sub[];
}

// Outages this one replaced: pairs (superseded_by = this row) and, for an ambiguous change, the
// cancelled rows of its change group.
async function predecessors(db: Db, o: OutageInfo): Promise<OutageInfo[]> {
  const ids = new Set<number>();
  const pairs = await db
    .select({ id: outage.id })
    .from(outage)
    .where(eq(outage.supersededByOutageId, o.id));
  pairs.forEach((p) => ids.add(p.id));
  if (o.status === 'changed' && o.changeGroupId !== null) {
    const group = await db
      .select({ id: outage.id })
      .from(outage)
      .where(
        and(
          eq(outage.changeGroupId, o.changeGroupId),
          eq(outage.status, 'cancelled'),
          sql`${outage.id} <> ${o.id}`,
        ),
      );
    group.forEach((p) => ids.add(p.id));
  }
  const out: OutageInfo[] = [];
  for (const id of ids) {
    const info = await outageInfo(db, id);
    if (info) out.push(info);
  }
  return out;
}

// Every earlier version of an outage (not the outage itself).
async function ancestors(
  db: Db,
  o: OutageInfo,
  skip: ReadonlySet<number> = new Set(),
): Promise<Set<number>> {
  const seen = new Set<number>([o.id, ...skip]);
  const queue = [o];
  const out = new Set<number>();
  while (queue.length) {
    const cur = queue.shift() as OutageInfo;
    for (const p of await predecessors(db, cur)) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.add(p.id);
      queue.push(p);
    }
  }
  return out;
}

async function wasNotified(
  db: Db,
  subId: number,
  outageIds: ReadonlySet<number>,
): Promise<boolean> {
  if (outageIds.size === 0) return false;
  const r = await db
    .select({ id: notificationLog.id })
    .from(notificationLog)
    .where(
      and(
        eq(notificationLog.subscriptionId, subId),
        inArray(notificationLog.outageId, [...outageIds]),
        inArray(notificationLog.kind, ['new', 'changed', 'evening_before']),
        inArray(notificationLog.status, TOLD_STATUSES),
      ),
    )
    .limit(1);
  return r.length > 0;
}

async function streetNames(
  db: Db,
  subs: Sub[],
): Promise<Map<string, { latin: string; cyrillic: string }>> {
  const names = new Map<string, { latin: string; cyrillic: string }>();
  const sIds = subs.map((s) => s.streetId).filter((x): x is number => x !== null);
  const pIds = subs.map((s) => s.settlementId).filter((x): x is number => x !== null);
  if (sIds.length) {
    for (const r of await db.select().from(street).where(inArray(street.id, sIds))) {
      names.set(`s${r.id}`, {
        latin: r.nameLatin ?? cyrillicToLatin(r.nameCyrillic),
        cyrillic: r.nameCyrillic,
      });
    }
  }
  if (pIds.length) {
    for (const r of await db.select().from(settlement).where(inArray(settlement.id, pIds))) {
      names.set(`p${r.id}`, {
        latin: r.nameLatin ?? cyrillicToLatin(r.nameCyrillic),
        cyrillic: r.nameCyrillic,
      });
    }
  }
  return names;
}

// ---------------------------------------------------------------- emitting

interface Emit {
  sub: Sub;
  kind: NotificationKind;
  // The outage the notification is logged against (the dedupe key) and the window it talks about.
  outageId: number;
  window: { startsAt: Date; endsAt: Date };
  moreWindows?: { startsAt: Date; endsAt: Date }[];
  possible?: PossibleReason | null;
  // The outage revision this announces; "new" and "evening_before" are always 0.
  revision?: number;
}

async function emit(
  db: Db,
  now: Date,
  names: Map<string, { latin: string; cyrillic: string }>,
  e: Emit,
): Promise<PlanResult> {
  const r = empty();
  const quiet = parseQuietHours(e.sub.quietHours);
  const delivery = planDelivery(now, e.window.startsAt, quiet);
  const name = names.get(
    e.sub.streetId !== null ? `s${e.sub.streetId}` : `p${e.sub.settlementId}`,
  ) ?? {
    latin: '?',
    cyrillic: '?',
  };
  const houseNumber =
    e.sub.houseNumber !== null ? `${e.sub.houseNumber}${e.sub.houseSuffix ?? ''}` : '';
  const locale = e.sub.locale === 'en' ? 'en' : 'sr';
  const message = renderMessage(
    {
      kind: e.kind,
      street: name,
      houseNumber,
      window: e.window,
      moreWindows: e.moreWindows,
      // "danas" / "sutra" are relative to the day the message is actually delivered
      now: delivery.deliverAt,
      possible: e.possible ?? null,
    },
    { script: e.sub.script, locale },
  );
  // "Reinstated" follows the "Izmena" toggle.
  const toggle = e.kind === 'reinstated' ? 'changed' : e.kind;
  const suppressed = !e.sub.enabledKinds.includes(toggle);
  const inserted = await db
    .insert(notificationLog)
    .values({
      subscriptionId: e.sub.id,
      outageId: e.outageId,
      kind: e.kind,
      revision: e.revision ?? 0,
      status: suppressed ? 'suppressed' : 'pending',
      deliverAt: delivery.deliverAt,
      payload: {
        title: message.title,
        body: message.body,
        channelId: delivery.urgent ? 'hitno' : CHANNEL[e.kind],
        groupKey: `address-${e.sub.streetId ?? `p${e.sub.settlementId}`}`,
        urgent: delivery.urgent,
        data: {
          outageId: e.outageId,
          kind: e.kind,
          subscriptionId: e.sub.id,
          possible: e.possible ?? null,
          link: `strujaalert://outage/${e.outageId}`,
          startsAt: e.window.startsAt.toISOString(),
          endsAt: e.window.endsAt.toISOString(),
        },
      },
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
  if (inserted.length === 0) r.duplicates++;
  else if (suppressed) r.suppressed++;
  else r.planned++;
  return r;
}

const possibleOf = (m: MatchResult): PossibleReason | null =>
  m?.kind === 'possible' ? m.reason : null;

// ---------------------------------------------------------------- planning

/**
 * New outages and changed outages: call after an ingest (and on a schedule). Also plans the
 * "Otkazano" for cancelled outages. Idempotent: a repeat run plans nothing new.
 */
export async function planNotifications(db: Db, now: Date): Promise<PlanResult> {
  const total = empty();
  const upcoming = await db
    .select({ id: outage.id })
    .from(outage)
    .where(
      and(
        eq(outage.inScope, true),
        inArray(outage.status, ['active', 'changed']),
        sql`${outage.endsAt} > ${now.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(outage.id);

  const doneGroups = new Set<number>();
  for (const { id } of upcoming) {
    const o = await outageInfo(db, id);
    if (!o) continue;
    if (o.status === 'active') add(total, await planNew(db, now, o));
    else if (o.changeGroupId !== null) {
      if (doneGroups.has(o.changeGroupId)) continue;
      doneGroups.add(o.changeGroupId);
      add(total, await planChangedGroup(db, now, o.changeGroupId));
    } else add(total, await planChangedPair(db, now, o));
  }
  add(total, await planCancelled(db, now));
  add(total, await planReinstated(db, now));
  return total;
}

// A plain new outage: everyone it affects (or may affect) hears about it once.
async function planNew(db: Db, now: Date, o: OutageInfo): Promise<PlanResult> {
  const total = empty();
  const rows = await segmentRows(db, o.id);
  const subs = await candidateSubs(db, rows);
  const names = await streetNames(db, subs);
  for (const sub of subs) {
    const m = matchSubscription(sub, rows);
    if (!m) continue;
    add(
      total,
      await emit(db, now, names, {
        sub,
        kind: 'new',
        outageId: o.id,
        window: o,
        possible: possibleOf(m),
      }),
    );
  }
  return total;
}

// One new row that replaced one old row (a changed time and/or an edited street list).
async function planChangedPair(db: Db, now: Date, o: OutageInfo): Promise<PlanResult> {
  const total = empty();
  const olds = await predecessors(db, o);
  const oldRows = (await Promise.all(olds.map((p) => segmentRows(db, p.id)))).flat();
  const newRows = await segmentRows(db, o.id);
  const before = await ancestors(db, o);

  const subs = new Map<number, Sub>();
  for (const s of [...(await candidateSubs(db, newRows)), ...(await candidateSubs(db, oldRows))]) {
    subs.set(s.id, s);
  }
  const names = await streetNames(db, [...subs.values()]);
  const old = olds[0];
  const windowChanged =
    !old ||
    old.startsAt.getTime() !== o.startsAt.getTime() ||
    old.endsAt.getTime() !== o.endsAt.getTime();

  for (const sub of subs.values()) {
    const inNew = matchSubscription(sub, newRows);
    const inOld = matchSubscription(sub, oldRows);
    const notified = await wasNotified(db, sub.id, before);
    let kind: NotificationKind | null = null;
    let window = o as { startsAt: Date; endsAt: Date };
    let outageId = o.id;
    if (inNew && inOld) {
      // Same address on both versions: only a different time is news, and only "Izmena" (rule 1).
      if (!notified) kind = 'new';
      else if (windowChanged) kind = 'changed';
    } else if (inNew) {
      kind = 'new'; // a street was added (rule 2)
    } else if (inOld && notified && old) {
      kind = 'cancelled'; // a street was removed (rule 2)
      window = old;
      outageId = old.id;
    }
    if (!kind) continue;
    add(
      total,
      await emit(db, now, names, {
        sub,
        kind,
        outageId,
        window,
        possible: kind === 'cancelled' ? null : possibleOf(inNew),
        // "Izmena" announces this row's revision; a removed street's "Otkazano" is the old row's.
        revision: kind === 'changed' ? o.revision : kind === 'cancelled' ? (old?.revision ?? 0) : 0,
      }),
    );
  }
  return total;
}

// Several old and new rows that could not be paired without guessing: one "Izmena" per person
// listing the new windows (rule 3). Logged against the first new row of the group.
async function planChangedGroup(db: Db, now: Date, groupId: number): Promise<PlanResult> {
  const total = empty();
  const members = await db
    .select({ id: outage.id })
    .from(outage)
    .where(and(eq(outage.changeGroupId, groupId), eq(outage.inScope, true)))
    .orderBy(outage.id);
  const infos = (await Promise.all(members.map((m) => outageInfo(db, m.id)))).filter(
    (x): x is OutageInfo => x !== null,
  );
  const news = infos.filter((i) => i.status === 'changed');
  const olds = infos.filter((i) => i.status === 'cancelled');
  if (news.length === 0) return total;
  const anchor = news[0] as OutageInfo;

  const newRowsBy = new Map<number, OutageStreetRow[]>();
  for (const n of news) newRowsBy.set(n.id, await segmentRows(db, n.id));
  const oldRows = (await Promise.all(olds.map((p) => segmentRows(db, p.id)))).flat();
  const allNew = [...newRowsBy.values()].flat();
  const before = new Set<number>();
  for (const n of news)
    for (const id of await ancestors(db, n, new Set(news.map((x) => x.id)))) before.add(id);
  for (const o of olds) before.add(o.id);

  const subs = new Map<number, Sub>();
  for (const s of [...(await candidateSubs(db, allNew)), ...(await candidateSubs(db, oldRows))]) {
    subs.set(s.id, s);
  }
  const names = await streetNames(db, [...subs.values()]);

  for (const sub of subs.values()) {
    const matchedNew = news.filter((n) => matchSubscription(sub, newRowsBy.get(n.id) ?? []));
    const inOld = matchSubscription(sub, oldRows);
    const notified = await wasNotified(db, sub.id, before);
    if (matchedNew.length > 0 && inOld && notified) {
      const [first, ...rest] = matchedNew as [OutageInfo, ...OutageInfo[]];
      add(
        total,
        await emit(db, now, names, {
          sub,
          kind: 'changed',
          outageId: anchor.id,
          revision: anchor.revision,
          window: first,
          moreWindows: rest,
          possible: possibleOf(matchSubscription(sub, newRowsBy.get(first.id) ?? [])),
        }),
      );
    } else if (matchedNew.length > 0) {
      const first = matchedNew[0] as OutageInfo;
      add(
        total,
        await emit(db, now, names, {
          sub,
          kind: 'new',
          outageId: first.id,
          window: first,
          possible: possibleOf(matchSubscription(sub, newRowsBy.get(first.id) ?? [])),
        }),
      );
    } else if (inOld && notified) {
      const o = olds[0] as OutageInfo;
      add(
        total,
        await emit(db, now, names, {
          sub,
          kind: 'cancelled',
          outageId: o.id,
          window: o,
          revision: o.revision,
        }),
      );
    }
  }
  return total;
}

// A really cancelled outage (never a replaced one): "Otkazano" to everyone who was told about it.
async function planCancelled(db: Db, now: Date): Promise<PlanResult> {
  const total = empty();
  const cancelled = await db
    .select({ id: outage.id })
    .from(outage)
    .where(
      and(
        eq(outage.inScope, true),
        eq(outage.status, 'cancelled'),
        sql`${outage.supersededByOutageId} IS NULL AND ${outage.changeGroupId} IS NULL`,
        sql`${outage.endsAt} > ${now.toISOString()}::timestamptz`,
      ),
    );
  for (const { id } of cancelled) {
    const o = await outageInfo(db, id);
    if (!o) continue;
    const lineage = new Set<number>([o.id, ...(await ancestors(db, o))]);
    const notified = await db
      .selectDistinct({ subscriptionId: notificationLog.subscriptionId })
      .from(notificationLog)
      .where(
        and(
          inArray(notificationLog.outageId, [...lineage]),
          inArray(notificationLog.kind, ['new', 'changed', 'evening_before', 'reinstated']),
          inArray(notificationLog.status, TOLD_STATUSES),
        ),
      );
    const subs = await subById(
      db,
      notified.map((n) => n.subscriptionId),
    );
    const names = await streetNames(db, subs);
    for (const sub of subs) {
      add(
        total,
        await emit(db, now, names, {
          sub,
          kind: 'cancelled',
          outageId: o.id,
          window: o,
          revision: o.revision,
        }),
      );
    }
  }
  return total;
}

// An undone cancellation: an `active` outage that was cancelled and is back (its revision went
// up). Everyone who was told "Otkazano" now hears "Isključenje ipak važi", so what they were last
// told matches what EDS shows. An "Otkazano" still waiting to be delivered (quiet hours) is
// withdrawn instead: they never hear of a cancellation that no longer holds.
async function planReinstated(db: Db, now: Date): Promise<PlanResult> {
  const total = empty();
  const back = await db
    .select({ id: outage.id })
    .from(outage)
    .where(
      and(
        eq(outage.inScope, true),
        eq(outage.status, 'active'),
        sql`${outage.revision} > 0`,
        sql`${outage.endsAt} > ${now.toISOString()}::timestamptz`,
      ),
    );
  for (const { id } of back) {
    const o = await outageInfo(db, id);
    if (!o) continue;
    const cancelled = await db
      .select({
        id: notificationLog.id,
        subscriptionId: notificationLog.subscriptionId,
        status: notificationLog.status,
      })
      .from(notificationLog)
      .where(and(eq(notificationLog.outageId, o.id), eq(notificationLog.kind, 'cancelled')));
    const withdrawn = cancelled.filter((c) => c.status === 'pending');
    for (const c of withdrawn) {
      await db
        .update(notificationLog)
        .set({ status: 'suppressed', lastError: 'withdrawn: outage reinstated before delivery' })
        .where(and(eq(notificationLog.id, c.id), eq(notificationLog.status, 'pending')));
    }
    const told = cancelled.filter((c) => c.status === 'sent' || c.status === 'sending');
    const subs = await subById(
      db,
      told.map((c) => c.subscriptionId),
    );
    const names = await streetNames(db, subs);
    for (const sub of subs) {
      add(
        total,
        await emit(db, now, names, {
          sub,
          kind: 'reinstated',
          outageId: o.id,
          window: o,
          revision: o.revision,
        }),
      );
    }
  }
  return total;
}

// A "new" notice told to someone less than this long ago makes the evening-before reminder redundant.
export const EVENING_SKIP_HOURS = 2;

/**
 * The evening-before reminder (19:15 job): tomorrow's outages, to everyone they may affect, except
 * those who were told "new" for the same outage less than two hours ago.
 */
export async function planEveningBefore(db: Db, now: Date): Promise<PlanResult> {
  const total = empty();
  const tomorrow = belgradeLocal(new Date(now.getTime() + 24 * 3600_000)).date;
  const outages = await db
    .select({ id: outage.id })
    .from(outage)
    .where(
      and(
        eq(outage.inScope, true),
        inArray(outage.status, ['active', 'changed']),
        eq(outage.outageDate, tomorrow),
      ),
    );
  for (const { id } of outages) {
    const o = await outageInfo(db, id);
    if (!o) continue;
    const rows = await segmentRows(db, o.id);
    const subs = await candidateSubs(db, rows);
    const names = await streetNames(db, subs);
    for (const sub of subs) {
      const m = matchSubscription(sub, rows);
      if (!m) continue;
      if (await toldNewRecently(db, sub.id, o.id, now)) continue;
      add(
        total,
        await emit(db, now, names, {
          sub,
          kind: 'evening_before',
          outageId: o.id,
          window: o,
          possible: possibleOf(m),
        }),
      );
    }
  }
  return total;
}

// Hours before the start at which a still-unresolved segment triggers the safety net.
export const SAFETY_NET_HOURS = 12;

/**
 * The 12-hour safety net: a segment still unresolved when the outage is less than 12 hours away
 * notifies the users whose street is among its candidates with a score of 0.6 or more, labeled
 * "Moguće pogođeno". Run it regularly (e.g. hourly).
 */
export async function planSafetyNet(db: Db, now: Date): Promise<PlanResult> {
  const total = empty();
  const soon = new Date(now.getTime() + SAFETY_NET_HOURS * 3600_000);
  const outages = await db
    .select({ id: outage.id })
    .from(outage)
    .where(
      and(
        eq(outage.inScope, true),
        inArray(outage.status, ['active', 'changed']),
        sql`${outage.startsAt} > ${now.toISOString()}::timestamptz`,
        sql`${outage.startsAt} <= ${soon.toISOString()}::timestamptz`,
      ),
    );
  for (const { id } of outages) {
    const o = await outageInfo(db, id);
    if (!o) continue;
    const rows = await segmentRows(db, o.id);
    if (!rows.some((r) => r.resolvedBy === 'unresolved')) continue;
    const subs = await candidateSubs(db, rows, true);
    const names = await streetNames(db, subs);
    for (const sub of subs) {
      const m = matchSubscription(sub, rows, { safetyNet: true });
      // Only the safety-net result: resolved matches were handled by the normal flow.
      if (m?.kind !== 'possible' || m.reason !== 'unresolved') continue;
      add(
        total,
        await emit(db, now, names, {
          sub,
          kind: 'new',
          outageId: o.id,
          window: o,
          possible: 'unresolved',
        }),
      );
    }
  }
  return total;
}

/** Everyone an outage affects (or may affect), for the start/end signals and the app. */
export async function matchedSubscribers(
  db: Db,
  outageId: number,
): Promise<{ sub: Sub; match: NonNullable<MatchResult> }[]> {
  const rows = await segmentRows(db, outageId);
  const subs = await candidateSubs(db, rows);
  const out: { sub: Sub; match: NonNullable<MatchResult> }[] = [];
  for (const sub of subs) {
    const match = matchSubscription(sub, rows);
    if (match) out.push({ sub, match });
  }
  return out;
}

async function toldNewRecently(
  db: Db,
  subscriptionId: number,
  outageId: number,
  now: Date,
): Promise<boolean> {
  const since = new Date(now.getTime() - EVENING_SKIP_HOURS * 3600_000);
  const r = await db.execute(sql`
    SELECT 1 FROM notification_log
    WHERE subscription_id = ${subscriptionId} AND outage_id = ${outageId} AND kind = 'new'
      AND status IN ('pending', 'sending', 'sent')
      AND coalesce(sent_at, created_at) > ${since.toISOString()}::timestamptz
    LIMIT 1`);
  return r.rows.length > 0;
}
