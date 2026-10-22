import { generateForms, stems } from './forms.ts';
import { normalizeName } from './normalize.ts';
import { canonicalizeNumbers } from './numbers.ts';

export interface GazStreet {
  id: string | number;
  name: string;
  nameNorm: string;
  // Other normalized names for the same street (alt_name, old_name, ...).
  altNorms?: string[];
  municipality?: string | null;
}

export interface Candidate {
  street: GazStreet;
  // Share of stems in common (Jaccard), 0..1. A rough recall filter, not a match score.
  overlap: number;
}

// `heuristic`: matched only after writing numbers as digits on both sides ("прилаз два" = "прилаз 2").
export type ResolvedBy = 'exact' | 'form' | 'heuristic' | 'ambiguous' | 'unresolved';

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
  private readonly numberMap = new Map<string, GazStreet[]>();
  private readonly stemMap = new Map<string, GazStreet[]>();
  private readonly stemsOf = new Map<GazStreet, Set<string>>();

  constructor(streets: readonly GazStreet[]) {
    for (const s of streets) {
      const st = new Set<string>();
      for (const norm of [s.nameNorm, ...(s.altNorms ?? [])]) {
        push(this.exactMap, norm, s);
        for (const f of generateForms(norm)) {
          push(this.formMap, f, s);
          push(this.numberMap, canonicalizeNumbers(f), s);
        }
        for (const t of stems(norm)) st.add(t);
      }
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
    // Numbers-as-words, but never for a name that is nothing but numbers ("3" is not "Трећа").
    const canon = canonicalizeNumbers(nameNorm);
    const numeric = /[a-z]/.test(canon) ? this.numberMap.get(canon) : undefined;
    if (numeric) return decide('heuristic', numeric);
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

function decide(by: 'exact' | 'form' | 'heuristic', matches: GazStreet[]): Resolution {
  // Several streets under one normalized form (or one form shared by two streets) is never
  // auto-accepted here; it goes on to scoring.
  if (matches.length === 1) return { by, street: matches[0] ?? null, matches, candidates: [] };
  return { by: 'ambiguous', street: null, matches, candidates: [] };
}
