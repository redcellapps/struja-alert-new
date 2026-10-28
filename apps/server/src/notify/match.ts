import type { PossibleReason } from '@struja/shared';

// Matching a saved address against what an outage affects (BRIEF §3). Prefer false positives to
// false negatives: when in doubt the result is "possibly affected", never "not affected".
export interface SubscriptionTarget {
  streetId: number | null;
  settlementId: number | null;
  // The user's house number, if they gave one.
  houseNumber: number | null;
}

export interface CandidateRef {
  id: number | string;
  name?: string;
  score: number;
}

// One outage_street row: a segment (and, when it has house ranges, one range of it).
export interface OutageStreetRow {
  segmentIndex: number;
  streetId: number | null;
  settlementId: number | null;
  // "делови X": only part of the street is affected.
  partial: boolean;
  houseFrom: number | null;
  houseTo: number | null;
  houseRaw: string | null;
  parity: 'odd' | 'even' | null;
  resolvedBy: string;
  candidates: CandidateRef[] | null;
}

export type MatchResult =
  { kind: 'affected' } | { kind: 'possible'; reason: PossibleReason } | null;

// A segment still unresolved shortly before the outage notifies the people whose street is among
// its candidates with at least this score (BRIEF §3 safety net).
export const SAFETY_NET_MIN_SCORE = 0.6;

function inRange(n: number, r: OutageStreetRow): boolean {
  if (r.houseFrom === null || r.houseTo === null) {
    // parity only ("парни"): every odd/even number on the street
    return r.parity !== null && !r.houseRaw?.match(/бб|bb/i) && parityOk(n, r);
  }
  return n >= r.houseFrom && n <= r.houseTo && parityOk(n, r);
}

function parityOk(n: number, r: OutageStreetRow): boolean {
  if (r.parity === null) return true;
  return r.parity === 'odd' ? n % 2 === 1 : n % 2 === 0;
}

function matchSegment(sub: SubscriptionTarget, rows: OutageStreetRow[]): MatchResult {
  const ranged = rows.filter((r) => r.houseRaw !== null);
  if (ranged.length === 0) {
    // No house ranges: the whole street, unless the notice only names parts of it.
    return rows.some((r) => r.partial)
      ? { kind: 'possible', reason: 'partial' }
      : { kind: 'affected' };
  }
  if (sub.houseNumber === null) return { kind: 'possible', reason: 'no_number' };
  return ranged.some((r) => inRange(sub.houseNumber as number, r)) ? { kind: 'affected' } : null;
}

/**
 * Is this saved address affected by the outage whose resolved segments are `rows`?
 * `safetyNet` also considers segments that were never resolved, through their stored candidates.
 */
export function matchSubscription(
  sub: SubscriptionTarget,
  rows: readonly OutageStreetRow[],
  opts: { safetyNet?: boolean } = {},
): MatchResult {
  let best: MatchResult = null;
  const consider = (r: MatchResult) => {
    if (!r) return;
    if (r.kind === 'affected' || best === null) best = r;
  };

  const bySegment = new Map<number, OutageStreetRow[]>();
  for (const r of rows) {
    const list = bySegment.get(r.segmentIndex) ?? [];
    list.push(r);
    bySegment.set(r.segmentIndex, list);
  }

  for (const seg of bySegment.values()) {
    const first = seg[0];
    if (!first) continue;
    const resolvedHere =
      (sub.streetId !== null && first.streetId === sub.streetId) ||
      (sub.settlementId !== null && first.settlementId === sub.settlementId);
    if (resolvedHere) {
      consider(matchSegment(sub, seg));
      continue;
    }
    // A name that several streets share, and the notice could not say which: every one of those
    // streets may be meant, so a saved address on any of them is "possibly affected" (a false alarm
    // over a miss). Not only in the safety net: this is the decision itself.
    if (
      first.resolvedBy === 'ambiguous' &&
      first.streetId === null &&
      sub.streetId !== null &&
      (first.candidates ?? []).some((c) => Number(c.id) === sub.streetId)
    ) {
      consider({ kind: 'possible', reason: 'same_name' });
      continue;
    }
    if (
      opts.safetyNet &&
      first.streetId === null &&
      first.settlementId === null &&
      first.resolvedBy === 'unresolved' &&
      sub.streetId !== null &&
      (first.candidates ?? []).some(
        (c) => Number(c.id) === sub.streetId && c.score >= SAFETY_NET_MIN_SCORE,
      )
    ) {
      consider({ kind: 'possible', reason: 'unresolved' });
    }
  }
  return best;
}
