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
  // The settlement of the street, to tell streets that share a name apart.
  settlement?: string;
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
  // The streets each segment is still undecided between (names that several streets share).
  const undecided = new Map<number, NisStreet[]>();
  const ladder = (i: number, withAnchors: boolean, extra: readonly NisStreet[] = []) => {
    const res = out[i];
    if (!res || res.kind !== 'street') return;
    const r = deps.resolver.resolve(normalizeName(res.segment.name), {
      municipality: deps.municipality,
      ranges: res.segment.ranges,
      aliases: deps.aliases,
      addressNumbers: deps.addressNumbers,
      anchors: withAnchors ? [...anchors, ...extra] : undefined,
    });
    if (r.by === 'ambiguous')
      undecided.set(
        i,
        r.candidates.map((c) => c.street),
      );
    else undecided.delete(i);
    res.by = r.by;
    res.street = r.street;
    res.score = r.score;
    res.candidates = r.candidates.map((c) => ({
      id: c.street.id,
      name: c.street.name,
      score: c.score,
      ...(c.street.settlement ? { settlement: c.street.settlement } : {}),
    }));
  };

  segments.forEach((_, i) => {
    ladder(i, false);
    const street = out[i]?.street;
    if (street) anchors.push(street);
  });
  // Pass 2, twice: a street placed in the first round is itself context for a same-named one.
  for (let round = 0; round < 2; round++) {
    out.forEach((res, i) => {
      if (res.kind !== 'street' || res.street) return;
      ladder(i, true);
      if (res.street) anchors.push(res.street);
    });
  }
  // Names that are still ambiguous lean on each other: two same-named streets that lie next to each
  // other are the pair this row means (the candidates of the others count as context).
  for (const i of [...undecided.keys()]) {
    const res = out[i];
    if (!res || res.street) continue;
    const others = [...undecided.entries()].filter(([j]) => j !== i).flatMap(([, list]) => list);
    ladder(i, true, others);
    if (res.street) anchors.push(res.street);
  }

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
