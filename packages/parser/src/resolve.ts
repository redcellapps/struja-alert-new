import { SCORING } from '../data/scoring.ts';
import { stems } from './forms.ts';
import { StreetIndex } from './gazetteer.ts';
import type { NisMunicipality, NisStreet } from './osm.ts';
import type { HouseRange } from './ranges.ts';
import { distinctiveToken, haversineMeters, jaroWinkler, trigramSimilarity } from './similarity.ts';

export type LadderStep =
  'exact' | 'alias' | 'form' | 'fuzzy' | 'heuristic' | 'scored' | 'unresolved';

export interface ScoredCandidate {
  street: NisStreet;
  score: number;
  features: Record<string, number>;
}

export interface LadderResult {
  by: LadderStep;
  street: NisStreet | null;
  // 1 for exact/alias/form, the similarity for fuzzy, the weighted score for scored.
  score: number | null;
  // Top candidates with scores; filled for scored and unresolved results.
  candidates: ScoredCandidate[];
}

export interface ResolveContext {
  // Municipality of the EDS row (one of the five), if known.
  municipality?: NisMunicipality | null;
  // Streets already resolved in the same EDS row: one row = one area fed by one substation.
  anchors?: readonly NisStreet[];
  // House ranges attached to this segment.
  ranges?: readonly HouseRange[];
  // raw_norm -> street id, from confirmed aliases.
  aliases?: ReadonlyMap<string, string | number>;
  // normalized street name -> house numbers known in OSM.
  addressNumbers?: ReadonlyMap<string, ReadonlySet<number>>;
}

const MAX_PERMUTED_TOKENS = 4;

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const p of permutations(rest)) out.push([item, ...p]);
  });
  return out;
}

function sampleVertices(street: NisStreet, max = 40): [number, number][] {
  const all = street.lines.flat();
  if (all.length <= max) return all;
  const step = all.length / max;
  return Array.from({ length: max }, (_, i) => all[Math.floor(i * step)] as [number, number]);
}

export class Resolver {
  private readonly streets: readonly NisStreet[];
  private readonly index: StreetIndex;
  private readonly byId = new Map<string | number, NisStreet>();
  private readonly stemSets = new Map<NisStreet, Set<string>>();
  private readonly allNorms = new Map<NisStreet, string[]>();
  private readonly vertices = new Map<NisStreet, [number, number][]>();

  // No constructor parameter properties: Node's type stripping (scripts) cannot run them.
  constructor(streets: readonly NisStreet[]) {
    this.streets = streets;
    this.index = new StreetIndex(streets);
    for (const s of streets) {
      this.byId.set(s.id, s);
      const norms = [s.nameNorm, ...(s.altNorms ?? [])];
      this.allNorms.set(s, norms);
      this.stemSets.set(s, new Set(norms.flatMap((n) => stems(n))));
    }
  }

  resolve(segNorm: string, ctx: ResolveContext = {}): LadderResult {
    // 2. Alias (human-confirmed or earlier auto-accepted).
    const aliasId = ctx.aliases?.get(segNorm);
    if (aliasId !== undefined) {
      const street = this.byId.get(aliasId);
      if (street) return { by: 'alias', street, score: 1, candidates: [] };
    }

    // 1, forms, numbers-as-words: exact name, generated case forms, number canonicalization.
    const direct = this.index.resolve(segNorm);
    let pool: NisStreet[] = [];
    if (direct.street) {
      const by = direct.by === 'heuristic' ? 'heuristic' : direct.by === 'form' ? 'form' : 'exact';
      return { by, street: direct.street as NisStreet, score: 1, candidates: [] };
    }
    if (direct.by === 'ambiguous') pool = direct.matches as NisStreet[];

    // 3. Fuzzy: trigram similarity, own municipality first, then the whole city.
    const fuzzy = this.fuzzy(segNorm, ctx.municipality ?? null);
    if (fuzzy.accepted) {
      return {
        by: 'fuzzy',
        street: fuzzy.accepted.street,
        score: fuzzy.accepted.sim,
        candidates: [],
      };
    }
    pool = [...pool, ...fuzzy.pool];

    // 4. Deterministic rewrites; accepted only when exactly one street results.
    const heuristic = this.heuristic(segNorm);
    if (heuristic) return { by: 'heuristic', street: heuristic, score: 0.8, candidates: [] };

    // 5. Candidate scoring with spatial context.
    for (const c of this.index.candidates(segNorm, SCORING.candidateLimit))
      pool.push(c.street as NisStreet);
    return this.score(segNorm, [...new Set(pool)], ctx);
  }

  private bestSimilarity(segNorm: string, street: NisStreet): number {
    let best = 0;
    for (const n of this.allNorms.get(street) ?? [])
      best = Math.max(best, trigramSimilarity(segNorm, n));
    return best;
  }

