// Fetches the raw OSM data for the Niš gazetteer into fixtures/osm/: streets, address points and
// administrative areas, then one query per city municipality (which streets and which villages
// lie in it). Processing happens elsewhere, against these saved files. Files that already exist
// are skipped so the shared Overpass server is not queried twice; set REFRESH=1 to refetch.
// Env: SCRAPER_CONTACT_EMAIL (required), FIXTURES_DIR, OVERPASS_ENDPOINT, REFRESH.
import { access, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildUserAgent } from './collector/collect.ts';
import {
  fetchOverpass,
  municipalityQuery,
  NIS_QUERIES,
  OVERPASS_ENDPOINT,
  pickMunicipalities,
  saveSnapshot,
  type SnapshotQuery,
} from './gazetteer/overpass.ts';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const env = process.env;
const userAgent = buildUserAgent(pkg.version, env.SCRAPER_CONTACT_EMAIL);
const endpoint = env.OVERPASS_ENDPOINT ?? OVERPASS_ENDPOINT;
// Default to the repo-root fixtures/ regardless of the directory pnpm runs the script from.
const dir = join(
  env.FIXTURES_DIR ?? fileURLToPath(new URL('../../fixtures', import.meta.url)),
  'osm',
);
const refresh = env.REFRESH === '1';

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

let fetched = 0;
async function run(q: SnapshotQuery): Promise<void> {
  if (!refresh && (await exists(join(dir, `${q.name}.json`)))) {
    console.log(`Skipping ${q.name} (already fetched)`);
    return;
  }
  // Overpass asks clients to run one query at a time and not to hammer the server.
  if (fetched++ > 0) await new Promise((r) => setTimeout(r, 10_000));
  console.log(`Fetching ${q.name} ...`);
  const result = await fetchOverpass(q.query, {
    userAgent,
    fetchFn: fetch,
    endpoint,
    log: (m) => console.log(`  ${m}`),
  });
  const saved = await saveSnapshot(dir, q, result, endpoint, new Date());
  console.log(`  ${saved.elements} elements -> ${saved.file}`);
}

for (const q of NIS_QUERIES) await run(q);

const admin = JSON.parse(await readFile(join(dir, 'nis-admin-areas.json'), 'utf8'));
const municipalities = pickMunicipalities(admin);
console.log(`Municipalities: ${municipalities.map((m) => `${m.name} (${m.id})`).join(', ')}`);
for (const m of municipalities) await run(municipalityQuery(m.id));
