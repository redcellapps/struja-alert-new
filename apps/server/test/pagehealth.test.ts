import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { confirmReducedRun } from '../src/ingest/ingest.ts';
import { createWorld, type World } from './helpers/world.ts';

// The broken page guard: a page fetched with HTTP 200 that is truncated, has no outage table, or has
// fewer than half the rows of the previous fetch for the same date must not count towards
// "missing". It is treated as a failed fetch for cancellation purposes, and raises an alert.
let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w?.stop();
});

const REAL = new URL('../../../fixtures/eds/manual-20261022T1202Z/Nis_Dan_0.htm', import.meta.url);
const real = () => new Uint8Array(readFileSync(REAL));
const EARLY = new Date('2026-10-22T04:00:00Z'); // before every outage of the real page
const URL_DAY0 =
  'https://elektrodistribucija.rs/planirana-iskljucenja-srbija/Nis_Dan_0_Iskljucenja.htm';

const count = async (q: ReturnType<typeof sql>) => Number((await w.t.db.execute(q)).rows[0]?.n);
const openAlerts = async (kind: string) =>
  Number(
    (
      await w.t.db.execute(
        sql`SELECT count(*)::int AS n FROM alert WHERE kind = ${kind} AND resolved_at IS NULL`,
      )
    ).rows[0]?.n,
  );
const maxMissing = async () =>
  Number((await w.t.db.execute(sql`SELECT max(missing_runs)::int AS n FROM outage`)).rows[0]?.n);

describe('a truncated page (HTTP 200, cut off mid-row)', () => {
  it('stores nothing, counts nothing as missing, and raises one alert however often it repeats', async () => {
    const first = await w.ingestRaw(URL_DAY0, real(), EARLY); // the healthy baseline: 19 rows
    expect(first).toMatchObject({ health: 'ok', rows: 19, inserted: 19 });
    const before = await count(sql`SELECT count(*)::int AS n FROM outage`);

    const bytes = real();
    const cut = bytes.slice(0, Math.floor(bytes.length * 0.6)); // cut inside the table
    for (let i = 0; i < 3; i++) {
      const r = await w.ingestRaw(URL_DAY0, cut, EARLY);
      expect(r).toMatchObject({ health: 'truncated', inserted: 0, missing: 0, cancelled: 0 });
    }
    expect(await count(sql`SELECT count(*)::int AS n FROM outage`)).toBe(before);
    expect(await maxMissing()).toBe(0); // nothing was counted as missing
    expect(await openAlerts('broken_page')).toBe(1); // one open alert, not one per fetch

    const run = (
      await w.t.db.execute(
        sql`SELECT health, error FROM scrape_run WHERE health = 'truncated' LIMIT 1`,
      )
    ).rows[0];
    expect(run).toMatchObject({ health: 'truncated', error: 'page truncated' });
  });

  it('is cleared once a healthy fetch of the same page comes back', async () => {
    const r = await w.ingestRaw(URL_DAY0, real(), EARLY);
    expect(r).toMatchObject({ health: 'ok', inserted: 0, seen: 19 });
    expect(await openAlerts('broken_page')).toBe(0);
  });
});

