import { normalizeName } from './normalize.ts';

export interface OsmAddressPoint {
  tags: Record<string, string>;
}

// OSM house numbers like "34a", "12/3", "5-7": keep the leading integer.
export function leadingNumber(housenumber: string): number | null {
  const m = /^\s*(\d{1,4})/.exec(housenumber);
  return m ? Number(m[1]) : null;
}

/** normalized street name -> house numbers that exist on it in OSM (`addr:street` + `addr:housenumber`). */
export function addressNumbersByStreet(
  points: readonly OsmAddressPoint[],
): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const p of points) {
    const street = p.tags['addr:street'];
    const hn = p.tags['addr:housenumber'];
    if (!street || !hn) continue;
    const n = leadingNumber(hn);
    if (n === null) continue;
    const key = normalizeName(street);
    let set = out.get(key);
    if (!set) out.set(key, (set = new Set<number>()));
    set.add(n);
  }
  return out;
}
