// Fetches the raw OSM data for the Niš gazetteer (one Overpass query each for streets, address
// points and administrative areas) into fixtures/osm/. Processing happens elsewhere, against
// these saved files. Env: SCRAPER_CONTACT_EMAIL (required), FIXTURES_DIR, OVERPASS_ENDPOINT.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildUserAgent } from './collector/collect.ts';
import {
  fetchOverpass,
  NIS_QUERIES,
  OVERPASS_ENDPOINT,
  saveSnapshot,
} from './gazetteer/overpass.ts';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const env = process.env;
const userAgent = buildUserAgent(pkg.version, env.SCRAPER_CONTACT_EMAIL);
const endpoint = env.OVERPASS_ENDPOINT ?? OVERPASS_ENDPOINT;
const dir = join(env.FIXTURES_DIR ?? 'fixtures', 'osm');

for (const [i, q] of NIS_QUERIES.entries()) {
  // Overpass asks clients to run one query at a time and not to hammer the server.
  if (i > 0) await new Promise((r) => setTimeout(r, 10_000));
  console.log(`Fetching ${q.name} ...`);
  const result = await fetchOverpass(q.query, { userAgent, fetchFn: fetch, endpoint });
  const saved = await saveSnapshot(dir, q, result, endpoint, new Date());
  console.log(`  ${saved.elements} elements -> ${saved.file}`);
}
