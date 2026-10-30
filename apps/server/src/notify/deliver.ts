import { and, eq, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { device, notificationLog, subscription } from '../db/schema.ts';
import type { PushMessage, PushProvider } from './provider.ts';

export interface DeliverResult {
  sent: number;
  failed: number;
  // Devices removed because the push service said the token is dead.
  droppedDevices: number;
}

export const MAX_ATTEMPTS = 3;
const BATCH = 100;
// A claimed row stuck in `sending` this long (a crash between claim and send) is released again.
const STUCK_AFTER_MS = 10 * 60_000;
// Receipts are available some time after sending; check them after this delay.
export const RECEIPT_DELAY_MS = 15 * 60_000;

interface Payload {
  title: string;
  body: string;
  channelId: string;
  groupKey: string;
  urgent: boolean;
  data: Record<string, unknown>;
}

// "DeviceNotRegistered": the app was uninstalled. Drop the device and everything attached to it.
export async function dropDevice(db: Db, deviceId: string): Promise<void> {
  await db.delete(device).where(eq(device.id, deviceId));
}

/**
 * Sends the notifications that are due: `pending`, and not held back for quiet hours. A row is
 * claimed (`sending`) before it is sent, so two workers never send the same notification.
 */
export async function deliverPending(
  db: Db,
  provider: PushProvider,
  now: Date,
): Promise<DeliverResult> {
  const result: DeliverResult = { sent: 0, failed: 0, droppedDevices: 0 };

  // Release rows a crashed worker left in `sending`.
  await db
    .update(notificationLog)
    .set({ status: 'pending' })
    .where(
      and(
        eq(notificationLog.status, 'sending'),
        lte(notificationLog.createdAt, new Date(now.getTime() - STUCK_AFTER_MS)),
      ),
    );

  for (;;) {
    const due = await db
      .select({ id: notificationLog.id })
      .from(notificationLog)
      .where(
        and(
          eq(notificationLog.status, 'pending'),
          or(isNull(notificationLog.deliverAt), lte(notificationLog.deliverAt, now)),
        ),
      )
      .orderBy(notificationLog.id)
      .limit(BATCH);
    if (due.length === 0) break;

    // Claim.
    const claimed = await db
      .update(notificationLog)
      .set({ status: 'sending' })
      .where(
        and(
          inArray(
            notificationLog.id,
            due.map((d) => d.id),
          ),
          eq(notificationLog.status, 'pending'),
        ),
      )
      .returning({
        id: notificationLog.id,
        payload: notificationLog.payload,
        attempts: notificationLog.attempts,
        subscriptionId: notificationLog.subscriptionId,
      });
    if (claimed.length === 0) break;

    const targets = await db
      .select({ subscriptionId: subscription.id, deviceId: device.id, token: device.pushToken })
      .from(subscription)
      .innerJoin(device, eq(device.id, subscription.deviceId))
      .where(
        inArray(
          subscription.id,
          claimed.map((c) => c.subscriptionId),
        ),
      );
    const target = new Map(targets.map((t) => [t.subscriptionId, t]));

    const messages: { row: (typeof claimed)[number]; msg: PushMessage; deviceId: string }[] = [];
    for (const row of claimed) {
      const t = target.get(row.subscriptionId);
      const p = row.payload as Payload | null;
      if (!t || !p) {
        // The device or subscription is gone: nothing to send to.
        await db
          .update(notificationLog)
          .set({ status: 'failed', lastError: 'no device' })
          .where(eq(notificationLog.id, row.id));
        result.failed++;
        continue;
      }
      messages.push({
        row,
        deviceId: t.deviceId,
        msg: {
          to: t.token,
          title: p.title,
          body: p.body,
          data: p.data,
          channelId: p.channelId,
          groupKey: p.groupKey,
          urgent: p.urgent,
        },
      });
    }
    if (messages.length === 0) continue;

    let tickets;
    try {
      tickets = await provider.send(messages.map((m) => m.msg));
    } catch (e) {
      // The whole send failed: release the rows for a retry.
      for (const m of messages) {
        await retryOrFail(
          db,
          m.row.id,
          m.row.attempts,
          e instanceof Error ? e.message : String(e),
          result,
        );
      }
      break;
    }

    for (const [i, m] of messages.entries()) {
      const ticket = tickets[i];
      if (ticket?.status === 'ok') {
        await db
          .update(notificationLog)
          .set({
            status: 'sent',
            sentAt: now,
            ticketId: ticket.id ?? null,
            attempts: m.row.attempts + 1,
          })
          .where(eq(notificationLog.id, m.row.id));
        result.sent++;
      } else if (ticket?.error === 'DeviceNotRegistered') {
        await dropDevice(db, m.deviceId);
        result.droppedDevices++;
      } else {
        await retryOrFail(db, m.row.id, m.row.attempts, ticket?.error ?? 'unknown error', result);
      }
    }
  }
  return result;
}

async function retryOrFail(
  db: Db,
  id: number,
  attempts: number,
  error: string,
  result: DeliverResult,
): Promise<void> {
  const next = attempts + 1;
  const failed = next >= MAX_ATTEMPTS;
  await db
    .update(notificationLog)
    .set({ status: failed ? 'failed' : 'pending', attempts: next, lastError: error })
    .where(eq(notificationLog.id, id));
  if (failed) result.failed++;
}

/**
 * Checks delivery receipts of sent notifications and drops devices whose token is dead
 * (`DeviceNotRegistered`).
 */
export async function processReceipts(
  db: Db,
  provider: PushProvider,
  now: Date,
): Promise<{ checked: number; droppedDevices: number }> {
  const out = { checked: 0, droppedDevices: 0 };
  const rows = await db
    .select({
      id: notificationLog.id,
      ticketId: notificationLog.ticketId,
      subscriptionId: notificationLog.subscriptionId,
    })
    .from(notificationLog)
    .where(
      and(
        eq(notificationLog.status, 'sent'),
        isNotNull(notificationLog.ticketId),
        isNull(notificationLog.receiptCheckedAt),
        lte(notificationLog.sentAt, new Date(now.getTime() - RECEIPT_DELAY_MS)),
      ),
    )
    .limit(1000);
  if (rows.length === 0) return out;

  const receipts = await provider.getReceipts(rows.map((r) => r.ticketId as string));
  const dead = new Set<string>();
  for (const r of rows) {
    const receipt = receipts[r.ticketId as string];
    if (!receipt) continue; // not available yet: check again later
    await db
      .update(notificationLog)
      .set({
        receiptStatus: receipt.status === 'ok' ? 'ok' : (receipt.error ?? 'error'),
        receiptCheckedAt: now,
      })
      .where(eq(notificationLog.id, r.id));
    out.checked++;
    if (receipt.error === 'DeviceNotRegistered') {
      const d = await db
        .select({ deviceId: subscription.deviceId })
        .from(subscription)
        .where(eq(subscription.id, r.subscriptionId));
      if (d[0]) dead.add(d[0].deviceId);
    }
  }
  for (const deviceId of dead) {
    await dropDevice(db, deviceId);
    out.droppedDevices++;
  }
  return out;
}

// Exposed for monitoring: how many notifications are waiting, and how many failed.
export async function outboxStats(db: Db): Promise<Record<string, number>> {
  const r = await db.execute(
    sql`SELECT status, count(*)::int AS n FROM notification_log GROUP BY status`,
  );
  return Object.fromEntries(
    (r.rows as { status: string; n: number }[]).map((x) => [x.status, x.n]),
  );
}
