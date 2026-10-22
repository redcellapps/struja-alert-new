// SYNTHETIC stress test of the resolution ladder. It is NOT a measurement of real EDS data: the
// inputs are perturbed names of real Niš streets, so the truth is known. Use it to see how the
// ladder behaves (what it accepts, whether accepts are right) while real labels are still scarce.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildNisGazetteer,
  generateForms,
  Resolver,
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
const muns: MunicipalitySnapshot[] = readdirSync(osm)
  .filter((f) => /^nis-municipality-\d+\.json$/.test(f))
  .map((f) => {
    const els = readJson(join(osm, f)).elements;
    return {
      name: nameOf.get(/(\d+)/.exec(f)?.[1] ?? '') ?? '',
      streetWayIds: els
        .filter((e: { type: string; tags?: unknown }) => e.type === 'way' && !e.tags)
        .map((e: { id: number }) => e.id),
      places: [],
    };
  });
const gaz = buildNisGazetteer(readJson(join(osm, 'nis-streets.json')).elements, muns);
const resolver = new Resolver(gaz.streets);

// Deterministic pseudo-random numbers so runs are comparable.
let seed = 12345;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

type Kind = 'genitive' | 'typo' | 'dropFirst' | 'swap' | 'nonsense';
interface Case {
  kind: Kind;
  input: string;
  truth: NisStreet | null;
}
const cases: Case[] = [];
for (const s of gaz.streets) {
  const tokens = s.nameNorm.split(' ');
  const forms = generateForms(s.nameNorm).filter((f) => f !== s.nameNorm);
  if (forms.length)
    cases.push({
      kind: 'genitive',
      input: forms[Math.floor(rnd() * forms.length)] as string,
      truth: s,
    });
  const long = tokens.reduce((a, b) => (b.length > a.length ? b : a), '');
  if (long.length >= 6) {
    const i = 1 + Math.floor(rnd() * (long.length - 2));
    const typo = long.slice(0, i) + long.slice(i + 1);
    cases.push({
      kind: 'typo',
      input: tokens.map((t) => (t === long ? typo : t)).join(' '),
      truth: s,
    });
  }
  if (tokens.length >= 2)
    cases.push({ kind: 'dropFirst', input: tokens.slice(1).join(' '), truth: s });
  if (tokens.length === 2)
    cases.push({ kind: 'swap', input: `${tokens[1]} ${tokens[0]}`, truth: s });
}
for (const junk of [
  'potpuno nepoznata ulica',
  'xyz',
  'ratarska zadruga',
  'stara pruga',
  'groblje',
  'industrijska zona',
]) {
  cases.push({ kind: 'nonsense', input: junk, truth: null });
}

const stats = new Map<Kind, { n: number; accepted: number; correct: number; wrong: number }>();
const byStep = new Map<string, { accepted: number; correct: number }>();
const wrongExamples: string[] = [];
const names = new Set(gaz.streets.flatMap((s) => [s.nameNorm, ...(s.altNorms ?? [])]));
let collisions = 0;
for (const c of cases) {
  // The perturbed input is literally another real street's name: unanswerable by construction.
  if (
    c.truth &&
    names.has(c.input) &&
    !(c.truth.altNorms ?? []).includes(c.input) &&
    c.input !== c.truth.nameNorm
  ) {
    collisions++;
    continue;
  }
  const r = resolver.resolve(c.input, { municipality: c.truth?.municipality ?? null });
  const st = stats.get(c.kind) ?? { n: 0, accepted: 0, correct: 0, wrong: 0 };
  st.n++;
  if (r.street) {
    st.accepted++;
    const step = byStep.get(r.by) ?? { accepted: 0, correct: 0 };
    step.accepted++;
    byStep.set(r.by, step);
    if (r.street === c.truth) {
      st.correct++;
      step.correct++;
    } else {
      st.wrong++;
      if (wrongExamples.length < 14)
        wrongExamples.push(
          `${c.kind}: "${c.input}" -> ${r.street.name} via ${r.by} (truth ${c.truth?.name ?? 'none'})`,
        );
    }
  }
  stats.set(c.kind, st);
}
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');
const out: Record<string, unknown> = {};
let tn = 0,
  ta = 0,
  tc = 0;
for (const [kind, st] of stats) {
  out[kind] = {
    cases: st.n,
    acceptedRate: pct(st.accepted, st.n),
    precisionOfAccepted: pct(st.correct, st.accepted),
    wrongAccepts: st.wrong,
  };
  tn += st.n;
  ta += st.accepted;
  tc += st.correct;
}
console.log(
  JSON.stringify(
    {
      note: 'SYNTHETIC, not real EDS data',
      streets: gaz.streets.length,
      totalCases: tn,
      acceptedRate: pct(ta, tn),
      precisionOfAccepted: pct(tc, ta),
      excludedCollisions: collisions,
      byKind: out,
      byStep: Object.fromEntries(
        [...byStep].map(([k, v]) => [
          k,
          { accepted: v.accepted, precision: pct(v.correct, v.accepted) },
        ]),
      ),
    },
    null,
    2,
  ),
);
if (wrongExamples.length) console.log('wrong accepts (sample):\n' + wrongExamples.join('\n'));
