// Development only: (re)loads the saved OSM snapshots of fixtures/osm into the local database: the
// street list (one street per name and place), settlements, address points and reviewed aliases.
// Rows of the old name-merged street list are replaced, and what pointed at them is moved.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDb, runMigrations } from '../db/client.ts';
import { importGazetteer, type ReviewedAlias } from '../gazetteer/import.ts';
import { readNisSnapshots } from '../gazetteer/osm-files.ts';
import { assertLocalDatabase } from './local-only.ts';

const url = process.env.DATABASE_URL;
assertLocalDatabase(url, 'dev:import-gazetteer');
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const { db, pool } = createDb(url as string);
await runMigrations(db);
const src = readNisSnapshots(`${repoRoot}fixtures/osm`);
const aliases: ReviewedAlias[] = JSON.parse(
  readFileSync(`${repoRoot}packages/parser/data/aliases.json`, 'utf8'),
);
const r = await importGazetteer(db, {
  city: 'Nis',
  gazetteer: src.gazetteer,
  addresses: src.addresses,
  aliases,
});
console.log(JSON.stringify(r));
await pool.end();
