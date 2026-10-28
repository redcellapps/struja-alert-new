import { nisMunicipality, type NisMunicipality } from './municipality.ts';

// Settlement boundaries (OSM relations with admin_level 9: the villages, the town of Нишка Бања and
// the four urban parts of Niš, "Ниш (Палилула)", ...). Pure code: no file access.
export interface OsmAreaRelation {
  type?: string;
  id: number;
  tags: Record<string, string>;
  members?: {
    type: string;
    role?: string;
    geometry?: { lat: number; lon: number }[];
  }[];
}

type Ring = [number, number][]; // [lat, lon]

export interface SettlementArea {
  id: number;
  // The name as people know it, in Cyrillic: a village's own name, or the city municipality for an
  // urban part of Niš ("Палилула" for "Ниш (Палилула)").
  label: string;
  // `urban`: a part of the city of Niš; `place`: a village or town of its own.
  kind: 'urban' | 'place';
  municipality: NisMunicipality | null;
  rings: Ring[];
  box: { s: number; w: number; n: number; e: number };
}

const same = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];

/** Joins the member ways end to end into closed rings (their nodes are shared, so ends match exactly). */
export function assembleRings(ways: readonly Ring[]): Ring[] {
  const pool = ways.filter((w) => w.length >= 2).map((w) => [...w]);
  const rings: Ring[] = [];
  while (pool.length > 0) {
    let ring = pool.pop() as Ring;
    let grown = true;
    while (grown && !same(ring[0] as [number, number], ring[ring.length - 1] as [number, number])) {
      grown = false;
      const head = ring[0] as [number, number];
      const tail = ring[ring.length - 1] as [number, number];
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i] as Ring;
        const first = w[0] as [number, number];
        const last = w[w.length - 1] as [number, number];
        if (same(tail, first)) ring = [...ring, ...w.slice(1)];
        else if (same(tail, last)) ring = [...ring, ...[...w].reverse().slice(1)];
        else if (same(head, last)) ring = [...w, ...ring.slice(1)];
        else if (same(head, first)) ring = [...[...w].reverse(), ...ring.slice(1)];
        else continue;
        pool.splice(i, 1);
        grown = true;
        break;
      }
    }
    if (
      ring.length >= 4 &&
      same(ring[0] as [number, number], ring[ring.length - 1] as [number, number])
    ) {
      rings.push(ring);
    }
  }
  return rings;
}

function inRing(ring: Ring, lat: number, lon: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i] as [number, number];
    const [yj, xj] = ring[j] as [number, number];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The settlements with a boundary, from the admin_level 9 relations (`out geom`). */
export function buildSettlementAreas(relations: readonly OsmAreaRelation[]): SettlementArea[] {
  const out: SettlementArea[] = [];
  for (const r of relations) {
    if (r.tags.admin_level !== '9' || !r.tags.name) continue;
    const ways: Ring[] = (r.members ?? [])
      .filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry?.length)
      .map((m) => (m.geometry ?? []).map((p): [number, number] => [p.lat, p.lon]));
    const rings = assembleRings(ways);
    if (rings.length === 0) continue;
    const all = rings.flat();
    // "Ниш (Палилула)": an urban part of the city, named after its municipality.
    const inBrackets = /^Ниш \((.+)\)$/.exec(r.tags.name)?.[1];
    const municipality = inBrackets ? nisMunicipality(inBrackets) : null;
    out.push({
      id: r.id,
      label: municipality && inBrackets ? inBrackets : r.tags.name,
      kind: municipality ? 'urban' : 'place',
      municipality,
      rings,
      box: {
        s: Math.min(...all.map((p) => p[0])),
        n: Math.max(...all.map((p) => p[0])),
        w: Math.min(...all.map((p) => p[1])),
        e: Math.max(...all.map((p) => p[1])),
      },
    });
  }
  return out;
}

/** The settlement a point lies in (the smallest one when boundaries overlap), or null. */
export function areaAt(
  areas: readonly SettlementArea[],
  lat: number,
  lon: number,
): SettlementArea | null {
  let best: SettlementArea | null = null;
  let bestSize = Infinity;
  for (const a of areas) {
    const b = a.box;
    if (lat < b.s || lat > b.n || lon < b.w || lon > b.e) continue;
    if (!a.rings.some((ring) => inRing(ring, lat, lon))) continue;
    const size = (b.n - b.s) * (b.e - b.w);
    if (size < bestSize) {
      best = a;
      bestSize = size;
    }
  }
  return best;
}
