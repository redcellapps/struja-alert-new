import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildNisGazetteer,
  buildSettlementAreas,
  decodePage,
  parsePage,
  type MunicipalitySnapshot,
  type NisGazetteer,
} from '@struja/parser';
import {
  aliasSeed,
  buildLabels,
  rowInScope,
  summarize,
  toCsv,
  type LabelRow,
  type PageInput,
} from '../src/labels/build.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const osm = join(root, 'fixtures', 'osm');
const eds = join(root, 'fixtures', 'eds');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

let gazetteer: NisGazetteer;
let pages: PageInput[];
let rows: LabelRow[];

beforeAll(() => {
  const admin = readJson(join(osm, 'nis-admin-areas.json')).elements.filter(
    (e: { tags: Record<string, string> }) => e.tags.admin_level === '8',
  );
  const nameOf = new Map<string, string>(
    admin.map((e: { id: number; tags: Record<string, string> }) => [
      String(e.id),
      e.tags['name:sr-Latn'] ?? e.tags.name ?? '',
    ]),
  );
  const muns: MunicipalitySnapshot[] = readdirSync(osm)
    .filter((f) => /^nis-municipality-\d+\.json$/.test(f))
    .map((f) => {
      const els = readJson(join(osm, f)).elements;
      return {
        name: nameOf.get(/(\d+)/.exec(f)?.[1] ?? '') ?? '',
        streetWayIds: els
          .filter((e: { type: string; tags?: unknown }) => e.type === 'way' && !e.tags)
          .map((e: { id: number }) => e.id),
        places: els.filter((e: { tags?: { place?: string } }) => e.tags?.place),
      };
    });
  gazetteer = buildNisGazetteer(
    readJson(join(osm, 'nis-streets.json')).elements,
    muns,
    buildSettlementAreas(readJson(join(osm, 'nis-settlement-areas.json')).elements),
  );
  pages = [];
  for (const slot of readdirSync(eds)
    .filter((d) => d.startsWith('manual-'))
    .sort()) {
    for (const f of readdirSync(join(eds, slot)).filter((f) => /^Nis_Dan_\d+\.htm$/.test(f))) {
      pages.push({
        slot,
        city: 'Nis',
        page: parsePage(decodePage(readFileSync(join(eds, slot, f))).text),
      });
    }
  }
  rows = buildLabels(pages, gazetteer);
});

describe('buildLabels on the collected Niš pages', () => {
  it('keeps every distinct segment once, across snapshots', () => {
    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(Math.max(...rows.map((r) => r.seen_in_snapshots))).toBeGreaterThanOrEqual(2);
  });
  it('marks other branches out of scope and proposes nothing for them', () => {
    const out = rows.filter((r) => !r.in_scope);
    expect(out.length).toBeGreaterThan(0);
    for (const r of out) expect(r.proposed).toBe('');
    expect(out.every((r) => r.kind === 'out_of_scope')).toBe(true);
  });
  it('proposes a street for every in-scope street segment', () => {
    const inScope = rows.filter((r) => r.in_scope && r.kind === 'street');
    expect(inScope.length).toBeGreaterThanOrEqual(10);
    for (const r of inScope) {
      // a name that several streets share and the row cannot place: no single street, every candidate listed
      if (r.resolved_by === 'ambiguous') {
        expect(r.proposed, r.raw_segment).toBe('');
        expect(r.candidates, r.raw_segment).toContain('·');
      } else {
        expect(r.proposed, r.raw_segment).not.toBe('');
      }
    }
  });
  it('summarizes the sample size next to the rate', () => {
    const s = summarize(rows);
    expect(s.inScopeStreetSegments).toBeGreaterThanOrEqual(10);
    // every segment is resolved except those whose name several streets share and nothing places
    const ambiguous = s.resolvedByStep['ambiguous'] ?? 0;
    expect(s.resolvedStreetSegments + ambiguous).toBe(s.inScopeStreetSegments);
    expect(s.resolutionRate).toBeGreaterThan(0.5);
  });
  it('writes a CSV with empty confirmed/notes columns for the reviewer', () => {
    const csv = toCsv(rows);
    const [head, first] = csv.split('\n');
    expect(head?.endsWith(',confirmed,notes')).toBe(true);
    expect(first?.endsWith(',,')).toBe(true);
  });
  it('seeds aliases only for non-exact matches, keyed by normalized text', () => {
    const seed = aliasSeed(rows);
    expect(seed.length).toBeGreaterThan(0);
    expect(seed.every((a) => a.source !== 'exact')).toBe(true);
    expect(seed.find((a) => a.raw === 'Космајске')).toMatchObject({
      raw_norm: 'kosmajske',
      street: 'Космајска',
      source: 'form',
    });
    // a spelling of a shared name is seeded too (the street is placed by its row)
    expect(seed.find((a) => a.raw === 'Чегарске')).toMatchObject({
      raw_norm: 'cegarske',
      street: 'Чегарска',
      source: 'placed',
    });
    // a name the row could not place yields no seed: there is no single street to point at
    expect(seed.find((a) => a.raw === 'Студеничке')).toBeUndefined();
  });
});

describe('rowInScope', () => {
  const row = (opstina: string) =>
    ({ opstina, ogranak: null, vreme: '', ulice: '', startsAt: null, endsAt: null }) as Parameters<
      typeof rowInScope
    >[1];
  it('needs a Niš page AND one of the five municipalities', () => {
    expect(rowInScope('Nis', row('Палилула - Ниш'))).toBe(true);
    expect(rowInScope('Nis', row('Прокупље'))).toBe(false);
    // Belgrade has its own Палилула: the page decides.
    expect(rowInScope('Beograd', row('Палилула'))).toBe(false);
  });
});
