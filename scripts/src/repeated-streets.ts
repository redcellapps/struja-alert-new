// Lists the street names that belong to more than one street in the Niš gazetteer, with the label each
// street is told apart by (a village's own name, or the city municipality for a street in the city).
// Prints Markdown. Reads the saved OSM snapshots only.
//   pnpm --filter @struja/scripts repeated-streets > repeated.md
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildNisGazetteer,
  buildSettlementAreas,
  type MunicipalitySnapshot,
  type NisStreet,
} from '@struja/parser';

const root = fileURLToPath(new URL('../../', import.meta.url));
const osm = join(root, 'fixtures', 'osm');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
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

const byName = new Map<string, NisStreet[]>();
for (const s of gazetteer.streets) byName.set(s.nameNorm, [...(byName.get(s.nameNorm) ?? []), s]);
const repeated = [...byName.values()]
  .filter((l) => l.length > 1)
  .sort((a, b) => b.length - a.length || (a[0]?.name ?? '').localeCompare(b[0]?.name ?? '', 'sr'));

console.log(
  `${repeated.length} names belong to more than one street (${gazetteer.streets.length} streets in all).\n`,
);
console.log('| name | streets | told apart by |');
console.log('| --- | ---: | --- |');
for (const list of repeated) {
  console.log(
    `| ${list[0]?.name} | ${list.length} | ${list.map((s) => s.settlement ?? '?').join(' · ')} |`,
  );
}
