// Phase 1 gate measurement from fixtures/labels.csv (or a path given as the first argument).
// In-scope rows only, always with the sample size. Re-run weekly as the collector adds data.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatVerdict, measureGate } from './labels/gate.ts';

const path =
  process.argv[2] ??
  join(fileURLToPath(new URL('../../', import.meta.url)), 'fixtures', 'labels.csv');
const verdict = measureGate(readFileSync(path, 'utf8'));
console.log(formatVerdict(verdict));
if (process.argv.includes('--json')) console.log(JSON.stringify(verdict, null, 2));
