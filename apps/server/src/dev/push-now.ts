// Development only: plans ONE notification for a subscription right now and nudges the running local
// server (RUN_JOBS=true) to deliver it, so a real push to the owner's phone can be tried on demand
// without waiting for a scrape or a change (docs/phase4-plan.md §5).
//
//   pnpm --filter @struja/server dev:push list
//   pnpm --filter @struja/server dev:push <new|evening_before|changed|cancelled|reinstated>
//        --subscription <id> [--outage <id>] [--urgent]
//   pnpm --filter @struja/server dev:push <started|ended> --subscription <id> [--outage <id>]
//
// `--urgent` sends on the "hitno" channel now, whatever the outage window says. `started` and
// `ended` send the outage start / end data push (step 3) from this process, through the sink the
// environment names (BOUNDARY_SINK, the same choice the server makes); the outage's own
// `*_signalled_at` claim is left alone, so the real tick is not affected.
import { eq, sql } from 'drizzle-orm';
import { loadConfig } from '../config.ts';
import { createDb } from '../db/client.ts';
import { device, settlement, street, subscription } from '../db/schema.ts';
import { JOBS } from '../jobs/handlers.ts';
import { chooseBoundarySink } from '../notify/boundary-choice.ts';
import { boundaryOnDemand, planOnDemand } from '../notify/plan.ts';
import { assertLocalDatabase } from './local-only.ts';

const KINDS = ['new', 'evening_before', 'changed', 'cancelled', 'reinstated'] as const;
type Kind = (typeof KINDS)[number];

const args = process.argv.slice(2);
const value = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const usage = (): never => {
  console.error(
    'usage: dev:push list | dev:push <new|evening_before|changed|cancelled|reinstated> --subscription <id> [--outage <id>] [--urgent] | dev:push <started|ended> --subscription <id> [--outage <id>]',
  );
  process.exit(2);
};

const url = process.env.DATABASE_URL;
assertLocalDatabase(url, 'dev:push');
if (!url) throw new Error('DATABASE_URL is not set');
const { db, pool } = createDb(url);

const command = args[0];
if (command === 'list') {
  const rows = await db
    .select({
      id: subscription.id,
      street: street.nameLatin,
      settlement: settlement.nameLatin,
      houseNumber: subscription.houseNumber,
      houseSuffix: subscription.houseSuffix,
      token: device.pushToken,
      script: device.script,
      platform: device.platform,
    })
    .from(subscription)
    .innerJoin(device, eq(device.id, subscription.deviceId))
    .leftJoin(street, eq(street.id, subscription.streetId))
    .leftJoin(settlement, eq(settlement.id, subscription.settlementId))
    .orderBy(subscription.id);
  for (const r of rows) {
    const where = r.street ?? r.settlement ?? '?';
    const house = r.houseNumber === null ? '' : ` ${r.houseNumber}${r.houseSuffix ?? ''}`;
    const token = r.token.startsWith('ExponentPushToken')
      ? `${r.token.slice(0, 22)}…]`
      : r.token.slice(0, 12);
    console.log(`${r.id}\t${where}${house}\t${r.platform} ${r.script}\t${token}`);
  }
  if (rows.length === 0) console.log('no subscriptions');
} else if (command === 'started' || command === 'ended') {
  const subscriptionId = Number(value('subscription'));
  if (!Number.isInteger(subscriptionId)) usage();
  const outageRaw = value('outage');
  const signal = await boundaryOnDemand(db, {
    subscriptionId,
    ...(outageRaw === undefined ? {} : { outageId: Number(outageRaw) }),
  });
  if (!signal) {
    console.error('nothing to signal: no such subscription, or no active outage names its street');
    await pool.end();
    process.exit(1);
  }
  const { name, sink } = chooseBoundarySink(loadConfig(), db, (m) => console.log(m));
  const r = signal.recipients[0]!;
  console.log(
    `${command}: outage ${signal.outageId} (${signal.startsAt.toISOString()} – ${signal.endsAt.toISOString()}) to subscription ${r.subscriptionId}, ${r.possible ? 'possible' : 'affected'}, sink ${name}, FCM token ${r.nativePushToken ? 'yes' : 'no'}`,
  );
  if (command === 'started') await sink.started(signal);
  else await sink.ended(signal);
  console.log(`sent at ${new Date().toISOString()}`);
} else if (command && (KINDS as readonly string[]).includes(command)) {
  const subscriptionId = Number(value('subscription'));
  if (!Number.isInteger(subscriptionId)) usage();
  const outageRaw = value('outage');
  const outageId = outageRaw === undefined ? undefined : Number(outageRaw);
  const r = await planOnDemand(db, new Date(), {
    subscriptionId,
    kind: command as Kind,
    outageId,
    urgent: args.includes('--urgent'),
  });
  if (!r) {
    console.error('nothing planned: no such subscription, or no active outage names its street');
    await pool.end();
    process.exit(1);
  }
  console.log(
    `planned notification_log #${r.id} (${command}, outage ${r.outageId}, ${r.status}) at ${new Date().toISOString()}`,
  );
  // Wake the deliver worker of the running server now instead of at its next minute.
  const { PgBoss } = await import('pg-boss');
  const boss = new PgBoss(url);
  await boss.start();
  await boss.send(JOBS.deliver, null);
  await boss.stop({ graceful: true, timeout: 5000 });
  const [row] = await db
    .execute(sql`SELECT status FROM notification_log WHERE id = ${r.id}`)
    .then((x) => x.rows as { status: string }[]);
  console.log(`deliver queued; status now: ${row?.status ?? '?'}`);
} else {
  usage();
}
await pool.end();
