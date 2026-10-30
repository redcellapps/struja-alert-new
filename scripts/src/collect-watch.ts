// The collector's daily watchdog (.github/workflows/collect-watch.yml). Reads the fixtures branch
// checked out at FIXTURES_DIR and reports the last whole Belgrade day. A day with no slot at all
// exits 1, which fails the workflow (GitHub mails the failure); the workflow then also opens or
// updates the "Collector: no fixtures" issue. No network requests here.
//   Env: FIXTURES_DIR (required), DATE (optional override, YYYY-MM-DD), GITHUB_OUTPUT (set by Actions).
import { appendFileSync } from 'node:fs';
import { checkDay, dayToCheck, describeDay } from './collector/watch.ts';

const fixturesDir = process.env.FIXTURES_DIR;
if (!fixturesDir) throw new Error('FIXTURES_DIR is not set');
const date = process.env.DATE ?? dayToCheck(new Date());
const report = checkDay(fixturesDir, date);
const text = describeDay(report);
console.log(text);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `date=${report.date}\nmissing=${report.missing.length}\nsummary=${text}\n`,
  );
}
if (report.present.length === 0) process.exit(1);
