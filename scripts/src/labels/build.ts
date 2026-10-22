import {
  nisMunicipality,
  normalizeName,
  resolveRow,
  Resolver,
  splitUlice,
  StreetIndex,
  type CandidateRef,
  type NisGazetteer,
  type PageRow,
  type ParsedPage,
} from '@struja/parser';
import { csvCell, labelKey, parseCsv, readReviewed } from './csv.ts';

export interface PageInput {
  slot: string;
  // "Nis", "Kraljevo", ... the collector's slug for the page.
  city: string;
  page: ParsedPage;
}

export type LabelKind = 'street' | 'village' | 'out_of_scope';

export interface LabelRow {
  key: string;
  first_seen: string;
  last_seen: string;
  seen_in_snapshots: number;
  date: string;
  ogranak: string;
  opstina: string;
  in_scope: boolean;
  raw_segment: string;
  segment_name: string;
  ranges: string;
  kind: LabelKind;
  proposed: string;
  resolved_by: string;
  score: string;
  candidates: string;
}

// In scope = a Niš-branch page row whose municipality is one of the five city municipalities.
export function rowInScope(city: string, row: PageRow): boolean {
  return city === 'Nis' && nisMunicipality(row.opstina) !== null;
}

function fmtCandidates(candidates: readonly CandidateRef[]): string {
  return candidates
    .slice(0, 3)
    .map((c) => `${c.name} (${c.score.toFixed(2)})`)
    .join('; ');
}

/**
 * Distinct segments of every Niš-branch page, each with the ladder's proposed answer. The rest of
 * the row (already resolved streets) is the spatial context for segments the cheap steps could not
 * place. Segments from rows outside the five municipalities are kept but marked out of scope: the
 * gazetteer cannot resolve them.
 */
export function buildLabels(
  pages: readonly PageInput[],
  gazetteer: NisGazetteer,
  addressNumbers?: ReadonlyMap<string, ReadonlySet<number>>,
): LabelRow[] {
  const resolver = new Resolver(gazetteer.streets);
  const settlements = new StreetIndex(gazetteer.settlements);
  const rows = new Map<string, LabelRow>();

  for (const { slot, city, page } of pages) {
    if (city !== 'Nis') continue;
    const date = page.date
      ? `${page.date.year}-${String(page.date.month).padStart(2, '0')}-${String(page.date.day).padStart(2, '0')}`
      : '';
    for (const row of page.rows) {
      const inScope = rowInScope(city, row);
      const municipality = nisMunicipality(row.opstina);
      const segments = splitUlice(row.ulice);

      // The shared two-pass resolution (also used by the server): the row's own streets are the
      // spatial context for segments the cheaper steps could not place.
      const resolutions = inScope
        ? resolveRow(segments, { resolver, settlements, municipality, addressNumbers })
        : null;

      segments.forEach((seg, i) => {
        const rangesText = seg.ranges.map((r) => r.raw).join(', ');
        const key = [row.opstina, seg.raw].join('|');
        const seen = rows.get(key);
        if (seen) {
          seen.last_seen = slot;
          seen.seen_in_snapshots++;
          return;
        }
        let kind: LabelKind = 'out_of_scope';
        let proposed = '';
        let resolvedBy = '';
        let score = '';
        let candidates = '';
        const res = resolutions?.[i];
        if (res) {
          kind = res.kind;
          proposed = (res.street ?? res.settlement)?.name ?? '';
          resolvedBy = res.by;
          score = res.score === null ? '' : res.score.toFixed(2);
          candidates = fmtCandidates(res.candidates);
        }
        rows.set(key, {
          key,
          first_seen: slot,
          last_seen: slot,
          seen_in_snapshots: 1,
          date,
          ogranak: row.ogranak ?? '',
          opstina: row.opstina,
          in_scope: inScope,
          raw_segment: seg.raw,
          segment_name: seg.name,
          ranges: rangesText,
          kind,
          proposed,
          resolved_by: resolvedBy,
          score,
          candidates,
        });
      });
    }
  }
  return [...rows.values()];
}

