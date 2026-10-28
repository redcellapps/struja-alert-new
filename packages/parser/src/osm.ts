import type { GazStreet } from './gazetteer.ts';
import { normalizeName } from './normalize.ts';
import { haversineMeters } from './similarity.ts';

// Pure transforms from saved OSM snapshots to gazetteer entries. No file or network access.
export interface OsmLatLon {
  lat: number;
  lon: number;
}

export interface OsmStreetWay {
  type: 'way';
  id: number;
  tags: Record<string, string>;
  geometry?: OsmLatLon[];
}

export interface OsmPlace {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: OsmLatLon;
  tags: Record<string, string>;
}

export interface MunicipalitySnapshot {
  // OSM name, e.g. "Gradska opština Crveni Krst".
  name: string;
  streetWayIds: number[];
  places: OsmPlace[];
}

export const NIS_MUNICIPALITY_KEYS = [
  'medijana',
  'palilula',
  'pantelej',
  'crveni krst',
  'niska banja',
] as const;
export type NisMunicipality = (typeof NIS_MUNICIPALITY_KEYS)[number];

/**
 * Maps a municipality name, as EDS writes it ("Палилула - Ниш", "Нишка бања") or as OSM names it
 * ("Gradska opština Palilula"), to one of the five Niš city municipalities, else null.
 */
export function nisMunicipality(name: string): NisMunicipality | null {
  const n = normalizeName(name)
    .replace(/^gradska opstina /, '')
    .replace(/ nis$/, '')
    .trim();
  return (NIS_MUNICIPALITY_KEYS as readonly string[]).includes(n) ? (n as NisMunicipality) : null;
}

// Same-named OSM ways are one street only when they are connected or this close (single linkage).
// Farther apart they are different streets that happen to share a name (Војводе Путника in the
// city and in Трупале): separate gazetteer entries, each with its settlement.
export const SAME_STREET_GAP_METERS = 500;

export interface NisStreet extends GazStreet {
  // Stable across imports: the smallest OSM way id of the street. Unique together with nameNorm.
  clusterKey: string;
  // The nearest settlement (village, hamlet, suburb, neighbourhood, town), in Cyrillic: what tells
  // same-named streets apart in a list.
  settlement: string | null;
  municipality: NisMunicipality | null;
  municipalities: NisMunicipality[];
  nameLatin: string | null;
  wayIds: number[];
  // One polyline per OSM way: [lat, lon][].
  lines: [number, number][][];
  centroid: [number, number] | null;
}

export interface NisSettlement extends GazStreet {
  kind: string;
  municipality: NisMunicipality | null;
  lat: number | null;
  lon: number | null;
}

export interface NisGazetteer {
  streets: NisStreet[];
  settlements: NisSettlement[];
}

const ALT_KEYS = [
  'name:sr',
  'name:sr-Latn',
  'alt_name',
  'alt_name:sr',
  'alt_name:sr-Latn',
  'old_name',
  'old_name:sr',
  'old_name:sr-Latn',
];
// Villages, hamlets and suburbs are what subscribers live in; neighbourhoods and the town are
// kept (with their kind) so callers can decide.
const SETTLEMENT_KINDS = new Set(['village', 'hamlet', 'suburb', 'neighbourhood', 'town']);

function splitAlt(value: string): string[] {
  return value
    .split(';')
    .map((v) => v.trim())
    .filter(Boolean);
}

const MID_LAT_RAD = (43.3 * Math.PI) / 180;

type Pt = [number, number];

// Metres between two [lat, lon] points, fast and exact enough at city scale.
function metersApart(a: Pt, b: Pt): number {
  const dy = (a[0] - b[0]) * 111_320;
  const dx = (a[1] - b[1]) * 111_320 * Math.cos(MID_LAT_RAD);
  return Math.hypot(dx, dy);
}

interface Box {
  s: number;
  w: number;
  n: number;
  e: number;
}

function boxOf(points: readonly Pt[]): Box {
  let s = Infinity;
  let w = Infinity;
  let n = -Infinity;
  let e = -Infinity;
  for (const [la, lo] of points) {
    s = Math.min(s, la);
    n = Math.max(n, la);
    w = Math.min(w, lo);
    e = Math.max(e, lo);
  }
  return { s, w, n, e };
}

// A lower bound of the distance between two boxes: lets most way pairs be skipped.
function boxGapMeters(a: Box, b: Box): number {
  const dLat = Math.max(0, a.s - b.n, b.s - a.n);
  const dLon = Math.max(0, a.w - b.e, b.w - a.e);
  return Math.hypot(dLon * 111_320 * Math.cos(MID_LAT_RAD), dLat * 111_320);
}

/** True when some vertex of `a` is within `gap` metres of some vertex of `b`. */
function waysNear(a: readonly Pt[], b: readonly Pt[], gap: number): boolean {
  for (const p of a) for (const q of b) if (metersApart(p, q) <= gap) return true;
  return false;
}

/**
 * Splits the ways of one name into streets: connected or near ways (within `gap` metres, chained)
 * are one street. Returns the groups, each sorted by OSM way id, ordered by their smallest id.
 */
