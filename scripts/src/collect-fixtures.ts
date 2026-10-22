// The only code (besides the production scheduler) allowed to request elektrodistribucija.rs.
// Env: SCRAPER_CONTACT_EMAIL (required), FIXTURES_DIR, COLLECT_CITIES, FORCE=1, DELAY_MS, EDS_INDEX_URL.
import { readFileSync } from 'node:fs';
import { BASE, buildUserAgent, collectSlot } from './collector/collect.ts';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const env = process.env;

const summary = await collectSlot({
  now: new Date(),
  force: env.FORCE === '1',
  fixturesDir: env.FIXTURES_DIR ?? 'fixtures',
  cities: (env.COLLECT_CITIES ?? 'Nis,Kraljevo')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  userAgent: buildUserAgent(pkg.version, env.SCRAPER_CONTACT_EMAIL),
  fetchFn: fetch,
  delayMs: Number(env.DELAY_MS ?? 1500),
  indexUrl: env.EDS_INDEX_URL ?? `${BASE}/planirana-iskljucenja-srbija/`,
  log: (m) => console.log(m),
});

console.log(
  summary
    ? JSON.stringify({
        collected: summary.slot_key,
        pages: summary.pages.length,
        errors: summary.errors,
      })
    : 'nothing collected',
);
