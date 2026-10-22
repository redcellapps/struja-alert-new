import {
  nisMunicipality,
  normalizeName,
  Resolver,
  splitUlice,
  StreetIndex,
  type LadderResult,
  type NisGazetteer,
  type NisStreet,
  type PageRow,
  type ParsedPage,
} from '@struja/parser';

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

function fmtCandidates(r: LadderResult): string {
  return r.candidates
    .slice(0, 3)
    .map((c) => `${c.street.name} (${c.score.toFixed(2)})`)
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

      // Pass 1: no spatial context. Pass 2: unresolved segments, with the row's other streets.
      const results = new Map<number, LadderResult>();
      const anchors: NisStreet[] = [];
      if (inScope) {
        segments.forEach((seg, i) => {
          if (seg.village) return;
          const r = resolver.resolve(normalizeName(seg.name), {
            municipality,
            ranges: seg.ranges,
            addressNumbers,
          });
          results.set(i, r);
          if (r.street) anchors.push(r.street);
        });
        segments.forEach((seg, i) => {
          const first = results.get(i);
          if (seg.village || !first || first.street) return;
          results.set(
            i,
            resolver.resolve(normalizeName(seg.name), {
              municipality,
              anchors,
              ranges: seg.ranges,
              addressNumbers,
            }),
          );
        });
      }

      segments.forEach((seg, i) => {
        const name = normalizeName(seg.name);
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
        if (inScope) {
          if (seg.village) {
            kind = 'village';
            const v = settlements.resolve(name);
            proposed = v.street?.name ?? '';
            resolvedBy = v.by;
            candidates = v.candidates
              .slice(0, 3)
              .map((c) => c.street.name)
              .join('; ');
          } else {
            kind = 'street';
            const r = results.get(i);
            if (r) {
              proposed = r.street?.name ?? '';
              resolvedBy = r.by;
              score = r.score === null ? '' : r.score.toFixed(2);
              candidates = fmtCandidates(r);
            }
          }
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

function cell(v: string | number | boolean): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

// `confirmed` and `notes` are left empty for the reviewer: put the correct street (or "ok" when
// the proposal is right, "none" when the segment names no street) in `confirmed`.
export function toCsv(rows: readonly LabelRow[]): string {
  const head = [...COLUMNS, 'confirmed', 'notes'].join(',');
  const lines = rows.map((r) => [...COLUMNS.map((c) => cell(r[c])), '', ''].join(','));
  return [head, ...lines].join('\n') + '\n';
}

export interface AliasSeedEntry {
  raw: string;
  raw_norm: string;
  street: string;
  source: string;
  confidence: number;
}

// Aliases worth reviewing: matches that were not a plain exact name. Keyed by the street's OSM
// name, because gazetteer ids are not stable between builds.
export function aliasSeed(rows: readonly LabelRow[]): AliasSeedEntry[] {
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
