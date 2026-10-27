// Development only: copies the newest saved Niš snapshot of fixtures/eds to .dev/eds/dev/ with the date of
// every page moved to today (day 0) ... today + 3, so the local server shows outages "today" and "upcoming".
// The hours are the real ones from the snapshot. Nothing here requests elektrodistribucija.rs.
//   --shift=<minutes>  moves every time on the pages (so an outage is "now" at any hour); stays within the day
//   --repeat-today     days 1..3 use the content of day 0, so Najave and the 4-day strip have outages
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocalDatabase } from './local-only.ts';

// It only writes files under .dev, but it belongs to the local stack: the same guard as dev:scrape.
assertLocalDatabase(process.env.DATABASE_URL, 'dev:fixtures');

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const CITY = 'Nis';
const DAYS = [0, 1, 2, 3];
const DATE_IN_PAGE = /\b\d{1,2}\.\d{1,2}\.20\d{2}\b/g;
const TIME_IN_PAGE = /\b(\d{1,2}):(\d{2})\b/g;

const shiftArg = process.argv.find((a) => a.startsWith('--shift='));
const shift = shiftArg ? Number(shiftArg.slice('--shift='.length)) : 0;
const repeatToday = process.argv.includes('--repeat-today');
if (!Number.isInteger(shift)) throw new Error('--shift needs a whole number of minutes');

function shiftTimes(html: string): string {
  if (shift === 0) return html;
  return html.replace(TIME_IN_PAGE, (_m, h: string, min: string) => {
    const total = Number(h) * 60 + Number(min) + shift;
    if (total < 0 || total >= 24 * 60) {
      throw new Error(`--shift=${shift} moves ${h}:${min} out of the day`);
    }
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  });
}

const src = join(repoRoot, 'fixtures', 'eds');
const slot = readdirSync(src)
  .filter((d) => !d.startsWith('_') && !d.endsWith('.json'))
  .sort()
  .reverse()
  .find((d) => DAYS.every((n) => readdirSync(join(src, d)).includes(`${CITY}_Dan_${n}.htm`)));
if (!slot) throw new Error('no saved snapshot with all four Niš days in fixtures/eds');

const out = join(repoRoot, '.dev', 'eds', 'dev');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Belgrade calendar day, so the page dates match what the server calls "today"
const belgradeDay = (offset: number): Date => {
  const now = new Date(Date.now() + offset * 86_400_000);
  const [y, m, d] = now
    .toLocaleDateString('en-CA', { timeZone: 'Europe/Belgrade' })
    .split('-')
    .map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
};

for (const n of DAYS) {
  const day = belgradeDay(n);
  const text = `${day.getUTCDate()}.${day.getUTCMonth() + 1}.${day.getUTCFullYear()}`;
  // latin1 keeps every byte of the page as it was; only the ASCII date changes
  const html = readFileSync(join(src, slot, `${CITY}_Dan_${repeatToday ? 0 : n}.htm`)).toString(
    'latin1',
  );
  const found = html.match(DATE_IN_PAGE)?.length ?? 0;
  if (found !== 1) throw new Error(`${CITY}_Dan_${n}.htm: expected one date, found ${found}`);
  writeFileSync(
    join(out, `${CITY}_Dan_${n}.htm`),
    Buffer.from(shiftTimes(html.replace(DATE_IN_PAGE, text)), 'latin1'),
  );
  copyFileSync(
    join(src, slot, `${CITY}_Dan_${n}.meta.json`),
    join(out, `${CITY}_Dan_${n}.meta.json`),
  );
}
console.log(
  `.dev/eds/dev from ${slot}: ${CITY} days 0..3 dated ${belgradeDay(0).toISOString().slice(0, 10)} ...`,
);
