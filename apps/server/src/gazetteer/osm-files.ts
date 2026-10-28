import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildNisGazetteer,
  buildSettlementAreas,
  type MunicipalitySnapshot,
  type NisGazetteer,
  type OsmLatLon,
} from '@struja/parser';

// Node-only: reads the saved Overpass snapshots (fixtures/osm) and builds the Niš gazetteer with
// the pure code in @struja/parser. The parser package itself does no file access.
export interface OsmAddress {
  tags: Record<string, string>;
  lat?: number;
  lon?: number;
  center?: OsmLatLon;
}

export interface NisSnapshots {
  gazetteer: NisGazetteer;
  addresses: OsmAddress[];
}

const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

export function readNisSnapshots(osmDir: string): NisSnapshots {
  const admin = readJson(join(osmDir, 'nis-admin-areas.json')).elements.filter(
    (e: { tags: Record<string, string> }) => e.tags.admin_level === '8',
  );
  const nameOf = new Map<string, string>(
    admin.map((e: { id: number; tags: Record<string, string> }) => [
      String(e.id),
      e.tags['name:sr-Latn'] ?? e.tags.name ?? '',
    ]),
  );
  const municipalities: MunicipalitySnapshot[] = readdirSync(osmDir)
    .filter((f) => /^nis-municipality-\d+\.json$/.test(f))
    .map((f) => {
      const els = readJson(join(osmDir, f)).elements;
      return {
        name: nameOf.get(/(\d+)/.exec(f)?.[1] ?? '') ?? '',
        streetWayIds: els
          .filter((e: { type: string; tags?: unknown }) => e.type === 'way' && !e.tags)
          .map((e: { id: number }) => e.id),
        places: els.filter((e: { tags?: { place?: string } }) => e.tags?.place),
      };
    });
  // The settlement boundaries (admin_level 9), when saved: streets are named after the settlement they lie in.
  const areasFile = join(osmDir, 'nis-settlement-areas.json');
  const areas = existsSync(areasFile) ? buildSettlementAreas(readJson(areasFile).elements) : [];
  return {
    gazetteer: buildNisGazetteer(
      readJson(join(osmDir, 'nis-streets.json')).elements,
      municipalities,
      areas,
    ),
    addresses: readJson(join(osmDir, 'nis-address-points.json')).elements,
  };
}
