import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importGazetteer } from '../src/gazetteer/import.ts';
import { loadGazetteer, type LoadedGazetteer } from '../src/gazetteer/load.ts';
import { readNisSnapshots } from '../src/gazetteer/osm-files.ts';
import { ingestPage } from '../src/ingest/ingest.ts';
import { startTestDb, type TestDb } from './helpers/db.ts';

// Change and cancellation detection (BRIEF §4/§5), on a real database with the real gazetteer.
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
const NOW = new Date('2026-10-23T10:00:00Z'); // the page dates below are all later than this
const fetchPage = (date: string, rows: [string, string, string][], now = NOW) =>
  ingestPage(t.db, gaz, {
    city: 'Nis',
    url: `https://example.test/${date}`,
    bytes: eds(date, rows),
    now,
  });

const status = async (rawStreets: string) => {
  const r = await t.db.execute(sql`
    SELECT id, status, missing_runs, superseded_by_outage_id, change_group_id, starts_at FROM outage
    WHERE raw_streets = ${rawStreets} ORDER BY id`);
  return r.rows as {
    id: number;
    status: string;
    missing_runs: number;
    superseded_by_outage_id: number | null;
    change_group_id: number | null;
  }[];
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

describe('a changed time window', () => {
  it('is a new `changed` row that replaces the old one, which is cancelled but superseded', async () => {
    const date = '27.10.2026.';
    const street = 'делови Студеничке; (ch1)';
    await fetchPage(date, [['Пантелеј', '08:30 - 10:30', street]]);
    const first = await status(street);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ status: 'active', superseded_by_outage_id: null });

    // EDS republishes the same outage with a later window (same streets, same date).
    const r = await fetchPage(date, [['Пантелеј', '09:00 - 11:00', street]]);
    expect(r).toMatchObject({ inserted: 1, changed: 1 });
    const rows = await status(street);
    expect(rows).toHaveLength(2);
    // The OLD row is cancelled and points at its replacement; the new row is `changed`.
    expect(rows[0]).toMatchObject({ status: 'cancelled', superseded_by_outage_id: rows[1]?.id });
    expect(rows[1]).toMatchObject({ status: 'changed', superseded_by_outage_id: null });
  });

  it('does not count the superseded row as missing (no spurious cancellation)', async () => {
    const date = '27.10.2026.';
    const street = 'делови Студеничке; (ch1)';
    // Two more fetches of the new version: the old row is already superseded, the new one is seen.
    await fetchPage(date, [['Пантелеј', '09:00 - 11:00', street]]);
    await fetchPage(date, [['Пантелеј', '09:00 - 11:00', street]]);
    const rows = await status(street);
    expect(rows.map((x) => x.status)).toEqual(['cancelled', 'changed']);
    expect(rows[1]?.missing_runs).toBe(0);
  });
});

describe('two windows with the same streets on the same day are not a change', () => {
  it('keeps both rows active when both stay on the page', async () => {
    const date = '28.10.2026.';
    const street = 'делови Чегарске; (two)';
    await fetchPage(date, [
      ['Нишка бања', '08:00 - 10:00', street],
      ['Нишка бања', '14:00 - 16:00', street],
    ]);
    const r = await fetchPage(date, [
      ['Нишка бања', '08:00 - 10:00', street],
      ['Нишка бања', '14:00 - 16:00', street],
    ]);
    expect(r).toMatchObject({ inserted: 0, changed: 0, seen: 2 });
    expect((await status(street)).map((x) => x.status)).toEqual(['active', 'active']);
  });
});

