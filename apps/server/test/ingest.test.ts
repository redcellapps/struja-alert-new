import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importGazetteer } from '../src/gazetteer/import.ts';
import { loadGazetteer, type LoadedGazetteer } from '../src/gazetteer/load.ts';
import { readNisSnapshots } from '../src/gazetteer/osm-files.ts';
import { contentHash, identityKey, ingestPage } from '../src/ingest/ingest.ts';
import { startTestDb, type TestDb } from './helpers/db.ts';

const ROOT = new URL('../../../', import.meta.url);
const winPath = (u: URL) => u.pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SNAPSHOT = new URL('fixtures/eds/manual-20261022T1202Z/', ROOT);
const page = (name: string) => new Uint8Array(readFileSync(new URL(name, SNAPSHOT)));
const URL_OF = (name: string) =>
  `https://elektrodistribucija.rs/planirana-iskljucenja-srbija/${name.replace('_Dan_', '_Dan_')}`;

// A minimal EDS-style page, for cases the real fixtures do not contain.
function eds(date: string, rows: [string, string, string, string][]): Uint8Array {
  const body = rows
    .map(
      ([og, op, time, ulice]) =>
        `<TR><TD>${og}</TD><TD>${op}</TD><TD>${time}</TD><TD>${ulice}</TD></TR>`,
    )
    .join('');
  return new TextEncoder().encode(
    `<HTML><BODY><TABLE><TR><TD><B>НИШ - Планирана искључења за датум: ${date}</B></TD></TR></TABLE>` +
      `<TABLE><tr><td>Огранак</td><td>Општина</td><td>Време</td><td>Улице</td></tr>${body}</TABLE></BODY></HTML>`,
  );
}

let t: TestDb;
let gaz: LoadedGazetteer;

beforeAll(async () => {
  t = await startTestDb();
  const src = readNisSnapshots(winPath(new URL('fixtures/osm', ROOT)));
  await importGazetteer(t.db, {
    city: 'Nis',
    gazetteer: src.gazetteer,
    addresses: src.addresses,
    aliases: JSON.parse(readFileSync(new URL('packages/parser/data/aliases.json', ROOT), 'utf8')),
  });
  gaz = await loadGazetteer(t.db, 'Nis');
});
afterAll(async () => {
  await t?.stop();
});

const count = async (q: ReturnType<typeof sql>) => Number((await t.db.execute(q)).rows[0]?.n);

describe('replaying the real Niš pages (22 Oct 2026)', () => {
  const results: Awaited<ReturnType<typeof ingestPage>>[] = [];

  it('stores every row; five are in scope, the rest are kept but flagged', async () => {
    for (const n of [0, 1, 2, 3]) {
      const name = `Nis_Dan_${n}.htm`;
      results.push(
        await ingestPage(t.db, gaz, { city: 'Nis', url: URL_OF(name), bytes: page(name) }),
      );
    }
    expect(results.map((r) => r.rows)).toEqual([19, 7, 0, 0]);
    expect(results.reduce((a, r) => a + r.inserted, 0)).toBe(26);
    expect(await count(sql`SELECT count(*)::int AS n FROM outage`)).toBe(26);
    expect(await count(sql`SELECT count(*)::int AS n FROM outage WHERE in_scope`)).toBe(5);
    expect(results.reduce((a, r) => a + r.skippedNoTime, 0)).toBe(0);
  });

  it('keeps the raw Ulice cell untouched and converts times to UTC', async () => {
    const r = await t.db.execute(sql`
      SELECT raw_streets, starts_at, ends_at, outage_date::text AS d FROM outage
      WHERE raw_streets = 'делови Чегарске (непарни бр. 9-53, парни бр. 30-44);'`);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.d).toBe('2026-10-22');
    expect(new Date(String(r.rows[0]?.starts_at)).toISOString()).toBe('2026-10-22T10:00:00.000Z'); // 12:00 CEST
  });

  it('resolves every in-scope segment to a real street, one row per house range', async () => {
    const r = await t.db.execute(sql`
      SELECT os.raw_segment, os.resolved_by, os.house_raw, os.parity, os.house_from, os.house_to,
             s.name_cyrillic AS street
      FROM outage_street os JOIN outage o ON o.id = os.outage_id
      LEFT JOIN street s ON s.id = os.street_id
      WHERE o.in_scope ORDER BY os.id`);
    expect(r.rows).toHaveLength(12); // 10 segments; two of them have two ranges
    for (const row of r.rows) {
      expect(row.resolved_by, String(row.raw_segment)).not.toBe('unresolved');
      expect(row.street, String(row.raw_segment)).not.toBeNull();
    }
    const cegarska = r.rows.filter((x) => x.street === 'Чегарска');
    expect(cegarska.map((x) => [x.parity, x.house_from, x.house_to])).toEqual([
      ['odd', 9, 53],
      ['even', 30, 44],
    ]);
    const matejevacki = r.rows.filter((x) => x.street === 'Матејевачки пут');
    expect(matejevacki.map((x) => x.house_raw)).toEqual(['41', 'бб']);
  });

  it('stores out-of-scope rows without matching them', async () => {
    expect(
      await count(sql`SELECT count(*)::int AS n FROM outage_street os
                      JOIN outage o ON o.id = os.outage_id WHERE NOT o.in_scope`),
    ).toBe(0);
    expect(
      await count(
        sql`SELECT count(*)::int AS n FROM outage WHERE NOT in_scope AND branch = 'Прокупље'`,
      ),
    ).toBeGreaterThan(0);
  });

  it('records each fetch as a scrape run with its row count', async () => {
    const r = await t.db.execute(
      sql`SELECT rows_found, http_status, error FROM scrape_run ORDER BY id`,
    );
    expect(r.rows.map((x) => x.rows_found)).toEqual([19, 7, 0, 0]);
    expect(r.rows.every((x) => x.error === null && x.http_status === 200)).toBe(true);
  });
});

