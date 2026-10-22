// Hand-tuned starting values for the step-5 candidate scoring (BRIEF §3). Once about 200
// confirmed examples exist, a nightly job refits `weights` and the thresholds from them.
// These numbers have NOT been tuned on real EDS labels yet (too few in-scope segments so far).
export const SCORING = {
  weights: {
    similarity: 0.5, // trigram / Jaro-Winkler on the whole name
    distinctive: 0.15, // Jaro-Winkler on the most distinctive token (usually the surname)
    municipality: 0.1, // same municipality as the EDS row
    proximity: 0.2, // near the other streets already resolved in the same EDS row
    houseNumber: 0.05, // the row's house numbers exist on that street in OSM
  },
  // Auto-accept only when the best candidate clears this score AND leads the runner-up by the margin.
  acceptScore: 0.8,
  minMargin: 0.1,
  // Step 3: pg_trgm-style similarity needed for a fuzzy accept.
  fuzzyThreshold: 0.85,
  // Candidates for scoring: trigram similarity floor and list size.
  candidateMinSimilarity: 0.5,
  candidateLimit: 10,
  // Proximity decays as exp(-distance / scale).
  proximityScaleMeters: 1500,
} as const;