const COLUMNS = [
  'in_scope',
  'kind',
  'date',
  'opstina',
  'ogranak',
  'raw_segment',
  'segment_name',
  'ranges',
  'proposed',
  'resolved_by',
  'score',
  'candidates',
  'first_seen',
  'seen_in_snapshots',
] as const;

const CSV_HEAD = [...COLUMNS, 'confirmed', 'notes'];

// `confirmed` and `notes` are for the reviewer: put the correct street (or "ok" when the
// proposal is right, "none" when the segment names no street) in `confirmed`.
//
// Regenerating must never lose a review: pass the previous file as `priorCsv` and every
// `confirmed`/`notes` is carried over by (municipality, raw segment), and a reviewed row that is
// no longer in the collected pages is kept as it was.
export function toCsv(rows: readonly LabelRow[], priorCsv = ''): string {
  const reviewed = readReviewed(priorCsv);
  const lines: string[] = [];
  const written = new Set<string>();
  for (const r of rows) {
    const key = labelKey(r.opstina, r.raw_segment);
    written.add(key);
    const rev = reviewed.get(key);
    lines.push(
      [
        ...COLUMNS.map((c) => csvCell(r[c])),
        csvCell(rev?.confirmed ?? ''),
        csvCell(rev?.notes ?? ''),
      ].join(','),
    );
  }
  const [head, ...prior] = parseCsv(priorCsv);
  if (head) {
    const iOp = head.indexOf('opstina');
    const iRaw = head.indexOf('raw_segment');
    for (const p of prior) {
      const key = labelKey(p[iOp] ?? '', p[iRaw] ?? '');
      if (written.has(key) || !reviewed.has(key)) continue;
      lines.push(CSV_HEAD.map((c) => csvCell(p[head.indexOf(c)] ?? '')).join(','));
    }
  }
  return [CSV_HEAD.join(','), ...lines].join('\n') + '\n';
}

export interface AliasSeedEntry {
  raw: string;
  raw_norm: string;
  street: string;
  source: string;
  confidence: number;
  // Set by a human review. A reviewed entry is never changed or dropped by regeneration.
  reviewed?: boolean;
  reviewed_at?: string;
}

// Aliases worth reviewing: matches that were not a plain exact name. Keyed by the street's OSM
// name, because gazetteer ids are not stable between builds. Entries already in `existing` are
// kept as they are (reviewed or not); only new proposals are added, unreviewed.
export function aliasSeed(
  rows: readonly LabelRow[],
  existing: readonly AliasSeedEntry[] = [],
): AliasSeedEntry[] {
  const out = new Map<string, AliasSeedEntry>();
  for (const r of rows) {
    if (!r.in_scope || r.kind !== 'street' || !r.proposed) continue;
    if (!['form', 'fuzzy', 'heuristic', 'scored'].includes(r.resolved_by)) continue;
    const raw_norm = normalizeName(r.segment_name);
    out.set(raw_norm, {
      raw: r.segment_name,
      raw_norm,
      street: r.proposed,
      source: r.resolved_by,
      confidence: r.resolved_by === 'form' ? 1 : r.resolved_by === 'scored' ? Number(r.score) : 0.8,
    });
  }
  for (const e of existing) out.set(e.raw_norm, e);
  return [...out.values()].sort((a, b) => a.raw_norm.localeCompare(b.raw_norm));
}

export function summarize(rows: readonly LabelRow[]) {
  const inScope = rows.filter((r) => r.in_scope);
  const streets = inScope.filter((r) => r.kind === 'street');
  const by: Record<string, number> = {};
  for (const r of streets) by[r.resolved_by] = (by[r.resolved_by] ?? 0) + 1;
  const resolved = streets.filter((r) => r.proposed).length;
  return {
    distinctSegments: rows.length,
    inScopeSegments: inScope.length,
    inScopeStreetSegments: streets.length,
    inScopeVillageSegments: inScope.filter((r) => r.kind === 'village').length,
    outOfScopeSegments: rows.length - inScope.length,
    resolvedByStep: by,
    resolvedStreetSegments: resolved,
    resolutionRate: streets.length ? resolved / streets.length : null,
  };
}
