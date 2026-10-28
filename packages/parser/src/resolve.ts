import { SCORING } from '../data/scoring.ts';
import { stems } from './forms.ts';
import { StreetIndex, type Resolution } from './gazetteer.ts';
import type { NisMunicipality, NisStreet } from './osm.ts';
import type { HouseRange } from './ranges.ts';
import {
  distinctiveToken,
  haversineMeters,
  jaroWinkler,
  setSimilarity,
  trigramSimilarity,
  trigrams,
} from './similarity.ts';

// `placed`: the name belongs to several streets (same name, different places) and the row's
// municipality or its other streets decided which. `ambiguous`: they could not, so every one of them
// is a candidate (the matcher alerts all of them as "Moguće": a false alarm over a miss).
export type LadderStep =
  | 'exact'
  | 'alias'
  | 'form'
  | 'fuzzy'
  | 'heuristic'
  | 'scored'
  | 'placed'
  | 'ambiguous'
  | 'unresolved';

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
  // Streets that share one normalized name, by that name (only names with two or more).
  private readonly siblings = new Map<string, NisStreet[]>();
  // Trigram sets of every gazetteer name, computed once (the fuzzy step scans all streets).
  private readonly trigramSets = new Map<string, Set<string>>();

  // No constructor parameter properties: Node's type stripping (scripts) cannot run them.
  constructor(streets: readonly NisStreet[]) {
    this.streets = streets;
    this.index = new StreetIndex(streets);
    for (const s of streets) {
      this.byId.set(s.id, s);
      const same = this.siblings.get(s.nameNorm);
      if (same) same.push(s);
      else this.siblings.set(s.nameNorm, [s]);
      const norms = [s.nameNorm, ...(s.altNorms ?? [])];
      this.allNorms.set(s, norms);
      this.stemSets.set(s, new Set(norms.flatMap((n) => stems(n))));
      for (const n of norms) if (!this.trigramSets.has(n)) this.trigramSets.set(n, trigrams(n));
    }
    for (const [name, list] of this.siblings) if (list.length < 2) this.siblings.delete(name);
  }

  resolve(segNorm: string, ctx: ResolveContext = {}): LadderResult {
    // 2. Alias (human-confirmed or earlier auto-accepted).
    const aliasId = ctx.aliases?.get(segNorm);
    if (aliasId !== undefined) {
      const street = this.byId.get(aliasId);
      // An alias names a street, and the name may belong to several: place it like any such name.
      const same = street ? this.siblings.get(street.nameNorm) : undefined;
      if (same) return this.place(same, ctx);
      if (street) return { by: 'alias', street, score: 1, candidates: [] };
    }

    // A segment without a single letter ("3", "12-14") is a house number, never a street name.
    if (!/[a-z]/.test(segNorm))
      return { by: 'unresolved', street: null, score: null, candidates: [] };

    // 1, forms, numbers-as-words: exact name, generated case forms, number canonicalization.
    const direct = this.index.resolve(segNorm);
    let pool: NisStreet[] = [];
    if (direct.street) {
      const by = direct.by === 'heuristic' ? 'heuristic' : direct.by === 'form' ? 'form' : 'exact';
      return { by, street: direct.street as NisStreet, score: 1, candidates: [] };
    }
    if (direct.by === 'ambiguous') {
      const matches = direct.matches as NisStreet[];
      // Several streets with the very same name: a question of place, not of spelling.
      if (matches.every((m) => m.nameNorm === matches[0]?.nameNorm))
        return this.place(matches, ctx);
      pool = matches;
    }

    // 3. Fuzzy: trigram similarity, own municipality first, then the whole city.
    const fuzzy = this.fuzzy(segNorm, ctx.municipality ?? null);
    if (fuzzy.accepted) {
      return this.accept('fuzzy', fuzzy.accepted.streets, fuzzy.accepted.sim, ctx);
    }
    pool = [...pool, ...fuzzy.pool];

    // 4. Deterministic rewrites; accepted only when exactly one street results.
    const heuristic = this.heuristic(segNorm);
    if (heuristic) return this.accept('heuristic', heuristic, 0.8, ctx);
    // The segment is only a word or two of another street's name ("мишића", "топлице"): that is a
    // proposal, not an answer. It is accepted only when the row's other streets confirm it spatially;
    // otherwise it goes on as a candidate (scoring, review queue, "Moguće").
    const part = this.partOfName(segNorm);
    if (part && this.partAccepted(segNorm, part, ctx)) {
      return this.accept('heuristic', part, 0.8, ctx);
    }

    // 5. Candidate scoring with spatial context.
    for (const c of this.index.candidates(segNorm, SCORING.candidateLimit))
      pool.push(c.street as NisStreet);
    return this.score(segNorm, [...new Set(pool)], ctx);
  }

  // One street: accepted as it is. Several streets with one name: a question of place.
  private accept(
    by: 'fuzzy' | 'heuristic',
    streets: readonly NisStreet[],
    score: number,
    ctx: ResolveContext,
  ): LadderResult {
    if (streets.length === 1) return { by, street: streets[0] as NisStreet, score, candidates: [] };
    return this.place(streets, ctx);
  }

  /**
   * Which of several streets with one name is meant: first by the municipality of the EDS row, then
   * by how close each is to the streets already resolved in the same row (one row = one area). When
   * neither settles it, none is chosen and every one is a candidate.
   */
  private place(streets: readonly NisStreet[], ctx: ResolveContext): LadderResult {
    let pool = [...streets];
    if (ctx.municipality) {
      const local = pool.filter((s) =>
        s.municipalities.includes(ctx.municipality as NisMunicipality),
      );
      if (local.length === 1) return this.placed(local[0] as NisStreet);
      if (local.length > 1) pool = local;
    }
    const anchors = (ctx.anchors ?? []).filter((a) => !pool.includes(a));
    if (anchors.length > 0) {
      const ranked = pool
        .map((street) => ({ street, meters: this.distanceTo(street, anchors) }))
        .sort((a, b) => a.meters - b.meters);
      const [nearest, next] = ranked;
      if (
        nearest &&
        nearest.meters <= SCORING.placeMaxMeters &&
        (!next || next.meters - nearest.meters >= SCORING.placeLeadMeters)
      ) {
        return this.placed(nearest.street);
      }
    }
    return {
      by: 'ambiguous',
      street: null,
      score: null,
      candidates: pool.map((street) => ({ street, score: 1, features: {} })),
    };
  }

  private placed(street: NisStreet): LadderResult {
    return { by: 'placed', street, score: 1, candidates: [] };
  }

  // The shortest distance, in metres, between a street and any of the anchors.
  private distanceTo(street: NisStreet, anchors: readonly NisStreet[]): number {
    let mine = this.vertices.get(street);
    if (!mine) this.vertices.set(street, (mine = sampleVertices(street)));
    let best = Infinity;
    for (const a of anchors) {
      let theirs = this.vertices.get(a);
      if (!theirs) this.vertices.set(a, (theirs = sampleVertices(a)));
      for (const p of mine) for (const q of theirs) best = Math.min(best, haversineMeters(p, q));
    }
    return best;
  }

  private bestSimilarity(segTrigrams: ReadonlySet<string>, street: NisStreet): number {
    let best = 0;
    for (const n of this.allNorms.get(street) ?? []) {
      best = Math.max(best, setSimilarity(segTrigrams, this.trigramSets.get(n) ?? new Set()));
    }
    return best;
  }

  private fuzzy(
    segNorm: string,
    municipality: NisMunicipality | null,
  ): { accepted: { streets: NisStreet[]; sim: number } | null; pool: NisStreet[] } {
    const hits: { street: NisStreet; sim: number }[] = [];
    const sims: { street: NisStreet; sim: number }[] = [];
    const near: NisStreet[] = [];
    const sortedSeg = segNorm.split(' ').filter(Boolean).sort().join(' ');
    const segTrigrams = trigrams(segNorm);
    for (const s of this.streets) {
      const sim = this.bestSimilarity(segTrigrams, s);
      if (sim >= SCORING.candidateMinSimilarity) sims.push({ street: s, sim });
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
    // One name (it may be several streets that share it: that is decided by `place`).
    const only = distinctNames(chosen.map((h) => h.street)) === 1 ? (chosen[0] ?? null) : null;
    // A fuzzy accept needs a clear lead: if another street is almost as similar ("Првог" vs
    // "Другог српског устанка"), a wrong accept would be a false alarm, so go on to scoring.
    const rival = sims.some(
      (x) =>
        only !== null &&
        x.street.nameNorm !== only.street.nameNorm &&
        only.sim - x.sim < SCORING.fuzzyMargin,
    );
    // Same rule as scoring: a name that fits two or more streets is not a fuzzy accept.
    const ambiguous = distinctNames(this.containing(segNorm)) >= 2;
    return {
      accepted:
        only && !rival && !ambiguous
          ? { streets: chosen.map((h) => h.street), sim: only.sim }
          : null,
      pool: near,
    };
  }

  // The streets a rewrite of the segment points to: all of one name (one street, or several that
  // share it), or null when the rewrite is not clearly one name.
  private heuristic(segNorm: string): NisStreet[] | null {
    const oneName = (streets: readonly NisStreet[]): NisStreet[] | null => {
      const list = [...new Set(streets)];
      return list.length > 0 && distinctNames(list) === 1 ? list : null;
    };
    const named = (r: Resolution): NisStreet[] =>
      r.street ? [r.street as NisStreet] : r.by === 'ambiguous' ? (r.matches as NisStreet[]) : [];
    const tokens = segNorm.split(' ').filter(Boolean);
    // Stray бб / б.б.
    const withoutBb = tokens.filter((t) => t !== 'bb');
    if (withoutBb.length !== tokens.length && withoutBb.length > 0) {
      const found = oneName(named(this.index.resolve(withoutBb.join(' '))));
      if (found) return found;
    }
    // Swapped word order: "pasica nikole" -> "nikole pasica".
    if (tokens.length >= 2 && tokens.length <= MAX_PERMUTED_TOKENS) {
      const found: NisStreet[] = [];
      for (const p of permutations(tokens)) {
        const joined = p.join(' ');
        if (joined === segNorm) continue;
        found.push(...named(this.index.resolve(joined)));
      }
      const swapped = oneName(found);
      if (swapped) return swapped;
    }
    return null;
  }

  // Missing first name or title: every token of the segment is in exactly one street (name). Only a
  // proposal (see `resolve`).
  private partOfName(segNorm: string): NisStreet[] | null {
    const list = [...new Set(this.containing(segNorm))];
    return list.length > 0 && distinctNames(list) === 1 ? list : null;
  }

  // May a segment that is only some words of a street's name be accepted? Only when the row confirms
  // it spatially, and (1) not too many street names contain those words (a generic word such as
  // "прилаз" is no place), and, when it is the only name that contains them, (2) no street of
  // another name sounds like the segment itself (a typo of "Топличка" is not "Милана Топлице").
  private partAccepted(
    segNorm: string,
    streets: readonly NisStreet[],
    ctx: ResolveContext,
  ): boolean {
    const name = streets[0]?.nameNorm;
    if (name === undefined) return false;
    const containing = this.containing(segNorm);
    if (distinctNames(containing) > SCORING.partialMaxNames) return false;
    if (distinctNames(containing) <= 1) {
      const grams = trigrams(segNorm);
      for (const other of this.streets) {
        if (other.nameNorm === name) continue;
        if (this.bestSimilarity(grams, other) >= SCORING.candidateMinSimilarity) return false;
      }
    }
    return this.confirmedBy(streets, ctx);
  }

  // Does the row confirm the proposal: is the street within reach of a street already resolved in it?
  private confirmedBy(streets: readonly NisStreet[], ctx: ResolveContext): boolean {
    const anchors = ctx.anchors ?? [];
    if (anchors.length === 0) return false;
    return streets.some(
      (s) =>
        this.distanceTo(
          s,
          anchors.filter((a) => a !== s),
        ) <= SCORING.partialConfirmMeters,
    );
  }

  // The segment is only some of the words of the street's name (not the name in any form).
  private isPartialName(segNorm: string, street: NisStreet): boolean {
    if ((this.allNorms.get(street) ?? []).includes(segNorm)) return false;
    const have = this.stemSets.get(street);
    const segStems = stems(segNorm).filter((t) => t.length >= 3);
    return (
      have !== undefined &&
      segStems.length > 0 &&
      segStems.every((t) => have.has(t)) &&
      have.size > segStems.length
    );
  }

  // Streets whose words include every word of the segment ("мишића" is in "Војводе Мишића").
  private containing(segNorm: string): NisStreet[] {
    const segStems = stems(segNorm).filter((t) => t.length >= 3);
    if (segStems.length === 0 || !segStems.some((t) => t.length >= 4)) return [];
    return this.streets.filter((s) => {
      const have = this.stemSets.get(s);
      return have !== undefined && segStems.every((t) => have.has(t));
    });
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
      // Share of the segment's words that the street contains: "мишића" is fully contained in
      // "Војводе Мишића" even though the two strings differ a lot.
      const segStems = stems(segNorm);
      const have = this.stemSets.get(street);
      const containment =
        segStems.length > 0 && have
          ? segStems.filter((t) => have.has(t)).length / segStems.length
          : 0;
      let similarity = containment;
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
    const best = top5[0];
    // The runner-up is the best street of another name: a street of the same name is not a rival.
    const rival = scored.find((c) => best && c.street.nameNorm !== best.street.nameNorm);
    // A bare name that fits several streets ("Новака") is only decidable from where the other
    // streets of the same row are; without that context, leave it for review.
    const needsContext =
      distinctNames(this.containing(segNorm)) >= 2 && (ctx.anchors ?? []).length === 0;
    if (
      best &&
      !needsContext &&
      best.score >= SCORING.acceptScore &&
      (!rival || best.score - rival.score >= SCORING.minMargin)
    ) {
      // Only some words of the street's name: a proposal that the row has to confirm.
      if (
        this.isPartialName(segNorm, best.street) &&
        !this.partAccepted(segNorm, this.siblings.get(best.street.nameNorm) ?? [best.street], ctx)
      ) {
        return { by: 'unresolved', street: null, score: null, candidates: top5 };
      }
      // The best street may share its name with others: which of them is a question of place.
      const same = this.siblings.get(best.street.nameNorm);
      if (same) return this.place(same, ctx);
      return { by: 'scored', street: best.street, score: best.score, candidates: top5 };
    }
    return { by: 'unresolved', street: null, score: null, candidates: top5 };
  }
}

// How many different names a set of streets has (streets of one name in different places count once).
function distinctNames(streets: readonly NisStreet[]): number {
  return new Set(streets.map((s) => s.nameNorm)).size;
}