describe('cancellation', () => {
  const date = '29.10.2026.';
  const street = 'делови Космајске; (cx)';
  const keep: [string, string, string] = [
    'Палилула - Ниш',
    '08:00 - 10:00',
    'делови Требињске; (keep)',
  ];

  it('needs two consecutive missing fetches, not one', async () => {
    await fetchPage(date, [['Палилула - Ниш', '09:00 - 11:00', street], keep]);
    const first = await fetchPage(date, [keep]); // the row is gone once
    expect(first).toMatchObject({ missing: 1, cancelled: 0 });
    expect(await status(street)).toMatchObject([{ status: 'active', missing_runs: 1 }]);

    const second = await fetchPage(date, [keep]); // gone twice in a row
    expect(second).toMatchObject({ missing: 1, cancelled: 1 });
    expect(await status(street)).toMatchObject([{ status: 'cancelled', missing_runs: 2 }]);
    // the row that stayed is untouched
    expect(await status('делови Требињске; (keep)')).toMatchObject([
      { status: 'active', missing_runs: 0 },
    ]);
  });

  it('is undone when the row comes back', async () => {
    await fetchPage(date, [['Палилула - Ниш', '09:00 - 11:00', street], keep]);
    expect(await status(street)).toMatchObject([{ status: 'active', missing_runs: 0 }]);
  });

  it('a single missing fetch is forgiven when the row returns', async () => {
    const d = '30.10.2026.';
    const s = 'делови Бубањске долине; (flap)';
    await fetchPage(d, [['Медијана', '08:00 - 10:00', s]]);
    await fetchPage(d, []); // missing once
    await fetchPage(d, [['Медијана', '08:00 - 10:00', s]]); // back
    await fetchPage(d, []); // missing once again: the counter restarted
    expect(await status(s)).toMatchObject([{ status: 'active', missing_runs: 1 }]);
  });

  it('does not cancel an outage that already started or is over', async () => {
    const d = '24.10.2026.';
    const s = 'делови Чегарске; (past)';
    await fetchPage(d, [['Медијана', '08:00 - 10:00', s]]);
    const later = new Date('2026-10-24T12:00:00Z'); // after the window
    await fetchPage(d, [], later);
    const r = await fetchPage(d, [], later);
    expect(r).toMatchObject({ missing: 1, cancelled: 0 });
    expect((await status(s))[0]?.status).toBe('active');
  });

  it('an unreachable or failed page counts as nothing (only successful fetches are ingested)', async () => {
    const d = '31.10.2026.';
    const s = 'делови Чегарске; (unreach)';
    await fetchPage(d, [['Медијана', '08:00 - 10:00', s]]);
    await expect(
      ingestPage(t.db, gaz, {
        city: 'Nis',
        url: 'x',
        bytes: new TextEncoder().encode('<html></html>'),
        now: NOW,
      }),
    ).rejects.toThrow();
    expect(await status(s)).toMatchObject([{ status: 'active', missing_runs: 0 }]);
  });
});

describe('only rows of the same page date are affected', () => {
  it('an empty page for one date leaves other dates alone', async () => {
    const a = 'делови Чегарске; (dateA)';
    await fetchPage('01.11.2026.', [['Медијана', '08:00 - 10:00', a]]);
    await fetchPage('02.11.2026.', []);
    await fetchPage('02.11.2026.', []);
    expect(await status(a)).toMatchObject([{ status: 'active', missing_runs: 0 }]);
  });
});

// Review rule 2: when EDS edits the street list of an outage (same municipality, date and time
// window), pair the rows so the notifier can tell added streets from removed ones.
describe('an edited street list (same time window)', () => {
  it('pairs a row that gained a street with the row it grew from', async () => {
    const date = '03.11.2026.';
    const before = 'Студеничке (se-add)';
    const after = 'Студеничке, Чегарске (se-add)';
    await fetchPage(date, [['Пантелеј', '08:00 - 10:00', before]]);
    const r = await fetchPage(date, [['Пантелеј', '08:00 - 10:00', after]]);
    expect(r).toMatchObject({ inserted: 1, changed: 1, groups: 0 });
    const [old] = await status(before);
    const [fresh] = await status(after);
    expect(old).toMatchObject({ status: 'cancelled', superseded_by_outage_id: fresh?.id });
    expect(fresh).toMatchObject({ status: 'changed' });
  });

  it('pairs a row that lost a street (the other direction)', async () => {
    const date = '04.11.2026.';
    const before = 'Студеничке, Чегарске (se-rem)';
    const after = 'Студеничке (se-rem)';
    await fetchPage(date, [['Пантелеј', '08:00 - 10:00', before]]);
    const r = await fetchPage(date, [['Пантелеј', '08:00 - 10:00', after]]);
    expect(r).toMatchObject({ inserted: 1, changed: 1, groups: 0 });
    const [old] = await status(before);
    const [fresh] = await status(after);
    expect(old).toMatchObject({ status: 'cancelled', superseded_by_outage_id: fresh?.id });
    expect(fresh).toMatchObject({ status: 'changed' });
  });

  it('a different street set at the same time is a new outage plus, in time, a cancellation', async () => {
    const date = '08.11.2026.';
    const a = 'Студеничке (se-diff)';
    const b = 'Чегарске (se-diff)';
    await fetchPage(date, [['Пантелеј', '08:00 - 10:00', a]]);
    const r = await fetchPage(date, [['Пантелеј', '08:00 - 10:00', b]]);
    expect(r).toMatchObject({ inserted: 1, changed: 0 });
    expect(await status(a)).toMatchObject([{ status: 'active', superseded_by_outage_id: null }]);
    expect(await status(b)).toMatchObject([{ status: 'active' }]);
  });
});

