// Builds fixtures/labels.csv (every distinct segment on the collected Niš pages, with the
// ladder's proposed answer for the reviewer to confirm) and packages/parser/data/aliases.json
// (the alias seed). Reads only saved fixtures; makes no network requests.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addressNumbersByStreet,
  buildNisGazetteer,
  buildSettlementAreas,
  decodePage,
  parsePage,
  type MunicipalitySnapshot,
} from '@struja/parser';
import { aliasSeed, buildLabels, summarize, toCsv, type PageInput } from './labels/build.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixtures = join(root, 'fixtures');
const osm = join(fixtures, 'osm');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

// Gazetteer from the OSM snapshots.
const admin = readJson(join(osm, 'nis-admin-areas.json')).elements.filter(
  (e: { tags: Record<string, string> }) => e.tags.admin_level === '8',
);
const nameOf = new Map<string, string>(
  admin.map((e: { id: number; tags: Record<string, string> }) => [
    String(e.id),
    e.tags['name:sr-Latn'] ?? e.tags.name ?? '',
  ]),
);
const municipalities: MunicipalitySnapshot[] = readdirSync(osm)
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
const gazetteer = buildNisGazetteer(
  readJson(join(osm, 'nis-streets.json')).elements,
  municipalities,
  buildSettlementAreas(readJson(join(osm, 'nis-settlement-areas.json')).elements),
);
const addressNumbers = addressNumbersByStreet(
  readJson(join(osm, 'nis-address-points.json')).elements,
);

// Every collected Niš page, oldest snapshot first.
const eds = join(fixtures, 'eds');
const pages: PageInput[] = [];
for (const slot of readdirSync(eds)
  .filter((d) => !d.startsWith('_') && !d.endsWith('.json'))
  .sort()) {
  for (const f of readdirSync(join(eds, slot))
    .filter((f) => /^Nis_Dan_\d+\.htm$/.test(f))
    .sort()) {
    pages.push({
      slot,
      city: 'Nis',
      page: parsePage(decodePage(readFileSync(join(eds, slot, f))).text),
    });
  }
}

// Regenerating never loses a review: previous `confirmed`/`notes` and reviewed aliases carry over.
const labelsPath = join(fixtures, 'labels.csv');
const aliasesPath = join(root, 'packages', 'parser', 'data', 'aliases.json');
const previousAliases = existsSync(aliasesPath) ? readJson(aliasesPath) : [];
const rows = buildLabels(pages, gazetteer, addressNumbers, previousAliases);
writeFileSync(
  labelsPath,
  toCsv(rows, existsSync(labelsPath) ? readFileSync(labelsPath, 'utf8') : ''),
);
const aliases = aliasSeed(rows, previousAliases);
writeFileSync(aliasesPath, JSON.stringify(aliases, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      snapshots: [...new Set(pages.map((p) => p.slot))].length,
      ...summarize(rows),
      aliases: aliases.length,
    },
    null,
    2,
  ),
);
