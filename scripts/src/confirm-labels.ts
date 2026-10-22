// Records a review decision in fixtures/labels.csv so a reviewer does not have to edit the file by
// hand. `--ok-proposed-in-scope` marks every in-scope street segment that has a proposal and no
// review yet as "ok" (the proposal is right). Only use it after reading the proposals.
// Usage: node src/confirm-labels.ts --ok-proposed-in-scope --by "Name" [--date 2026-10-22]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { csvCell, parseCsv } from './labels/csv.ts';

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!args.includes('--ok-proposed-in-scope')) {
  console.error('Nothing to do: pass --ok-proposed-in-scope --by "Name"');
  process.exit(1);
}
const by = arg('--by');
if (!by) {
  console.error('--by "Name" is required: who reviewed these proposals');
  process.exit(1);
}
const date = arg('--date') ?? new Date().toISOString().slice(0, 10);

const path = join(fileURLToPath(new URL('../../', import.meta.url)), 'fixtures', 'labels.csv');
const [head, ...rows] = parseCsv(readFileSync(path, 'utf8'));
if (!head) throw new Error('labels.csv is empty');
const idx = (n: string) => head.indexOf(n);
const [iScope, iKind, iProp, iConf, iNotes] = [
  'in_scope',
  'kind',
  'proposed',
  'confirmed',
  'notes',
].map(idx) as [number, number, number, number, number];

let marked = 0;
const out = rows.map((r) => {
  if (r[iScope] === 'true' && r[iKind] === 'street' && r[iProp] && !r[iConf]) {
    r[iConf] = 'ok';
    r[iNotes] = `reviewed by ${by} ${date}`;
    marked++;
  }
  return r;
});
writeFileSync(path, [head, ...out].map((r) => r.map(csvCell).join(',')).join('\n') + '\n');
console.log(`Marked ${marked} proposals as confirmed (ok), reviewed by ${by} on ${date}.`);
