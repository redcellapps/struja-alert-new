// Pairing rows of one page with the rows they replace (BRIEF §4/§5 plus the review rules):
//
//  A. Same identity (city, municipality, date, street set), different time window: a changed time.
//  B. Same municipality, date and time window, overlapping but different street sets: the street
//     list was edited (streets added or removed).
//
// New rows (on this page, not stored before) are paired with old rows (stored, active, and no
// longer on the page). Pairs are made by the smallest difference; if the best assignment is not
// unique we do NOT guess: the whole bucket becomes an ambiguous group and the notifier sends one
// "Izmena" listing the new windows.
//
// KNOWN GAP 1 (handled here): two same-identity outages changing in one fetch, e.g. 08-10 and
// 14-16 both moving. We pair by the smallest total time shift; if that is still tied (08-10 and
// 10-12 both moving by the same amount) we form a group instead of guessing.
export interface PairRow {
  id: number;
  identityKey: string;
  municipality: string;
  date: string;
  startsAt: Date;
  endsAt: Date;
  // Normalized street names of the row.
  streets: ReadonlySet<string>;
}

export interface Pair {
  newId: number;
  oldId: number;
}
export interface Group {
  newIds: number[];
  oldIds: number[];
}
export interface PairResult {
  pairs: Pair[];
  groups: Group[];
}

const EPS = 1e-9;
// Beyond this many rows per bucket we stop enumerating and treat the bucket as ambiguous.
const MAX_BUCKET = 6;

interface Matching<N, O> {
  pairs: [N, O][];
  cost: number;
}

// Every matching of maximum size over the allowed pairs, with its total cost.
function matchings<N, O>(
  news: N[],
  olds: O[],
  allowed: (n: N, o: O) => boolean,
  cost: (n: N, o: O) => number,
): Matching<N, O>[] {
  const out: Matching<N, O>[] = [];
  const walk = (i: number, used: Set<number>, pairs: [N, O][], total: number) => {
    if (i === news.length) {
      out.push({ pairs: [...pairs], cost: total });
      return;
    }
    const n = news[i] as N;
    walk(i + 1, used, pairs, total); // leave this new row unmatched
    olds.forEach((o, j) => {
      if (used.has(j) || !allowed(n, o)) return;
      used.add(j);
      pairs.push([n, o]);
      walk(i + 1, used, pairs, total + cost(n, o));
      pairs.pop();
      used.delete(j);
    });
  };
  walk(0, new Set(), [], 0);
  const maxSize = Math.max(0, ...out.map((m) => m.pairs.length));
  return out.filter((m) => m.pairs.length === maxSize && maxSize > 0);
}

function solve<N extends PairRow, O extends PairRow>(
  news: N[],
  olds: O[],
  allowed: (n: N, o: O) => boolean,
  cost: (n: N, o: O) => number,
  result: PairResult,
): { usedNew: Set<number>; usedOld: Set<number> } {
  const usedNew = new Set<number>();
  const usedOld = new Set<number>();
  // Rows with at least one allowed partner; the others take no part.
  const involvedNew = news.filter((n) => olds.some((o) => allowed(n, o)));
  const involvedOld = olds.filter((o) => news.some((n) => allowed(n, o)));
  if (involvedNew.length === 0 || involvedOld.length === 0) return { usedNew, usedOld };

  const tooBig = involvedNew.length > MAX_BUCKET || involvedOld.length > MAX_BUCKET;
  const all = tooBig ? [] : matchings(involvedNew, involvedOld, allowed, cost);
  const min = all.length ? Math.min(...all.map((m) => m.cost)) : 0;
  const best = all.filter((m) => m.cost - min < EPS);

  if (!tooBig && best.length === 1) {
    for (const [n, o] of best[0]?.pairs ?? []) {
      result.pairs.push({ newId: n.id, oldId: o.id });
      usedNew.add(n.id);
      usedOld.add(o.id);
    }
  } else {
    // Tied (or too large): one group, no guessing.
    result.groups.push({
      newIds: involvedNew.map((n) => n.id),
      oldIds: involvedOld.map((o) => o.id),
    });
    involvedNew.forEach((n) => usedNew.add(n.id));
    involvedOld.forEach((o) => usedOld.add(o.id));
  }
  return { usedNew, usedOld };
}

const group = <T>(rows: T[], key: (r: T) => string) => {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return m;
};

export function pairChanges(news: PairRow[], olds: PairRow[]): PairResult {
  const result: PairResult = { pairs: [], groups: [] };
  const usedNew = new Set<number>();
  const usedOld = new Set<number>();

  // A. same identity: a changed time window. Smallest total shift wins.
  const oldsByIdentity = group(olds, (o) => o.identityKey);
  for (const [key, ns] of group(news, (n) => n.identityKey)) {
    const os = oldsByIdentity.get(key);
    if (!os) continue;
    const shift = (n: PairRow, o: PairRow) =>
      Math.abs(n.startsAt.getTime() - o.startsAt.getTime()) +
      Math.abs(n.endsAt.getTime() - o.endsAt.getTime());
    const r = solve(ns, os, () => true, shift, result);
    r.usedNew.forEach((id) => usedNew.add(id));
    r.usedOld.forEach((id) => usedOld.add(id));
  }

  // B. same municipality, date and time window; streets overlap: the street list was edited.
  const window = (r: PairRow) =>
    [r.municipality, r.date, r.startsAt.getTime(), r.endsAt.getTime()].join('|');
  const restOlds = olds.filter((o) => !usedOld.has(o.id));
  const oldsByWindow = group(restOlds, window);
  for (const [key, ns] of group(
    news.filter((n) => !usedNew.has(n.id)),
    window,
  )) {
    const os = oldsByWindow.get(key);
    if (!os) continue;
    const overlap = (n: PairRow, o: PairRow) =>
      [...n.streets].filter((s) => o.streets.has(s)).length;
    const jaccard = (n: PairRow, o: PairRow) => {
      const inter = overlap(n, o);
      return inter / (n.streets.size + o.streets.size - inter);
    };
    solve(
      ns,
      os,
      (n, o) => overlap(n, o) > 0,
      (n, o) => -jaccard(n, o),
      result,
    );
  }
  return result;
}