describe('an empty-table page when the previous fetch had rows', () => {
  const date = '05.12.2026.';
  const rows: [string, string, string][] = [
    ['Пантелеј', '08:00 - 09:00', 'Студеничке'],
    ['Пантелеј', '09:00 - 10:00', 'Чегарске'],
    ['Медијана', '10:00 - 11:00', 'Космајске'],
    ['Медијана', '11:00 - 12:00', 'Требињске'],
    ['Црвени крст', '12:00 - 13:00', 'Војводе Путника'],
    ['Црвени крст', '13:00 - 14:00', 'Бранка Бјеговића'],
  ];

  it('is not counted towards cancellation and raises an alert', async () => {
    await w.page(date, rows);
    const r = await w.page(date, []); // header only: 0 rows, was 6
    expect(r).toMatchObject({ health: 'reduced', missing: 0, cancelled: 0 });
    expect(
      await count(
        sql`SELECT count(*)::int AS n FROM outage WHERE outage_date = '2026-12-05' AND missing_runs > 0`,
      ),
    ).toBe(0);
    expect(await openAlerts('broken_page')).toBe(1);
  });

  it('a second fetch that is again below half is taken as real (even with another row count)', async () => {
    const again = await w.page(date, [rows[0]!]); // 1 row, was 0 then 6: still below half of 6
    expect(again).toMatchObject({ health: 'confirmed_reduced', missing: 5, cancelled: 0 });
    const third = await w.page(date, [rows[0]!]);
    // once accepted, the reduced page is the new baseline: the next identical fetch is simply healthy
    expect(third).toMatchObject({ health: 'ok', missing: 5, cancelled: 5 });
    expect(await openAlerts('broken_page')).toBe(0); // accepted as real: the alert is closed
  });
});

describe('the boundary: "fewer than half"', () => {
  const base: [string, string, string][] = [
    ['Пантелеј', '08:00 - 09:00', 'Студеничке'],
    ['Пантелеј', '09:00 - 10:00', 'Чегарске'],
    ['Медијана', '10:00 - 11:00', 'Космајске'],
    ['Медијана', '11:00 - 12:00', 'Требињске'],
    ['Црвени крст', '12:00 - 13:00', 'Војводе Путника'],
    ['Црвени крст', '13:00 - 14:00', 'Бранка Бјеговића'],
  ];
  it('exactly half the rows is fine', async () => {
    await w.page('06.12.2026.', base);
    const r = await w.page('06.12.2026.', base.slice(0, 3));
    expect(r).toMatchObject({ health: 'ok', missing: 3 });
  });
  it('one row fewer than half is reduced', async () => {
    await w.page('07.12.2026.', base);
    const r = await w.page('07.12.2026.', base.slice(0, 2));
    expect(r).toMatchObject({ health: 'reduced', missing: 0 });
  });
  it('a first-ever fetch, or a date that really has no outages, is fine', async () => {
    expect(await w.page('08.12.2026.', [])).toMatchObject({ health: 'ok' });
    expect(await w.page('08.12.2026.', [])).toMatchObject({ health: 'ok' }); // 0 of 0 is not a drop
  });
  it('a reduced page still stores genuinely new rows but does not pair or cancel', async () => {
    await w.page('09.12.2026.', base);
    const r = await w.page('09.12.2026.', [['Нишка бања', '15:00 - 16:00', 'Бубањске долине']]);
    expect(r).toMatchObject({ health: 'reduced', inserted: 1, changed: 0, missing: 0 });
  });
});

describe('small pages follow the normal rule (baseline under 5 rows)', () => {
  it('one outage to an empty table is an ordinary cancellation after two fetches, not a broken page', async () => {
    const date = '11.12.2026.';
    await w.page(date, [['Пантелеј', '08:00 - 09:00', 'Студеничке']]);
    expect(await w.page(date, [])).toMatchObject({ health: 'ok', missing: 1, cancelled: 0 });
    expect(await w.page(date, [])).toMatchObject({ health: 'ok', missing: 1, cancelled: 1 });
  });
  it('a baseline of exactly 5 rows does count', async () => {
    const date = '12.12.2026.';
    const five: [string, string, string][] = [1, 2, 3, 4, 5].map((h) => [
      'Пантелеј',
      `0${h}:00 - 0${h}:30`,
      'Студеничке',
    ]);
    await w.page(date, five);
    expect(await w.page(date, five.slice(0, 2))).toMatchObject({ health: 'reduced' });
  });
});