  private fuzzy(
    segNorm: string,
    municipality: NisMunicipality | null,
  ): { accepted: { street: NisStreet; sim: number } | null; pool: NisStreet[] } {
    const hits: { street: NisStreet; sim: number }[] = [];
    const near: NisStreet[] = [];
    const sortedSeg = segNorm.split(' ').filter(Boolean).sort().join(' ');
    for (const s of this.streets) {
      const sim = this.bestSimilarity(segNorm, s);
      // Trigram similarity ignores word order, so a pure word swap scores 1.0. That belongs to
      // the heuristic step (and its audit label), not to fuzzy.
      const swapOnly = (this.allNorms.get(s) ?? []).some(
        (n) => n !== segNorm && n.split(' ').filter(Boolean).sort().join(' ') === sortedSeg,
      );
      if (sim >= SCORING.fuzzyThreshold && !swapOnly) hits.push({ street: s, sim });
      if (sim >= SCORING.candidateMinSimilarity) near.push(s);
    }
    const local = municipality
      ? hits.filter((h) => h.street.municipalities.includes(municipality))
      : [];
    const chosen = local.length > 0 ? local : hits;
    return { accepted: chosen.length === 1 ? (chosen[0] ?? null) : null, pool: near };
  }

  private heuristic(segNorm: string): NisStreet | null {
    const tokens = segNorm.split(' ').filter(Boolean);
    // Stray бб / б.б.
    const withoutBb = tokens.filter((t) => t !== 'bb');
    if (withoutBb.length !== tokens.length && withoutBb.length > 0) {
      const r = this.index.resolve(withoutBb.join(' '));
      if (r.street) return r.street as NisStreet;
    }
    // Swapped word order: "pasica nikole" -> "nikole pasica".
    if (tokens.length >= 2 && tokens.length <= MAX_PERMUTED_TOKENS) {
      const found = new Set<NisStreet>();
      for (const p of permutations(tokens)) {
        const joined = p.join(' ');
        if (joined === segNorm) continue;
        const r = this.index.resolve(joined);
        if (r.street) found.add(r.street as NisStreet);
      }
      if (found.size === 1) return [...found][0] ?? null;
    }
    // Missing first name or title: every token of the segment is in exactly one street.
    const segStems = stems(segNorm).filter((t) => t.length >= 3);
    if (segStems.length > 0 && segStems.some((t) => t.length >= 4)) {
      const containing = this.streets.filter((s) => {
        const have = this.stemSets.get(s);
        return have !== undefined && segStems.every((t) => have.has(t));
      });
      if (containing.length === 1) return containing[0] ?? null;
    }
    return null;
  }

  private proximity(street: NisStreet, anchors: readonly NisStreet[]): number {
    if (anchors.length === 0) return 0.5;
    let mine = this.vertices.get(street);
    if (!mine) this.vertices.set(street, (mine = sampleVertices(street)));
    if (mine.length === 0) return 0.3;
    let best = Infinity;
    for (const a of anchors) {
      if (a === street) continue;
      let theirs = this.vertices.get(a);
      if (!theirs) this.vertices.set(a, (theirs = sampleVertices(a)));
      for (const p of mine) for (const q of theirs) best = Math.min(best, haversineMeters(p, q));
    }
    return Number.isFinite(best) ? Math.exp(-best / SCORING.proximityScaleMeters) : 0.5;
  }

  private houseNumber(street: NisStreet, ctx: ResolveContext): number {
    const ranges = (ctx.ranges ?? []).filter((r) => r.from !== null && r.to !== null);
    if (ranges.length === 0 || !ctx.addressNumbers) return 0.5;
    let known: ReadonlySet<number> | undefined;
    for (const n of this.allNorms.get(street) ?? []) {
      known = ctx.addressNumbers.get(n);
      if (known) break;
    }
    if (!known) return 0.5;
    for (const n of known) {
      if (ranges.some((r) => n >= (r.from as number) && n <= (r.to as number))) return 1;
    }
    return 0;
  }

  private score(segNorm: string, pool: NisStreet[], ctx: ResolveContext): LadderResult {
    const W = SCORING.weights;
    const distinctive = distinctiveToken(segNorm);
    const scored: ScoredCandidate[] = pool.map((street) => {
      let similarity = 0;
      let distinctiveSim = 0;
      for (const n of this.allNorms.get(street) ?? []) {
        similarity = Math.max(similarity, trigramSimilarity(segNorm, n), jaroWinkler(segNorm, n));
        for (const t of n.split(' '))
          distinctiveSim = Math.max(distinctiveSim, jaroWinkler(distinctive, t));
      }
      const municipality = !ctx.municipality
        ? 0.5
        : street.municipalities.length === 0
          ? 0.5
          : street.municipalities.includes(ctx.municipality)
            ? 1
            : 0;
      const proximity = this.proximity(street, ctx.anchors ?? []);
      const houseNumber = this.houseNumber(street, ctx);
      const features = {
        similarity,
        distinctive: distinctiveSim,
        municipality,
        proximity,
        houseNumber,
      };
      const score =
        W.similarity * similarity +
        W.distinctive * distinctiveSim +
        W.municipality * municipality +
        W.proximity * proximity +
        W.houseNumber * houseNumber;
      return { street, score, features };
    });
    scored.sort((a, b) => b.score - a.score);
    const top5 = scored.slice(0, 5);
    const [best, second] = top5;
    if (
      best &&
      best.score >= SCORING.acceptScore &&
      (!second || best.score - second.score >= SCORING.minMargin)
    ) {
      return { by: 'scored', street: best.street, score: best.score, candidates: top5 };
    }
    return { by: 'unresolved', street: null, score: null, candidates: top5 };
  }
}