// Review rule 3 (known gap 1): two outages of the same identity changing in one fetch.
describe('two outages of the same identity changing in the same fetch', () => {
  it('pairs by the smallest time shift', async () => {
    const date = '05.11.2026.';
    const s = 'делови Студеничке; (g-shift)';
    await fetchPage(date, [
      ['Пантелеј', '08:00 - 10:00', s],
      ['Пантелеј', '14:00 - 16:00', s],
    ]);
    // morning moves 1h later (2h in total), afternoon 30 min later (1h in total)
    const r = await fetchPage(date, [
      ['Пантелеј', '09:00 - 11:00', s],
      ['Пантелеј', '14:30 - 16:30', s],
    ]);
    expect(r).toMatchObject({ inserted: 2, changed: 2, groups: 0 });
    const rows = await status(s);
    expect(rows).toHaveLength(4);
    const [oldM, oldA, newM, newA] = rows;
    expect(oldM).toMatchObject({ status: 'cancelled', superseded_by_outage_id: newM?.id });
    expect(oldA).toMatchObject({ status: 'cancelled', superseded_by_outage_id: newA?.id });
    expect(newM?.status).toBe('changed');
    expect(newA?.status).toBe('changed');
  });

  it('does not guess when the pairing is tied: one change group instead', async () => {
    const date = '06.11.2026.';
    const s = 'делови Студеничке; (g-tie)';
    await fetchPage(date, [
      ['Пантелеј', '08:00 - 10:00', s],
      ['Пантелеј', '10:00 - 12:00', s],
    ]);
    // one new window, equally far from both old ones
    const r = await fetchPage(date, [['Пантелеј', '09:00 - 11:00', s]]);
    expect(r).toMatchObject({ inserted: 1, changed: 1, groups: 1 });
    const rows = await status(s);
    expect(rows).toHaveLength(3);
    const groupId = rows[2]?.id;
    expect(rows[2]).toMatchObject({ status: 'changed', change_group_id: groupId });
    for (const old of rows.slice(0, 2)) {
      expect(old).toMatchObject({
        status: 'cancelled',
        change_group_id: groupId,
        superseded_by_outage_id: null,
      });
    }
  });
});

// Review rule 4 (known gap 2): EDS reverts a changed time.
describe('a replaced row that comes back (EDS reverts the change)', () => {
  it('becomes the `changed` row again and the newer one is superseded, not cancelled', async () => {
    const date = '07.11.2026.';
    const s = 'делови Студеничке; (revert)';
    await fetchPage(date, [['Пантелеј', '08:00 - 10:00', s]]);
    await fetchPage(date, [['Пантелеј', '09:00 - 11:00', s]]); // changed
    let rows = await status(s);
    const [original, newer] = rows;
    expect(original).toMatchObject({ status: 'cancelled', superseded_by_outage_id: newer?.id });

    const r = await fetchPage(date, [['Пантелеј', '08:00 - 10:00', s]]); // back to the original
    expect(r).toMatchObject({ inserted: 0, seen: 1, reverted: 1 });
    rows = await status(s);
    expect(rows[0]).toMatchObject({ status: 'changed', superseded_by_outage_id: null });
    expect(rows[1]).toMatchObject({ status: 'cancelled', superseded_by_outage_id: original?.id });
  });

  it('the newer row is never cancelled by the missing-runs rule afterwards', async () => {
    const date = '07.11.2026.';
    const s = 'делови Студеничке; (revert)';
    await fetchPage(date, [['Пантелеј', '08:00 - 10:00', s]]);
    await fetchPage(date, [['Пантелеј', '08:00 - 10:00', s]]);
    const rows = await status(s);
    expect(rows[1]).toMatchObject({ status: 'cancelled', superseded_by_outage_id: rows[0]?.id });
    expect(rows[0]).toMatchObject({ status: 'changed', missing_runs: 0 });
  });

  it('a plain cancellation that is undone is simply active again (not a revert)', async () => {
    const date = '09.11.2026.';
    const s = 'делови Студеничке; (plain)';
    const keep: [string, string, string] = [
      'Пантелеј',
      '12:00 - 13:00',
      'делови Чегарске; (keep9)',
    ];
    await fetchPage(date, [['Пантелеј', '08:00 - 10:00', s], keep]);
    await fetchPage(date, [keep]);
    await fetchPage(date, [keep]); // cancelled by the rule
    expect((await status(s))[0]?.status).toBe('cancelled');
    const r = await fetchPage(date, [['Пантелеј', '08:00 - 10:00', s], keep]);
    expect(r.reverted).toBe(0);
    expect((await status(s))[0]).toMatchObject({ status: 'active', missing_runs: 0 });
  });
});
