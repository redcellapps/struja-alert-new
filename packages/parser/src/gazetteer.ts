import { generateForms, stems } from './forms.ts';
import { normalizeName } from './normalize.ts';

export interface GazStreet {
  id: string | number;
  name: string;
  nameNorm: string;
  municipality?: string | null;
}

export interface Candidate {
  street: GazStreet;
  // Share of stems in common (Jaccard), 0..1. A rough recall filter, not a match score.
  overlap: number;
}

export type ResolvedBy = 'exact' | 'form' | 'ambiguous' | 'unresolved';

export interface Resolution {
  by: ResolvedBy;
  street: GazStreet | null;
  // Every street that matched (several when ambiguous) or, when unresolved, stem candidates.
  matches: GazStreet[];
  candidates: Candidate[];
}

/**
 * In-memory gazetteer lookup: exact name_norm, then forward-generated case forms, with reverse
 * stemming used only to collect candidates for the scoring step.
 */
export class StreetIndex {
  private readonly exactMap = new Map<string, GazStreet[]>();
  private readonly formMap = new Map<string, GazStreet[]>();
  private readonly stemMap = new Map<string, GazStreet[]>();
  private readonly stemsOf = new Map<GazStreet, Set<string>>();

  constructor(streets: readonly GazStreet[]) {
    for (const s of streets) {
      push(this.exactMap, s.nameNorm, s);
      for (const f of generateForms(s.nameNorm)) push(this.formMap, f, s);
      const st = new Set(stems(s.nameNorm));
      this.stemsOf.set(s, st);
      for (const t of st) push(this.stemMap, t, s);
    }
  }

  static fromNames(names: readonly string[]): StreetIndex {
    return new StreetIndex(
      names.map((name, i) => ({ id: i, name, nameNorm: normalizeName(name) })),
    );
  }

  resolve(nameNorm: string, limit = 10): Resolution {
    const exact = this.exactMap.get(nameNorm);
    if (exact) return decide('exact', exact);
    const form = this.formMap.get(nameNorm);
    if (form) return decide('form', form);
    return {
      by: 'unresolved',
      street: null,
      matches: [],
      candidates: this.candidates(nameNorm, limit),
    };
  }

  candidates(nameNorm: string, limit = 10): Candidate[] {
    const want = new Set(stems(nameNorm));
    const seen = new Set<GazStreet>();
    for (const t of want) for (const s of this.stemMap.get(t) ?? []) seen.add(s);
    const out: Candidate[] = [];
    for (const street of seen) {
      const have = this.stemsOf.get(street) ?? new Set<string>();
      let common = 0;
      for (const t of want) if (have.has(t)) common++;
      const overlap = common / (want.size + have.size - common);
      out.push({ street, overlap });
    }
    return out.sort((a, b) => b.overlap - a.overlap).slice(0, limit);
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (!list) map.set(key, [value]);
  else if (!list.includes(value)) list.push(value);
}

function decide(by: 'exact' | 'form', matches: GazStreet[]): Resolution {
  // Several streets under one normalized form (or one form shared by two streets) is never
  // auto-accepted here; it goes on to scoring.
  if (matches.length === 1) return { by, street: matches[0] ?? null, matches, candidates: [] };
  return { by: 'ambiguous', street: null, matches, candidates: [] };
}