export function clusterWays(
  ways: readonly OsmStreetWay[],
  gap: number = SAME_STREET_GAP_METERS,
): OsmStreetWay[][] {
  const pts = ways.map((w) => (w.geometry ?? []).map((p): Pt => [p.lat, p.lon]));
  const boxes = pts.map((p) => (p.length ? boxOf(p) : null));
  const parent = ways.map((_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r] as number;
    let cur = x;
    while (parent[cur] !== r) {
      const next = parent[cur] as number;
      parent[cur] = r;
      cur = next;
    }
    return r;
  };
  for (let i = 0; i < ways.length; i++) {
    for (let j = i + 1; j < ways.length; j++) {
      if (find(i) === find(j)) continue;
      const bi = boxes[i];
      const bj = boxes[j];
      // A way without geometry cannot be placed: it joins the other ways (it adds no line either).
      const near =
        !bi || !bj
          ? true
          : boxGapMeters(bi, bj) <= gap && waysNear(pts[i] as Pt[], pts[j] as Pt[], gap);
      if (near) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, OsmStreetWay[]>();
  ways.forEach((w, i) => {
    const r = find(i);
    const g = groups.get(r) ?? [];
    g.push(w);
    groups.set(r, g);
  });
  return [...groups.values()]
    .map((g) => g.sort((a, b) => a.id - b.id))
    .sort((a, b) => (a[0]?.id ?? 0) - (b[0]?.id ?? 0));
}

/** The settlement nearest to the centre of a street, by name, or null when there is none. */
function nearestSettlement(
  centre: Pt | null,
  settlements: readonly NisSettlement[],
): string | null {
  if (!centre) return null;
  let best: NisSettlement | null = null;
  let bestDistance = Infinity;
  for (const p of settlements) {
    if (p.lat === null || p.lon === null) continue;
    const d = haversineMeters(centre, [p.lat, p.lon]);
    if (d < bestDistance) {
      bestDistance = d;
      best = p;
    }
  }
  return best?.name ?? null;
}

/**
 * Builds the street list. Ways that share a normalized name are one street only when they are
 * connected or close (`SAME_STREET_GAP_METERS`); otherwise they are separate streets with the same
 * name, told apart by their settlement (BRIEF §3). Records which of the five municipalities each
 * street touches, and keeps every alternate name (`alt_name`, `old_name`, `name:sr-Latn`, ...) as an
 * extra normalized form.
 */
export function buildNisGazetteer(
  ways: readonly OsmStreetWay[],
  municipalities: readonly MunicipalitySnapshot[],
): NisGazetteer {
  const munOfWay = new Map<number, Set<NisMunicipality>>();
  for (const m of municipalities) {
    const key = nisMunicipality(m.name);
    if (!key) continue;
    for (const id of m.streetWayIds) {
      const set = munOfWay.get(id) ?? new Set<NisMunicipality>();
      set.add(key);
      munOfWay.set(id, set);
    }
  }

  const seenPlace = new Set<number>();
  const settlements: NisSettlement[] = [];
  for (const m of municipalities) {
    const key = nisMunicipality(m.name);
    for (const p of m.places) {
      const kind = p.tags.place;
      const name = p.tags.name;
      if (!kind || !SETTLEMENT_KINDS.has(kind) || !name || seenPlace.has(p.id)) continue;
      seenPlace.add(p.id);
      const nameNorm = normalizeName(name);
      if (!nameNorm) continue;
      const altNorms: string[] = [];
      for (const k of ALT_KEYS) {
        for (const alt of splitAlt(p.tags[k] ?? '')) {
          const norm = normalizeName(alt);
          if (norm && norm !== nameNorm && !altNorms.includes(norm)) altNorms.push(norm);
        }
      }
      settlements.push({
        id: p.id,
        name,
        nameNorm,
        altNorms,
        kind,
        municipality: key,
        lat: p.lat ?? p.center?.lat ?? null,
        lon: p.lon ?? p.center?.lon ?? null,
      });
    }
  }

  const byNorm = new Map<string, OsmStreetWay[]>();
  for (const w of ways) {
    const name = w.tags.name;
    if (!name) continue;
    const nameNorm = normalizeName(name);
    if (!nameNorm) continue;
    const list = byNorm.get(nameNorm);
    if (list) list.push(w);
    else byNorm.set(nameNorm, [w]);
  }

  const streets: NisStreet[] = [];
  let nextId = 1;
  for (const [nameNorm, named] of byNorm) {
    for (const group of clusterWays(named)) {
      const first = group[0] as OsmStreetWay;
      const street: NisStreet = {
        id: nextId++,
        name: first.tags.name as string,
        nameNorm,
        altNorms: [],
        clusterKey: String(first.id),
        settlement: null,
        municipality: null,
        municipalities: [],
        nameLatin: group.map((w) => w.tags['name:sr-Latn']).find(Boolean) ?? null,
        wayIds: [],
        lines: [],
        centroid: null,
      };
      for (const w of group) {
        street.wayIds.push(w.id);
        if (w.geometry?.length) street.lines.push(w.geometry.map((p) => [p.lat, p.lon]));
        for (const m of munOfWay.get(w.id) ?? []) {
          if (!street.municipalities.includes(m)) street.municipalities.push(m);
        }
        for (const key of ALT_KEYS) {
          const v = w.tags[key];
          if (!v) continue;
          for (const alt of splitAlt(v)) {
            const norm = normalizeName(alt);
            if (norm && norm !== nameNorm && !(street.altNorms ?? []).includes(norm)) {
              street.altNorms = [...(street.altNorms ?? []), norm];
            }
          }
        }
      }
      street.municipality = street.municipalities[0] ?? null;
      let lat = 0;
      let lon = 0;
      let n = 0;
      for (const line of street.lines) {
        for (const [la, lo] of line) {
          lat += la;
          lon += lo;
          n++;
        }
      }
      street.centroid = n > 0 ? [lat / n, lon / n] : null;
      street.settlement = nearestSettlement(street.centroid, settlements);
      streets.push(street);
    }
  }
  return { streets, settlements };
}
