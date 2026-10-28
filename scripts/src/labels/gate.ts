import { normalizeName } from '@struja/parser';
import { parseCsv } from './csv.ts';

// The Phase 1 gate (BRIEF §9), measured on in-scope rows only and always reported with the
// sample size: automatic resolution >= 95%, auto-accept precision >= 99%.
export const GATE = {
  minSample: 200,
  resolutionTarget: 0.95,
  precisionTarget: 0.99,
} as const;

// `placed`: the name belongs to several streets and the row's municipality or its other streets chose one.
const AUTO_ACCEPT = new Set(['exact', 'alias', 'form', 'fuzzy', 'heuristic', 'scored', 'placed']);

// 95% Wilson interval lower bound: how low the true rate could plausibly be given the sample.
export function wilsonLower(correct: number, n: number, z = 1.96): number {
  if (n === 0) return 0;
  const p = correct / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.max(0, (centre - margin) / denom);
}

export interface Verdict {
  // Rows of the sample.
  inScopeStreetSegments: number;
  confirmed: number;
  pendingReview: number;
  // Resolution: share of in-scope street segments that got an automatic answer (n = all in scope).
  resolved: number;
  // Segments whose name several streets share and nothing in the row chose between them: every
  // one of those streets is told "Moguće", so nobody is missed, but it is not an automatic answer.
  ambiguous: number;
  resolutionRate: number | null;
  // Precision: among confirmed auto-accepts, the share whose proposal was right (n = confirmed accepts).
  confirmedAutoAccepts: number;
  correctAutoAccepts: number;
  wrongAutoAccepts: number;
  precision: number | null;
  precisionLower95: number | null;
  byStep: Record<string, { confirmed: number; correct: number }>;
  status: 'INSUFFICIENT_SAMPLE' | 'PASS' | 'FAIL';
  note: string;
}

// `confirmed` is "ok" (proposal right), "none" (the segment names no street) or the correct street.
function isCorrect(proposed: string, confirmed: string): boolean {
  const c = confirmed.trim();
  if (c.toLowerCase() === 'ok') return true;
  if (c.toLowerCase() === 'none') return proposed === '';
  return normalizeName(c) === normalizeName(proposed);
}

export function measureGate(csvText: string): Verdict {
  const [head, ...rows] = parseCsv(csvText);
  const col = (n: string) => head?.indexOf(n) ?? -1;
  const [iScope, iKind, iProp, iBy, iConf] = [
    'in_scope',
    'kind',
    'proposed',
    'resolved_by',
    'confirmed',
  ].map(col) as [number, number, number, number, number];
  const sample = rows.filter((r) => r[iScope] === 'true' && r[iKind] === 'street');
  const resolved = sample.filter((r) => (r[iProp] ?? '') !== '').length;
  const ambiguous = sample.filter((r) => (r[iBy] ?? '') === 'ambiguous').length;
  const confirmedRows = sample.filter((r) => (r[iConf] ?? '').trim() !== '');
  const accepts = confirmedRows.filter(
    (r) => AUTO_ACCEPT.has(r[iBy] ?? '') && (r[iProp] ?? '') !== '',
  );
  const byStep: Verdict['byStep'] = {};
  let correct = 0;
  for (const r of accepts) {
    const ok = isCorrect(r[iProp] ?? '', r[iConf] ?? '');
    const step = (byStep[r[iBy] ?? ''] ??= { confirmed: 0, correct: 0 });
    step.confirmed++;
    if (ok) {
      step.correct++;
      correct++;
    }
  }
  const n = sample.length;
  const precision = accepts.length ? correct / accepts.length : null;
  const resolutionRate = n ? resolved / n : null;
  let status: Verdict['status'] = 'INSUFFICIENT_SAMPLE';
  let note = `Need at least ${GATE.minSample} confirmed in-scope segments to judge the gate; have ${confirmedRows.length}.`;
  if (confirmedRows.length >= GATE.minSample && n >= GATE.minSample) {
    const pass =
      (resolutionRate ?? 0) >= GATE.resolutionTarget && (precision ?? 0) >= GATE.precisionTarget;
    status = pass ? 'PASS' : 'FAIL';
    note = pass
      ? 'Targets met on the point estimates; check the 95% lower bound before freezing thresholds.'
      : 'Below target.';
  }
  return {
    inScopeStreetSegments: n,
    confirmed: confirmedRows.length,
    pendingReview: n - confirmedRows.length,
    resolved,
    ambiguous,
    resolutionRate,
    confirmedAutoAccepts: accepts.length,
    correctAutoAccepts: correct,
    wrongAutoAccepts: accepts.length - correct,
    precision,
    precisionLower95: accepts.length ? wilsonLower(correct, accepts.length) : null,
    byStep,
    status,
    note,
  };
}

const pct = (x: number | null) => (x === null ? 'n/a' : `${(100 * x).toFixed(1)}%`);

export function formatVerdict(v: Verdict): string {
  const steps = Object.entries(v.byStep)
    .map(([k, s]) => `${k} ${s.correct}/${s.confirmed}`)
    .join(', ');
  return [
    `Phase 1 gate (in-scope Niš street segments only): ${v.status}`,
    `  sample: ${v.inScopeStreetSegments} in-scope segments, ${v.confirmed} confirmed, ${v.pendingReview} pending review`,
    `  automatic resolution: ${pct(v.resolutionRate)} (${v.resolved}/${v.inScopeStreetSegments}); target ≥ ${GATE.resolutionTarget * 100}%`,
    `  ambiguous (a name several streets share, none chosen, all told "Moguće"): ${v.ambiguous}`,
    `  auto-accept precision: ${pct(v.precision)} (${v.correctAutoAccepts}/${v.confirmedAutoAccepts} confirmed accepts), 95% lower bound ${pct(v.precisionLower95)}; target ≥ ${GATE.precisionTarget * 100}%`,
    `  by step (correct/confirmed): ${steps || 'none yet'}`,
    `  ${v.note}`,
  ].join('\n');
}
