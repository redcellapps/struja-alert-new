import type { GazStreet } from './gazetteer.ts';
import { normalizeName } from './normalize.ts';

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

export interface NisStreet extends GazStreet {
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

/**
 * Merges ways that share a normalized name into one street (BRIEF §4: UNIQUE(city, name_norm)),
 * records which of the five municipalities it touches, and keeps every alternate name
 * (`alt_name`, `old_name`, `name:sr-Latn`, ...) as an extra normalized form.
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

  const byNorm = new Map<string, NisStreet>();
  let nextId = 1;
  for (const w of ways) {
    const name = w.tags.name;
    if (!name) continue;
    const nameNorm = normalizeName(name);
    if (!nameNorm) continue;
    let street = byNorm.get(nameNorm);
    if (!street) {
      street = {
        id: nextId++,
        name,
        nameNorm,
        altNorms: [],
        municipality: null,
        municipalities: [],
        nameLatin: w.tags['name:sr-Latn'] ?? null,
        wayIds: [],
        lines: [],
        centroid: null,
      };
      byNorm.set(nameNorm, street);
    }
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

  const streets = [...byNorm.values()];
  for (const s of streets) {
    s.municipality = s.municipalities[0] ?? null;
    let lat = 0;
    let lon = 0;
    let n = 0;
    for (const line of s.lines) {
      for (const [la, lo] of line) {
        lat += la;
        lon += lo;
        n++;
      }
    }
    s.centroid = n > 0 ? [lat / n, lon / n] : null;
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
  return { streets, settlements };
}
