import { sql } from 'drizzle-orm';
import { device, subscription } from '../../src/db/schema.ts';
import { importGazetteer } from '../../src/gazetteer/import.ts';
import { loadGazetteer, type LoadedGazetteer } from '../../src/gazetteer/load.ts';
import { readNisSnapshots } from '../../src/gazetteer/osm-files.ts';
import { ingestPage, type IngestResult } from '../../src/ingest/ingest.ts';
import { deliverPending } from '../../src/notify/deliver.ts';
import { planNotifications } from '../../src/notify/plan.ts';
import { FakePushProvider } from '../../src/notify/provider.ts';
import { startTestDb, type TestDb } from './db.ts';

// A database with the real Niš gazetteer, a fake push provider and the helpers the end-to-end
// tests share. Winter time (UTC+1) applies to every date after 25 Oct 2026.
export function edsPage(date: string, rows: [string, string, string][]): Uint8Array {
  const body = rows
    .map(
      ([op, time, ulice]) => `<TR><TD>Ниш</TD><TD>${op}</TD><TD>${time}</TD><TD>${ulice}</TD></TR>`,
    )
    .join('');
  return new TextEncoder().encode(
    `<HTML><BODY><TABLE><TR><TD><B>НИШ - Планирана искључења за датум: ${date}</B></TD></TR></TABLE>` +
      `<TABLE><tr><td>Огранак</td><td>Општина</td><td>Време</td><td>Улице</td></tr>${body}</TABLE></BODY></HTML>`,
  );
}

// '12.11.2026.' -> '2026-11-12'
export const isoOf = (d: string) => {
  const [day, month, year] = d.split('.');
  return `${year}-${month}-${day}`;
};

export interface World {
  t: TestDb;
  gaz: LoadedGazetteer;
  provider: FakePushProvider;
  now: Date;
  sid: (nameNorm: string) => number;
  addSub: (o: {
    norm: string;
    house?: number | null;
    script?: 'latn' | 'cyrl';
    locale?: 'sr' | 'en';
    kinds?: string[];
  }) => Promise<{ token: string; deviceId: string; subId: number }>;
  page: (date: string, rows: [string, string, string][], now?: Date) => Promise<IngestResult>;
  ingestRaw: (url: string, bytes: Uint8Array, now?: Date) => Promise<IngestResult>;
  plan: (now?: Date) => ReturnType<typeof planNotifications>;
  deliver: (now?: Date) => ReturnType<typeof deliverPending>;
  titles: (token: string, date?: string | null) => string[];
  kinds: (subId: number, date?: string | null) => Promise<string[]>;
  stop: () => Promise<void>;
}

export async function createWorld(now = new Date('2026-11-02T10:00:00Z')): Promise<World> {
  const t = await startTestDb();
  const src = readNisSnapshots(
    new URL('../../../../fixtures/osm', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  );
  await importGazetteer(t.db, { city: 'Nis', gazetteer: src.gazetteer });
  const gaz = await loadGazetteer(t.db, 'Nis');
  const provider = new FakePushProvider();
  let seq = 0;
  // Assertions look at the scenario's own date: a subscriber created later is (correctly) also told
  // about other upcoming outages on the same street.
  let lastDate: string | null = null;

  const w: World = {
    t,
    gaz,
    provider,
    now,
    sid: (norm) => gaz.streets.find((s) => s.nameNorm === norm)?.id as number,
    async addSub(o) {
      const token = `ExponentPushToken[w${++seq}]`;
      const [d] = await t.db
        .insert(device)
        .values({
          pushToken: token,
          deviceSecretHash: 'x',
          platform: 'android',
          script: o.script ?? 'latn',
          locale: o.locale ?? 'sr',
          ...(o.kinds ? { enabledKinds: o.kinds } : {}),
        })
        .returning();
      const [s] = await t.db
        .insert(subscription)
        .values({
          deviceId: d!.id,
          streetId: w.sid(o.norm),
          houseNumber: o.house ?? null,
          isPrimary: true,
        })
        .returning();
      return { token, deviceId: d!.id, subId: s!.id };
    },
    page(date, rows, at = now) {
      lastDate = isoOf(date);
      return ingestPage(t.db, gaz, {
        city: 'Nis',
        url: `https://example.test/${date}`,
        bytes: edsPage(date, rows),
        now: at,
      });
    },
    ingestRaw: (url, bytes, at = now) =>
      ingestPage(t.db, gaz, { city: 'Nis', url, bytes, now: at }),
    plan: (at = now) => planNotifications(t.db, at),
    deliver: (at = now) => deliverPending(t.db, provider, at),
    titles: (token, date = lastDate) =>
      provider.sent
        .filter(
          (m) => m.to === token && (date === null || String(m.data.startsAt).startsWith(date)),
        )
        .map((m) => m.title),
    async kinds(subId, date = lastDate) {
      const res =
        date === null
          ? await t.db.execute(
              sql`SELECT kind, status, revision FROM notification_log WHERE subscription_id = ${subId} ORDER BY id`,
            )
          : await t.db.execute(sql`
              SELECT nl.kind, nl.status, nl.revision FROM notification_log nl JOIN outage o ON o.id = nl.outage_id
              WHERE nl.subscription_id = ${subId} AND o.outage_date = ${date}::date ORDER BY nl.id`);
      return res.rows.map((r) => `${r.kind}:${r.status}:${r.revision}`);
    },
    stop: () => t.stop(),
  };
  return w;
}
