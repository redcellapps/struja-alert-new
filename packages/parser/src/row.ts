import { StreetIndex } from './gazetteer.ts';
import type { NisMunicipality, NisSettlement, NisStreet } from './osm.ts';
import { normalizeName } from './normalize.ts';
import { Resolver, type LadderStep } from './resolve.ts';
import type { Segment } from './split.ts';

export interface RowDeps {
  resolver: Resolver;
  settlements: StreetIndex;
  // Municipality of the EDS row (one of the five), if known.
  municipality: NisMunicipality | null;
  // raw_norm -> street id from confirmed aliases.
  aliases?: ReadonlyMap<string, string | number>;
  // raw_norm -> settlement from confirmed village aliases.
  settlementAliases?: ReadonlyMap<string, NisSettlement>;
  // normalized street name -> house numbers known in OSM.
  addressNumbers?: ReadonlyMap<string, ReadonlySet<number>>;
}

export interface CandidateRef {
  id: string | number;
  name: string;
  score: number;
}

export interface SegmentResolution {
  segment: Segment;
  kind: 'street' | 'village';
  by: LadderStep;
  street: NisStreet | null;
  settlement: NisSettlement | null;
  score: number | null;
  // Top candidates, filled when the ladder did not settle on one street.
  candidates: CandidateRef[];
}

/**
 * Resolves every segment of one EDS row. One row is one area fed by one substation, so the
 * streets already resolved on the row are the spatial context for the segments the cheaper steps
 * could not place: pass 1 has no context, pass 2 retries the unresolved ones with the row's streets.
 */
export function resolveRow(segments: readonly Segment[], deps: RowDeps): SegmentResolution[] {
  const out: SegmentResolution[] = segments.map((segment) => ({
    segment,
    kind: segment.village ? 'village' : 'street',
    by: 'unresolved',
    street: null,
    settlement: null,
    score: null,
    candidates: [],
  }));

  const anchors: NisStreet[] = [];
  const ladder = (i: number, withAnchors: boolean) => {
    const res = out[i];
    if (!res || res.kind !== 'street') return;
    const r = deps.resolver.resolve(normalizeName(res.segment.name), {
      municipality: deps.municipality,
      ranges: res.segment.ranges,
      aliases: deps.aliases,
      addressNumbers: deps.addressNumbers,
      anchors: withAnchors ? anchors : undefined,
    });
    res.by = r.by;
    res.street = r.street;
    res.score = r.score;
    res.candidates = r.candidates.map((c) => ({
      id: c.street.id,
      name: c.street.name,
      score: c.score,
    }));
  };

  segments.forEach((_, i) => {
    ladder(i, false);
    const street = out[i]?.street;
    if (street) anchors.push(street);
  });
  out.forEach((res, i) => {
    if (res.kind === 'street' && !res.street) ladder(i, true);
  });

  // Villages and settlement parts resolve against the settlement list.
  out.forEach((res) => {
    if (res.kind !== 'village') return;
    const norm = normalizeName(res.segment.name);
    const pinned = deps.settlementAliases?.get(norm);
    if (pinned) {
      res.by = 'alias';
      res.settlement = pinned;
      res.score = 1;
      return;
    }
    const r = deps.settlements.resolve(norm);
    if (r.street) {
      res.by = r.by === 'form' ? 'form' : r.by === 'heuristic' ? 'heuristic' : 'exact';
      res.settlement = r.street as NisSettlement;
      res.score = 1;
    } else {
      const pool =
        r.by === 'ambiguous' ? r.matches.map((m) => ({ street: m, overlap: 1 })) : r.candidates;
      res.candidates = pool
        .slice(0, 5)
        .map((c) => ({ id: c.street.id, name: c.street.name, score: c.overlap }));
    }
  });
  return out;
}
