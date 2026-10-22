import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { outage } from '../db/schema.ts';
import { matchedSubscribers } from '../notify/plan.ts';

// The "outage active" surface (BRIEF §4 Jobs): at `starts_at` each affected device is told the
// outage has begun (Android: a data push the app turns into the Live Update notification; iOS:
// Live Activity push-to-start, [MAC]) and at `ends_at` that it is over. The real delivery is
// Phase 4; the server side is this sink interface, driven by a once-a-minute tick.
export interface BoundaryRecipient {
  subscriptionId: number;
  deviceId: string;
  pushToken: string;
  platform: 'android' | 'ios';
  possible: boolean;
}

export interface BoundarySignal {
  outageId: number;
  startsAt: Date;
  endsAt: Date;
  recipients: BoundaryRecipient[];
}

export interface BoundarySink {
  started(signal: BoundarySignal): Promise<void>;
  ended(signal: BoundarySignal): Promise<void>;
}

export class FakeBoundarySink implements BoundarySink {
  readonly started_: BoundarySignal[] = [];
  readonly ended_: BoundarySignal[] = [];
  async started(s: BoundarySignal) {
    this.started_.push(s);
  }
  async ended(s: BoundarySignal) {
    this.ended_.push(s);
  }
}

// A start or end older than this when the tick finally sees it (a long outage of the job runner) is
// stale news: it is not signalled.
export const SIGNAL_WINDOW_MS = 30 * 60_000;

export interface BoundaryResult {
  started: number;
  ended: number;
}

/**
 * One tick. Each outage is signalled once per boundary: the row is claimed (`*_signalled_at`)
 * before the sink is called, so a repeated tick or a second worker does nothing, and a sink
 * failure releases the claim so the next tick retries.
 */
export async function boundaryTick(db: Db, sink: BoundarySink, now: Date): Promise<BoundaryResult> {
  const result: BoundaryResult = { started: 0, ended: 0 };
  const since = new Date(now.getTime() - SIGNAL_WINDOW_MS).toISOString();
  const nowIso = now.toISOString();

  for (const kind of ['start', 'end'] as const) {
    const column = kind === 'start' ? outage.startsAt : outage.endsAt;
    const signalled = kind === 'start' ? outage.startSignalledAt : outage.endSignalledAt;
    const due = await db
      .select({ id: outage.id })
      .from(outage)
      .where(
        and(
          eq(outage.inScope, true),
          inArray(outage.status, ['active', 'changed']),
          isNull(signalled),
          sql`${column} <= ${nowIso}::timestamptz AND ${column} > ${since}::timestamptz`,
          // an end is only worth signalling for an outage whose start was signalled
          ...(kind === 'end' ? [sql`${outage.startSignalledAt} IS NOT NULL`] : []),
        ),
      );
    for (const { id } of due) {
      const claimed = await db
        .update(outage)
        .set(kind === 'start' ? { startSignalledAt: now } : { endSignalledAt: now })
        .where(and(eq(outage.id, id), isNull(signalled)))
        .returning({ id: outage.id, startsAt: outage.startsAt, endsAt: outage.endsAt });
      const o = claimed[0];
      if (!o) continue; // someone else got it
      try {
        const recipients = (await matchedSubscribers(db, id)).map(({ sub, match }) => ({
          subscriptionId: sub.id,
          deviceId: sub.deviceId,
          pushToken: sub.pushToken,
          platform: sub.platform,
          possible: match.kind === 'possible',
        }));
        const signal = { outageId: id, startsAt: o.startsAt, endsAt: o.endsAt, recipients };
        if (kind === 'start') await sink.started(signal);
        else await sink.ended(signal);
        result[kind === 'start' ? 'started' : 'ended']++;
      } catch (e) {
        // release the claim: the next tick tries again
        await db
          .update(outage)
          .set(kind === 'start' ? { startSignalledAt: null } : { endSignalledAt: null })
          .where(eq(outage.id, id));
        throw e;
      }
    }
  }
  return result;
}
