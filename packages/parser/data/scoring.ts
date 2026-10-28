// Hand-tuned starting values for the step-5 candidate scoring (BRIEF §3). Once about 200
// confirmed examples exist, a nightly job refits `weights` and the thresholds from them.
// These numbers have NOT been tuned on real EDS labels yet (too few in-scope segments so far).
// PROVISIONAL by decision (22 Oct 2026): freeze them only after the Phase 1 gate passes
// (`pnpm --filter @struja/scripts gate-report`) and before the Phase 5 live run.
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
  // ... and it must lead every other street by at least this much.
  fuzzyMargin: 0.1,
  // Candidates for scoring: trigram similarity floor and list size.
  candidateMinSimilarity: 0.5,
  candidateLimit: 10,
  // Proximity decays as exp(-distance / scale).
  proximityScaleMeters: 1500,
  // Streets that share a name: one is chosen by its distance to the other streets of the EDS row only
  // when it is within this far of them and at least this much nearer than the next one.
  placeMaxMeters: 3000,
  placeLeadMeters: 1500,
  // A segment that is only some words of another street's name ("мишића" for "Војводе Мишића") is a
  // proposal: it is accepted only when the street lies within this far of a street already resolved
  // in the same EDS row.
  partialConfirmMeters: 1500,
  // ... and no more than this many street names may contain those words ("прилаз" is in dozens).
  partialMaxNames: 3,
} as const;