describe('the admin confirms a reduced page as real', () => {
  const date = '13.12.2026.';
  const six: [string, string, string][] = [1, 2, 3, 4, 5, 6].map((h) => [
    'Пантелеј',
    `${String(h).padStart(2, '0')}:00 - ${String(h).padStart(2, '0')}:30`,
    'Студеничке',
  ]);
  it('runs the missing pass the page skipped, and a later fetch cannot be confirmed any more', async () => {
    await w.page(date, six);
    const r = await w.page(date, six.slice(0, 1));
    expect(r).toMatchObject({ health: 'reduced', missing: 0 });
    const runId = r.runId;
    expect(await confirmReducedRun(w.t.db, runId, EARLY)).toBe('confirmed');
    expect(
      await count(
        sql`SELECT count(*)::int AS n FROM outage WHERE outage_date = '2026-12-13' AND missing_runs = 1`,
      ),
    ).toBe(5);
    expect(
      await count(
        sql`SELECT count(*)::int AS n FROM alert WHERE kind = 'broken_page' AND resolved_at IS NULL AND details->>'date' = '2026-12-13'`,
      ),
    ).toBe(0);
    expect(await confirmReducedRun(w.t.db, runId, EARLY)).toBe('not_reduced'); // only once
  });
  it('a reduced run that a newer fetch already followed is left to the automatic rule', async () => {
    const d2 = '14.12.2026.';
    await w.page(d2, six);
    const r = await w.page(d2, six.slice(0, 2));
    await w.page(d2, six); // the page recovered
    expect(await confirmReducedRun(w.t.db, r.runId, EARLY)).toBe('superseded');
  });
});

describe('a page with no outage table at all', () => {
  it('is a failed fetch: nothing stored, nothing missing, alert raised', async () => {
    const before = await count(sql`SELECT count(*)::int AS n FROM outage`);
    const html = new TextEncoder().encode('<HTML><BODY><P>Servis nije dostupan</P></BODY></HTML>');
    const r = await w.ingestRaw('https://example.test/error-page', html, EARLY);
    expect(r).toMatchObject({ health: 'no_table', inserted: 0, missing: 0 });
    expect(await count(sql`SELECT count(*)::int AS n FROM outage`)).toBe(before);
    const alert = (
      await w.t.db.execute(
        sql`SELECT message FROM alert WHERE kind = 'broken_page' AND resolved_at IS NULL AND dedupe_key LIKE '%error-page%'`,
      )
    ).rows[0];
    expect(String(alert?.message)).toContain('missing the outage table');
  });
});

describe('flip-flop alert: an outage that switches version more than twice', () => {
  const date = '10.12.2026.';
  const keep: [string, string, string] = ['Палилула - Ниш', '20:00 - 21:00', 'Требињске'];
  const early: [string, string, string] = ['Пантелеј', '08:00 - 10:00', 'Студеничке'];
  const late: [string, string, string] = ['Пантелеј', '09:00 - 11:00', 'Студеничке'];

  it('two switches (A -> B -> A) raise nothing, the third (A -> B -> A -> B) raises one alert', async () => {
    await w.page(date, [early, keep]);
    await w.page(date, [late, keep]); // 1
    await w.page(date, [early, keep]); // 2
    expect(await openAlerts('flip_flop')).toBe(0);
    await w.page(date, [late, keep]); // 3
    expect(await openAlerts('flip_flop')).toBe(1);
    await w.page(date, [early, keep]); // 4: still the same alert
    expect(await openAlerts('flip_flop')).toBe(1);
  });
});

describe('the previous behaviour that must not change', () => {
  it('an ordinary cancellation (two missing fetches, enough rows remain) still works', async () => {
    const date = '11.12.2026.';
    const keep: [string, string, string][] = [
      ['Палилула - Ниш', '12:00 - 13:00', 'Требињске'],
      ['Палилула - Ниш', '13:00 - 14:00', 'Космајске'],
    ];
    await w.page(date, [['Пантелеј', '08:00 - 10:00', 'Студеничке'], ...keep]);
    expect(await w.page(date, keep)).toMatchObject({ health: 'ok', missing: 1, cancelled: 0 });
    expect(await w.page(date, keep)).toMatchObject({ health: 'ok', missing: 1, cancelled: 1 });
  });
});
