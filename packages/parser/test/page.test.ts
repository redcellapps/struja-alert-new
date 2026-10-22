import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodePage, parsePage } from '../src/index.ts';

// Real pages collected from EDS on 22 Oct 2026 (fixtures/eds/manual-20261022T1202Z).
const FIXTURES = new URL('../../../fixtures/eds/manual-20261022T1202Z/', import.meta.url);
const load = (name: string) => parsePage(decodePage(readFileSync(new URL(name, FIXTURES))).text);

describe('raw fixtures', () => {
  // Guards against line-ending normalization (see `fixtures/** -text` in .gitattributes).
  it('are byte-for-byte what the collector saved (sha256 in each .meta.json)', () => {
    const pages = readdirSync(FIXTURES).filter((f) => f.endsWith('.htm'));
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      const meta = JSON.parse(
        readFileSync(new URL(page.replace(/\.htm$/, '.meta.json'), FIXTURES), 'utf8'),
      );
      const sha = createHash('sha256')
        .update(readFileSync(new URL(page, FIXTURES)))
        .digest('hex');
      expect(sha, page).toBe(meta.sha256);
    }
  });
});

describe('parsePage: Niš', () => {
  const page = load('Nis_Dan_0.htm');
  it('reads the header date', () => {
    expect(page.date).toEqual({ year: 2026, month: 10, day: 22 });
    expect(page.title).toContain('НИШ');
  });
  it('reads every data row with four columns', () => {
    expect(page.rows).toHaveLength(19);
    expect(page.rows[0]).toMatchObject({
      ogranak: 'Ниш',
      opstina: 'Пантелеј',
      vreme: '08:30 - 10:30',
      ulice: 'делови Горњоматејевачке и Студеничке;',
    });
    expect(page.rows[0]?.startsAt?.toISOString()).toBe('2026-10-22T06:30:00.000Z');
    expect(page.rows[0]?.endsAt?.toISOString()).toBe('2026-10-22T08:30:00.000Z');
  });
  it('includes rows from other branches (regional feed)', () => {
    expect(new Set(page.rows.map((r) => r.ogranak))).toContain('Прокупље');
  });
  it('keeps the Ulice cell untouched', () => {
    const row = page.rows.find((r) => r.opstina === 'Нишка бања' && r.vreme.startsWith('12:00'));
    expect(row?.ulice).toBe('делови Чегарске (непарни бр. 9-53, парни бр. 30-44);');
  });
});

describe('parsePage: header-only and Belgrade', () => {
  it('treats a header-only page as valid data with no rows', () => {
    const page = load('Nis_Dan_2.htm');
    expect(page.date).toEqual({ year: 2026, month: 10, day: 24 });
    expect(page.rows).toEqual([]);
  });
  it('maps Belgrade pages, which have no Огранак column', () => {
    const page = load('Beograd_Dan_0.htm');
    expect(page.rows.length).toBeGreaterThan(0);
    expect(page.rows[0]).toMatchObject({
      ogranak: null,
      opstina: 'Врачар',
      vreme: '09:30 - 11:30',
    });
    expect(page.rows[0]?.ulice).toBe('БЈЕЛАНОВИЋЕВА: 2,');
  });
  it('parses every collected page without throwing and finds a time window in every row', () => {
    for (const city of ['Nis', 'Kraljevo', 'Beograd']) {
      for (let n = 0; n < 4; n++) {
        const page = load(`${city}_Dan_${n}.htm`);
        expect(page.date).not.toBeNull();
        for (const row of page.rows) expect(row.startsAt).not.toBeNull();
      }
    }
  });
});