describe('ingesting the same page again', () => {
  it('stores nothing new and refreshes last_seen_run (a repeat is not a change)', async () => {
    const before = await count(sql`SELECT count(*)::int AS n FROM outage`);
    const again = await ingestPage(t.db, gaz, {
      city: 'Nis',
      url: URL_OF('Nis_Dan_0.htm'),
      bytes: page('Nis_Dan_0.htm'),
    });
    expect(again.inserted).toBe(0);
    expect(again.seen).toBe(19);
    expect(await count(sql`SELECT count(*)::int AS n FROM outage`)).toBe(before);
    expect(
      await count(sql`SELECT count(*)::int AS n FROM outage WHERE last_seen_run = ${again.runId}`),
    ).toBe(19);
    expect(await count(sql`SELECT count(*)::int AS n FROM outage_street`)).toBe(12);
  });
});

describe('identity vs content', () => {
  const row = {
    ogranak: 'Ниш',
    opstina: 'Пантелеј',
    vreme: '08:30 - 10:30',
    ulice: 'делови Студеничке;',
    startsAt: null,
    endsAt: null,
  };
  it('a changed time keeps the identity key but is a new row', () => {
    const later = { ...row, vreme: '09:00 - 11:00' };
    expect(identityKey('Nis', '2026-10-22', later)).toBe(identityKey('Nis', '2026-10-22', row));
    expect(contentHash('Nis', '2026-10-22', later)).not.toBe(contentHash('Nis', '2026-10-22', row));
  });
  it('a different street set, date or municipality changes the identity key', () => {
    const base = identityKey('Nis', '2026-10-22', row);
    expect(identityKey('Nis', '2026-10-22', { ...row, ulice: 'делови Чегарске;' })).not.toBe(base);
    expect(identityKey('Nis', '2026-10-23', row)).not.toBe(base);
    expect(identityKey('Nis', '2026-10-22', { ...row, opstina: 'Медијана' })).not.toBe(base);
  });
  it('the order and case of streets do not matter', () => {
    const a = identityKey('Nis', 'd', { ...row, ulice: 'Студеничке, Чегарске' });
    const b = identityKey('Nis', 'd', { ...row, ulice: 'ЧЕГАРСКЕ, студеничке' });
    expect(a).toBe(b);
  });
});

describe('cases the real pages do not contain', () => {
  it('keeps an unresolved segment with no street and any candidates it found', async () => {
    const r = await ingestPage(t.db, gaz, {
      city: 'Nis',
      url: 'https://example.test/synthetic-1',
      bytes: eds('25.10.2026.', [['Ниш', 'Медијана', '08:00 - 10:00', 'Потпуно непозната улица']]),
    });
    expect(r.unresolvedSegments).toBe(1);
    const rows = await t.db.execute(sql`
      SELECT os.street_id, os.resolved_by, os.candidates FROM outage_street os
      JOIN outage o ON o.id = os.outage_id WHERE o.source_url = 'https://example.test/synthetic-1'`);
    expect(rows.rows[0]).toMatchObject({ street_id: null, resolved_by: 'unresolved' });
  });

  it('links a village segment to the settlement, not to a street', async () => {
    await ingestPage(t.db, gaz, {
      city: 'Nis',
      url: 'https://example.test/synthetic-2',
      bytes: eds('25.10.2026.', [['Ниш', 'Пантелеј', '09:00 - 11:00', 'Део села Трупале']]),
    });
    const rows = await t.db.execute(sql`
      SELECT os.street_id, os.settlement_id, os.resolved_by, os.partial, p.name_cyrillic AS name
      FROM outage_street os JOIN outage o ON o.id = os.outage_id
      JOIN settlement p ON p.id = os.settlement_id
      WHERE o.source_url = 'https://example.test/synthetic-2'`);
    expect(rows.rows[0]).toMatchObject({
      street_id: null,
      resolved_by: 'exact',
      partial: true,
      name: 'Трупале',
    });
  });

  it('skips a row without a readable time window and says so on the run', async () => {
    const r = await ingestPage(t.db, gaz, {
      city: 'Nis',
      url: 'https://example.test/synthetic-3',
      bytes: eds('25.10.2026.', [['Ниш', 'Пантелеј', 'ускоро', 'Чегарске']]),
    });
    expect(r).toMatchObject({ rows: 1, inserted: 0, skippedNoTime: 1 });
    const run = await t.db.execute(sql`SELECT error FROM scrape_run WHERE id = ${r.runId}`);
    expect(String(run.rows[0]?.error)).toContain('without a time window');
  });

  it('fails a page without a date and records the error on the run', async () => {
    await expect(
      ingestPage(t.db, gaz, {
        city: 'Nis',
        url: 'https://example.test/synthetic-4',
        bytes: new TextEncoder().encode('<html><body>nothing here</body></html>'),
      }),
    ).rejects.toThrow(/No date/);
    const run = await t.db.execute(
      sql`SELECT error FROM scrape_run WHERE url = 'https://example.test/synthetic-4'`,
    );
    expect(run.rows[0]?.error).toBe('page date not found');
  });

  it('treats other cities as out of scope', async () => {
    await ingestPage(t.db, gaz, {
      city: 'Kraljevo',
      url: 'https://example.test/synthetic-5',
      bytes: eds('25.10.2026.', [['Краљево', 'Краљево', '09:00 - 11:00', 'Чегарске']]),
    });
    expect(
      await count(
        sql`SELECT count(*)::int AS n FROM outage WHERE city = 'Kraljevo' AND NOT in_scope`,
      ),
    ).toBe(1);
  });
});
