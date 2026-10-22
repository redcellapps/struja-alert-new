import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { device, notificationLog, outage, outageStreet, subscription } from '../src/db/schema.ts';
import { importGazetteer } from '../src/gazetteer/import.ts';
import { loadGazetteer, type LoadedGazetteer } from '../src/gazetteer/load.ts';
import { readNisSnapshots } from '../src/gazetteer/osm-files.ts';
import { ingestPage } from '../src/ingest/ingest.ts';
import {
  deliverPending,
  MAX_ATTEMPTS,
  processReceipts,
  RECEIPT_DELAY_MS,
} from '../src/notify/deliver.ts';
import { planEveningBefore, planNotifications, planSafetyNet } from '../src/notify/plan.ts';
import { FakePushProvider } from '../src/notify/provider.ts';
import { startTestDb, type TestDb } from './helpers/db.ts';

// End to end on a real database with the real gazetteer: ingest -> plan -> deliver (fake push).
// Winter time (UTC+1) applies to all dates used here (after 25 Oct 2026).
function eds(date: string, rows: [string, string, string][]): Uint8Array {
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

let t: TestDb;
let gaz: LoadedGazetteer;
const provider = new FakePushProvider();
const NOW = new Date('2026-11-02T10:00:00Z'); // 11:00 local, Monday
let seq = 0;

const sid = (norm: string) => gaz.streets.find((s) => s.nameNorm === norm)?.id as number;

async function addSub(opts: {
  norm: string;
  house?: number | null;
  script?: 'latn' | 'cyrl';
  locale?: 'sr' | 'en';
  kinds?: string[];
}) {
  const token = `ExponentPushToken[t${++seq}]`;
  const [d] = await t.db
    .insert(device)
    .values({
      pushToken: token,
      deviceSecretHash: 'x',
      platform: 'android',
      script: opts.script ?? 'latn',
      locale: opts.locale ?? 'sr',
      ...(opts.kinds ? { enabledKinds: opts.kinds } : {}),
    })
    .returning();
  const [s] = await t.db
    .insert(subscription)
    .values({
      deviceId: d!.id,
      streetId: sid(opts.norm),
      houseNumber: opts.house ?? null,
      isPrimary: true,
    })
    .returning();
  return { token, deviceId: d!.id, subId: s!.id };
}

// Each scenario uses its own outage date; assertions look only at that date's messages, because a
// subscriber created later is (correctly) also told about other upcoming outages on the same street.
let lastDate: string | null = null;
// '12.11.2026.' -> '2026-11-12'
const isoOf = (d: string) => {
  const [day, month, year] = d.split('.');
  return `${year}-${month}-${day}`;
};
const page = (date: string, rows: [string, string, string][], now = NOW) => {
  lastDate = isoOf(date);
  return ingestPage(t.db, gaz, {
    city: 'Nis',
    url: `https://example.test/${date}`,
    bytes: eds(date, rows),
    now,
  });
};
const plan = (now = NOW) => planNotifications(t.db, now);
const deliver = (now = NOW) => deliverPending(t.db, provider, now);
// `date` defaults to the scenario's date; pass null to see everything for the token.
const titles = (token: string, date: string | null = lastDate) =>
  provider.sent
    .filter((m) => m.to === token && (date === null || String(m.data.startsAt).startsWith(date)))
    .map((m) => m.title);
const kinds = async (subId: number, date: string | null = lastDate) => {
  const res =
    date === null
      ? await t.db.execute(
          sql`SELECT kind, status FROM notification_log WHERE subscription_id = ${subId} ORDER BY id`,
        )
      : await t.db.execute(sql`
          SELECT nl.kind, nl.status FROM notification_log nl JOIN outage o ON o.id = nl.outage_id
          WHERE nl.subscription_id = ${subId} AND o.outage_date = ${date}::date ORDER BY nl.id`);
  return res.rows.map((r) => `${r.kind}:${r.status}`);
};

beforeAll(async () => {
  t = await startTestDb();
  const src = readNisSnapshots(
    new URL('../../../fixtures/osm', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  );
  await importGazetteer(t.db, { city: 'Nis', gazetteer: src.gazetteer });
  gaz = await loadGazetteer(t.db, 'Nis');
});
afterAll(async () => {
  await t?.stop();
});

describe('new outages', () => {
  it('notifies the people on the street, in their script, and nobody else', async () => {
    const a = await addSub({ norm: 'studenicka' });
    const cyr = await addSub({ norm: 'studenicka', script: 'cyrl' });
    const other = await addSub({ norm: 'cegarska' });
    await page('10.11.2026.', [['Пантелеј', '08:00 - 10:00', 'Студеничке']]);
    const r = await plan();
    expect(r.planned).toBeGreaterThanOrEqual(2);
    await deliver();
    expect(titles(a.token)).toHaveLength(1);
    expect(titles(a.token)[0]).toMatch(
      /^Isključenje struje: Studenič.+, utorak 10\.11\. 08:00–10:00$/,
    );
    expect(titles(cyr.token)[0]).toMatch(
      /^Искључење струје: Студеничка, уторак 10\.11\. 08:00–10:00$/,
    );
    expect(titles(other.token)).toEqual([]);
  });

  it('is exactly once: planning and delivering again sends nothing new (the dedupe constraint)', async () => {
    const a = await addSub({ norm: 'trebinjska' });
    await page('10.11.2026.', [['Палилула - Ниш', '09:00 - 11:00', 'Требињске']]);
    await plan();
    const again = await plan();
    expect(again.planned).toBe(0);
    expect(again.duplicates).toBeGreaterThan(0);
    await deliver();
    await deliver();
    expect(titles(a.token)).toHaveLength(1);
    expect(await kinds(a.subId)).toEqual(['new:sent']);
  });

  it('house numbers decide: inside the range is notified, outside is not, no number is "possibly affected"', async () => {
    const inside = await addSub({ norm: 'cegarska', house: 31 });
    const outside = await addSub({ norm: 'cegarska', house: 10 });
    const noNumber = await addSub({ norm: 'cegarska' });
    await page('10.11.2026.', [
      ['Нишка бања', '12:00 - 14:00', 'Чегарске (непарни бр. 9-53, парни бр. 30-44)'],
    ]);
    await plan();
    await deliver();
    expect(titles(inside.token)).toHaveLength(1);
    expect(titles(inside.token)[0]).toMatch(/^Isključenje struje: Čegarska 31/);
    expect(titles(outside.token)).toEqual([]);
    expect(titles(noNumber.token)[0]).toMatch(/^Moguće pogođeno: Čegarska,/);
    const body = provider.sent.find((m) => m.to === noNumber.token)?.body;
    expect(body).toContain('Niste uneli kućni broj');
  });

  it('"делови X" without numbers is only possibly affected', async () => {
    const a = await addSub({ norm: 'kosmajska' });
    await page('10.11.2026.', [['Палилула - Ниш', '15:00 - 17:00', 'делови Космајске']]);
    await plan();
    await deliver();
    expect(titles(a.token)[0]).toMatch(/^Moguće pogođeno: Kosmajska/);
  });

  it('English and a turned-off kind: the first is localized, the second is recorded but never sent', async () => {
    const en = await addSub({ norm: 'bubanjska dolina', locale: 'en' });
    const off = await addSub({ norm: 'bubanjska dolina', kinds: ['changed', 'cancelled'] });
    await page('10.11.2026.', [['Палилула - Ниш', '18:00 - 19:00', 'Бубањске долине']]);
    await plan();
    await deliver();
    expect(titles(en.token)[0]).toMatch(
      /^Power outage: Bubanjska dolina, Tuesday 10\.11\. 18:00–19:00$/,
    );
    expect(titles(off.token)).toEqual([]);
    expect(await kinds(off.subId)).toEqual(['new:suppressed']);
  });
});

describe('rule 1: a changed outage sends only "Izmena" to people already notified', () => {
  it('"Izmena" to the notified, a plain "new" to someone who was not told before, never both', async () => {
    const date = '11.11.2026.';
    const told = await addSub({ norm: 'studenicka' });
    await page(date, [['Пантелеј', '08:00 - 10:00', 'Студеничке']]);
    await plan();
    await deliver();
    expect(titles(told.token)).toHaveLength(1);

    const late = await addSub({ norm: 'studenicka' }); // subscribed after the first notice
    await page(date, [['Пантелеј', '09:00 - 11:00', 'Студеничке']]); // the time changes
    await plan();
    await deliver();

    expect(titles(told.token)).toHaveLength(2);
    expect(titles(told.token)[1]).toMatch(/^Izmena: Studenič.+, novo vreme 09:00–11:00$/);
    expect(await kinds(told.subId)).toEqual(['new:sent', 'changed:sent']); // no second "new"
    // The late subscriber never heard of it: for them it is simply a new outage.
    expect(titles(late.token)).toHaveLength(1);
    expect(titles(late.token)[0]).toMatch(/^Isključenje struje: .+ 09:00–11:00$/);
    // and the replaced row never produced an "Otkazano"
    expect(await kinds(told.subId)).not.toContain('cancelled:sent');
  });
});

describe('rule 2: an edited street list notifies only the difference', () => {
  it('a street ADDED: only the new street hears about it; the unchanged street gets nothing', async () => {
    const date = '12.11.2026.';
    const stays = await addSub({ norm: 'studenicka' });
    const added = await addSub({ norm: 'kosmajska' });
    await page(date, [['Пантелеј', '08:00 - 10:00', 'Студеничке']]);
    await plan();
    await deliver();
    expect(titles(stays.token)).toHaveLength(1);
    expect(titles(added.token)).toEqual([]);

    await page(date, [['Пантелеј', '08:00 - 10:00', 'Студеничке, Космајске']]);
    await plan();
    await deliver();
    expect(titles(stays.token)).toHaveLength(1); // nothing new for an unchanged street
    expect(titles(added.token)).toHaveLength(1);
    expect(titles(added.token)[0]).toMatch(/^Isključenje struje: Kosmajska/);
    expect(await kinds(stays.subId)).toEqual(['new:sent']);
  });

  it('a street REMOVED: only that street gets "Otkazano"; the unchanged street gets nothing', async () => {
    const date = '13.11.2026.';
    const stays = await addSub({ norm: 'studenicka' });
    const removed = await addSub({ norm: 'trebinjska' });
    await page(date, [['Пантелеј', '08:00 - 10:00', 'Студеничке, Требињске']]);
    await plan();
    await deliver();
    expect(titles(removed.token)).toHaveLength(1);

    await page(date, [['Пантелеј', '08:00 - 10:00', 'Студеничке']]);
    await plan();
    await deliver();
    expect(titles(stays.token)).toHaveLength(1);
    expect(titles(removed.token)).toHaveLength(2);
    expect(titles(removed.token)[1]).toMatch(/^Otkazano: isključenje .+ 13\.11\., Trebinjska$/);
    expect(await kinds(removed.subId)).toEqual(['new:sent', 'cancelled:sent']);
  });
});

describe('rule 3: ambiguous changes', () => {
  it('a tie between two old rows: ONE "Izmena", not a guess', async () => {
    const date = '14.11.2026.';
    const a = await addSub({ norm: 'studenicka' });
    await page(date, [
      ['Пантелеј', '08:00 - 10:00', 'Студеничке'],
      ['Пантелеј', '10:00 - 12:00', 'Студеничке'],
    ]);
    await plan();
    await deliver();
    expect(titles(a.token)).toHaveLength(2); // told about both windows

    await page(date, [['Пантелеј', '09:00 - 11:00', 'Студеничке']]); // equally far from both
    const r = await plan();
    await deliver();
    expect(r.planned).toBeGreaterThan(0);
    expect(titles(a.token)).toHaveLength(3);
    expect(titles(a.token)[2]).toMatch(/^Izmena: Studenič.+, novo vreme 09:00–11:00$/);
    expect((await kinds(a.subId)).filter((k) => k.startsWith('changed'))).toHaveLength(1);
    expect((await kinds(a.subId)).filter((k) => k.startsWith('cancelled'))).toHaveLength(0);
  });

  it('two new windows for one old row: one "Izmena" that lists both', async () => {
    const date = '15.11.2026.';
    const a = await addSub({ norm: 'studenicka' });
    await page(date, [['Пантелеј', '08:00 - 10:00', 'Студеничке']]);
    await plan();
    await deliver();
    await page(date, [
      ['Пантелеј', '09:00 - 11:00', 'Студеничке'],
      ['Пантелеј', '07:00 - 09:00', 'Студеничке'],
    ]);
    await plan();
    await deliver();
    expect(titles(a.token)).toHaveLength(2);
    expect(titles(a.token)[1]).toMatch(
      /^Izmena: Studenič.+, nova vremena 09:00–11:00, 07:00–09:00$/,
    );
  });

  it('pairs by the smallest shift when it is clear, so each person gets their own "Izmena"', async () => {
    const date = '20.11.2026.';
    const a = await addSub({ norm: 'cegarska', house: 10 }); // even, only in the morning row
    const b = await addSub({ norm: 'cegarska', house: 11 }); // odd, only in the afternoon row
    await page(date, [
      ['Нишка бања', '08:00 - 10:00', 'Чегарске (парни бр. 2-20)'],
      ['Нишка бања', '14:00 - 16:00', 'Чегарске (непарни бр. 1-21)'],
    ]);
    await plan();
    await deliver();
    // each row changes: the morning one by 1h, the afternoon one by 30 min
    await page(date, [
      ['Нишка бања', '09:00 - 11:00', 'Чегарске (парни бр. 2-20)'],
      ['Нишка бања', '14:30 - 16:30', 'Чегарске (непарни бр. 1-21)'],
    ]);
    await plan();
    await deliver();
    expect(titles(a.token)[1]).toMatch(/novo vreme 09:00–11:00$/);
    expect(titles(b.token)[1]).toMatch(/novo vreme 14:30–16:30$/);
  });
});

describe('rule 4: EDS reverts a changed time', () => {
  it('is another "Izmena" back to the original time, never an "Otkazano"', async () => {
    const date = '16.11.2026.';
    const a = await addSub({ norm: 'studenicka' });
    await page(date, [['Пантелеј', '08:00 - 10:00', 'Студеничке']]);
    await plan();
    await deliver();
    await page(date, [['Пантелеј', '09:00 - 11:00', 'Студеничке']]);
    await plan();
    await deliver();
    await page(date, [['Пантелеј', '08:00 - 10:00', 'Студеничке']]); // back to the original
    await plan();
    await deliver();

    const t3 = titles(a.token);
    expect(t3).toHaveLength(3);
    expect(t3[1]).toMatch(/novo vreme 09:00–11:00$/);
    expect(t3[2]).toMatch(/^Izmena: Studenič.+, novo vreme 08:00–10:00$/);
    expect(await kinds(a.subId)).toEqual(['new:sent', 'changed:sent', 'changed:sent']);
    // enough fetches later, the newer row is still just superseded, never cancelled
    await page(date, [['Пантелеј', '08:00 - 10:00', 'Студеничке']]);
    await page(date, [['Пантелеј', '08:00 - 10:00', 'Студеничке']]);
    const after = await plan();
    expect(after.planned).toBe(0);
    expect((await kinds(a.subId)).some((k) => k.startsWith('cancelled'))).toBe(false);
  });
});

describe('cancellation', () => {
  it('"Otkazano" once an outage is really gone (two fetches), to those who were told', async () => {
    const date = '17.11.2026.';
    const told = await addSub({ norm: 'kosmajska' });
    const keep: [string, string, string] = ['Палилула - Ниш', '12:00 - 13:00', 'Требињске'];
    await page(date, [['Палилула - Ниш', '08:00 - 10:00', 'Космајске'], keep]);
    await plan();
    await deliver();
    await page(date, [keep]);
    await page(date, [keep]); // gone twice: cancelled
    await plan();
    await deliver();
    expect(titles(told.token)).toHaveLength(2);
    expect(titles(told.token)[1]).toMatch(/^Otkazano: isključenje .+ 17\.11\., Kosmajska$/);
    // a repeat run does not send it again
    expect((await plan()).planned).toBe(0);
  });
});

describe('quiet hours and urgency (BRIEF §5)', () => {
  it('holds a night-time notification until 07:00, then delivers it', async () => {
    const a = await addSub({ norm: 'trebinjska' });
    const night = new Date('2026-11-18T22:30:00Z'); // 23:30 local on the 18th
    await page('19.11.2026.', [['Палилула - Ниш', '09:00 - 11:00', 'Требињске']], night);
    await plan(night);
    await deliver(night);
    expect(titles(a.token, null)).toEqual([]); // quiet hours
    const row = (
      await t.db.select().from(notificationLog).where(eq(notificationLog.subscriptionId, a.subId))
    )[0];
    expect(row?.status).toBe('pending');
    expect(row?.deliverAt?.toISOString()).toBe('2026-11-19T06:00:00.000Z'); // 07:00 local
    await deliver(new Date('2026-11-19T06:01:00Z'));
    expect(titles(a.token)).toHaveLength(1);
  });

  it('an outage starting within 2 hours is delivered right away, on the urgent channel', async () => {
    const a = await addSub({ norm: 'cegarska', house: 40 });
    const night = new Date('2026-11-20T22:30:00Z'); // 23:30 local; the outage starts at 00:30
    await page('21.11.2026.', [['Нишка бања', '00:30 - 02:30', 'Чегарске']], night);
    await plan(night);
    await deliver(night);
    const msg = provider.sent.find((m) => m.to === a.token);
    expect(msg).toBeDefined();
    expect(msg?.channelId).toBe('hitno');
    expect(msg?.urgent).toBe(true);
  });

  it('uses one channel per kind otherwise, and groups by address', async () => {
    const a = await addSub({ norm: 'bubanjska dolina' });
    await page('22.11.2026.', [['Палилула - Ниш', '08:00 - 09:00', 'Бубањске долине']]);
    await plan();
    await deliver();
    const msg = provider.sent.find((m) => m.to === a.token);
    expect(msg?.channelId).toBe('new');
    expect(msg?.groupKey).toBe(`address-${sid('bubanjska dolina')}`);
    expect(msg?.data).toMatchObject({ kind: 'new' });
  });
});

describe('the evening-before reminder', () => {
  it('goes out once at 19:15 for tomorrow’s outage, even to people already told', async () => {
    const a = await addSub({ norm: 'kosmajska' });
    await page('25.11.2026.', [['Палилула - Ниш', '08:00 - 10:00', 'Космајске']]);
    await plan();
    await deliver();
    const evening = new Date('2026-11-24T18:15:00Z'); // 19:15 local the day before
    const r = await planEveningBefore(t.db, evening);
    expect(r.planned).toBeGreaterThan(0);
    await deliver(evening);
    expect(titles(a.token)).toHaveLength(2);
    expect(titles(a.token)[1]).toMatch(/^Sutra bez struje: Kosmajska, 08:00–10:00$/);
    expect((await planEveningBefore(t.db, evening)).planned).toBe(0);
  });

  it('is skipped for someone whose "new" went out less than two hours earlier', async () => {
    const a = await addSub({ norm: 'kosmajska' });
    // announced at 17:30Z: 45 minutes before the reminder
    const announced = new Date('2026-11-26T17:30:00Z');
    await page('27.11.2026.', [['Палилула - Ниш', '08:00 - 10:00', 'Космајске']], announced);
    await plan(announced);
    await deliver(announced);
    expect((await planEveningBefore(t.db, new Date('2026-11-26T18:15:00Z'))).planned).toBe(0);
    expect(titles(a.token, '2026-11-27')).toHaveLength(1);
  });

  it('is sent when the "new" went out two hours or more earlier', async () => {
    const a = await addSub({ norm: 'kosmajska' });
    const announced = new Date('2026-11-27T16:00:00Z'); // 2h15m before the 18:15Z reminder
    await page('28.11.2026.', [['Палилула - Ниш', '08:00 - 10:00', 'Космајске']], announced);
    await plan(announced);
    await deliver(announced);
    const evening = new Date('2026-11-27T18:15:00Z');
    expect((await planEveningBefore(t.db, evening)).planned).toBeGreaterThan(0);
    await deliver(evening);
    expect(titles(a.token, '2026-11-28')).toHaveLength(2);
  });
});

describe('the 12-hour safety net', () => {
  async function unresolvedOutage(date: string, startsAt: Date, score: number, streetNorm: string) {
    const [run] = await t.db
      .execute(sql`INSERT INTO scrape_run (url) VALUES ('x') RETURNING id`)
      .then((r) => r.rows);
    const [o] = await t.db
      .insert(outage)
      .values({
        sourceUrl: 'x',
        contentHash: `safety-${Math.random()}`,
        identityKey: `k-${Math.random()}`,
        city: 'Nis',
        municipality: 'Медијана',
        outageDate: date,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 2 * 3600_000),
        rawStreets: 'нешто нејасно',
        firstSeenRun: Number(run?.id),
        lastSeenRun: Number(run?.id),
      })
      .returning();
    await t.db.insert(outageStreet).values({
      outageId: o!.id,
      segmentIndex: 0,
      rawSegment: 'нешто нејасно',
      resolvedBy: 'unresolved',
      candidates: [{ id: sid(streetNorm), name: 'x', score }],
    });
    return o!;
  }

  it('notifies a user on a candidate street (score ≥ 0.6) once the outage is within 12 hours', async () => {
    const a = await addSub({ norm: 'trebinjska' });
    const now = new Date('2026-12-01T20:00:00Z');
    await unresolvedOutage('2026-12-02', new Date('2026-12-02T06:00:00Z'), 0.7, 'trebinjska'); // in 10 h
    expect((await planSafetyNet(t.db, now)).planned).toBeGreaterThan(0);
    await deliver(now);
    expect(titles(a.token, null)).toHaveLength(1);
    expect(titles(a.token, null)[0]).toMatch(/^Moguće pogođeno: Trebinjska,/);
    expect(provider.sent.find((m) => m.to === a.token)?.body).toContain(
      'nije sa sigurnošću prepoznata',
    );
    expect((await planSafetyNet(t.db, now)).planned).toBe(0); // once
  });

  it('does nothing earlier than 12 hours, or for a candidate scoring below 0.6', async () => {
    const a = await addSub({ norm: 'kosmajska' });
    const far = new Date('2026-12-05T10:00:00Z');
    await unresolvedOutage('2026-12-06', new Date('2026-12-06T08:00:00Z'), 0.9, 'kosmajska'); // in 22 h
    await planSafetyNet(t.db, far);
    const b = await addSub({ norm: 'cegarska' });
    const now = new Date('2026-12-07T20:00:00Z');
    await unresolvedOutage('2026-12-08', new Date('2026-12-08T06:00:00Z'), 0.59, 'cegarska'); // in 10 h
    await planSafetyNet(t.db, now);
    await deliver(now);
    expect(titles(a.token, null)).toEqual([]);
    expect(titles(b.token, null)).toEqual([]);
  });
});

describe('delivery', () => {
  it('retries a failing send and gives up after the maximum attempts', async () => {
    const a = await addSub({ norm: 'bubanjska dolina' });
    provider.failTokens.set(a.token, 'MessageRateExceeded');
    await page('26.11.2026.', [['Палилула - Ниш', '08:00 - 09:00', 'Бубањске долине']]);
    await plan();
    for (let i = 0; i < MAX_ATTEMPTS; i++) await deliver();
    const [row] = await t.db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.subscriptionId, a.subId));
    expect(row).toMatchObject({
      status: 'failed',
      attempts: MAX_ATTEMPTS,
      lastError: 'MessageRateExceeded',
    });
    expect(titles(a.token)).toEqual([]);
  });

  it('drops a device whose token the push service says is dead (at send time)', async () => {
    const a = await addSub({ norm: 'trebinjska' });
    provider.failTokens.set(a.token, 'DeviceNotRegistered');
    await page('27.11.2026.', [['Палилула - Ниш', '08:00 - 09:00', 'Требињске']]);
    await plan();
    const r = await deliver();
    expect(r.droppedDevices).toBeGreaterThan(0);
    expect(await t.db.select().from(device).where(eq(device.id, a.deviceId))).toEqual([]);
  });

  it('drops a device whose receipt says DeviceNotRegistered', async () => {
    const a = await addSub({ norm: 'kosmajska' });
    provider.deadTokens.add(a.token);
    await page('28.11.2026.', [['Палилула - Ниш', '08:00 - 09:00', 'Космајске']]);
    await plan();
    await deliver();
    expect(titles(a.token)).toHaveLength(1);
    const early = await processReceipts(t.db, provider, new Date(NOW.getTime() + 60_000));
    expect(early.checked).toBe(0); // too soon
    const r = await processReceipts(
      t.db,
      provider,
      new Date(NOW.getTime() + RECEIPT_DELAY_MS + 60_000),
    );
    expect(r.droppedDevices).toBeGreaterThan(0);
    expect(await t.db.select().from(device).where(eq(device.id, a.deviceId))).toEqual([]);
  });
});
