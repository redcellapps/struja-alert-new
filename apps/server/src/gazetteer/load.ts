import { sql } from 'drizzle-orm';
import {
  Resolver,
  StreetIndex,
  type NisMunicipality,
  type NisSettlement,
  type NisStreet,
} from '@struja/parser';
import type { Db } from '../db/client.ts';

export interface LoadedGazetteer {
  city: string;
  version: number;
  etag: string;
  streets: NisStreet[];
  settlements: NisSettlement[];
  // raw_norm -> street id (human-confirmed aliases, not rejected).
  aliases: Map<string, number>;
  resolver: Resolver;
  // Villages and other settlements, for segments such as "Део села X".
  settlementIndex: StreetIndex;
  // Streets that count as address points per normalized name, for the scoring's house-number feature.
  addressNumbers: Map<string, Set<number>>;
}

interface StreetRow {
  id: number;
  name_cyrillic: string;
  name_latin: string | null;
  name_norm: string;
  alt_norms: string[];
  municipality: string | null;
  municipalities: string[];
  osm_way_ids: (number | string)[];
  geo: string | null;
}

// GeoJSON is [lon, lat]; the gazetteer keeps [lat, lon].
function linesFromGeoJson(geo: string | null): [number, number][][] {
  if (!geo) return [];
  const g = JSON.parse(geo) as { type: string; coordinates: [number, number][][] };
  if (g.type !== 'MultiLineString') return [];
  return g.coordinates.map((line) => line.map(([lon, lat]) => [lat, lon] as [number, number]));
}

function centroidOf(lines: [number, number][][]): [number, number] | null {
  let lat = 0;
  let lon = 0;
  let n = 0;
  for (const line of lines) {
    for (const [la, lo] of line) {
      lat += la;
      lon += lo;
      n++;
    }
  }
  return n ? [lat / n, lon / n] : null;
}

/** Rebuilds the in-memory gazetteer and its Resolver from Postgres. */
export async function loadGazetteer(db: Db, city: string): Promise<LoadedGazetteer> {
  const streetRows = (
    await db.execute(sql`
      SELECT id, name_cyrillic, name_latin, name_norm, alt_norms, municipality, municipalities,
             osm_way_ids, ST_AsGeoJSON(geom) AS geo
      FROM street WHERE city = ${city} ORDER BY id`)
  ).rows as unknown as StreetRow[];

  const streets: NisStreet[] = streetRows.map((r) => {
    const lines = linesFromGeoJson(r.geo);
    const municipalities = r.municipalities as NisMunicipality[];
    return {
      id: r.id,
      name: r.name_cyrillic,
      nameNorm: r.name_norm,
      altNorms: r.alt_norms,
      municipality: (r.municipality as NisMunicipality | null) ?? null,
      municipalities,
      nameLatin: r.name_latin,
      wayIds: r.osm_way_ids.map(Number),
      lines,
      centroid: centroidOf(lines),
    };
  });

  const settlementRows = (
    await db.execute(sql`
      SELECT id, name_cyrillic, name_norm, alt_norms, municipality, kind,
             ST_Y(geom) AS lat, ST_X(geom) AS lon
      FROM settlement WHERE city = ${city} ORDER BY id`)
  ).rows as unknown as {
    id: number;
    name_cyrillic: string;
    name_norm: string;
    alt_norms: string[];
    municipality: string | null;
    kind: string;
    lat: number | null;
    lon: number | null;
  }[];
  const settlements: NisSettlement[] = settlementRows.map((r) => ({
    id: r.id,
    name: r.name_cyrillic,
    nameNorm: r.name_norm,
    altNorms: r.alt_norms,
    kind: r.kind,
    municipality: (r.municipality as NisMunicipality | null) ?? null,
    lat: r.lat,
    lon: r.lon,
  }));

  const aliasRows = (
    await db.execute(sql`
      SELECT a.raw_norm, a.street_id FROM street_alias a
      JOIN street s ON s.id = a.street_id
      WHERE s.city = ${city} AND NOT a.rejected`)
  ).rows as unknown as { raw_norm: string; street_id: number }[];
  const aliases = new Map(aliasRows.map((r) => [r.raw_norm, r.street_id]));

  const numberRows = (
    await db.execute(sql`
      SELECT s.name_norm, a.housenumber FROM address_point a
      JOIN street s ON s.id = a.street_id WHERE s.city = ${city}`)
  ).rows as unknown as { name_norm: string; housenumber: string }[];
  const addressNumbers = new Map<string, Set<number>>();
  for (const r of numberRows) {
    const n = /^\s*(\d{1,4})/.exec(r.housenumber);
    if (!n?.[1]) continue;
    let set = addressNumbers.get(r.name_norm);
    if (!set) addressNumbers.set(r.name_norm, (set = new Set()));
    set.add(Number(n[1]));
  }

  const ver = (
    await db.execute(sql`SELECT version, etag FROM gazetteer_version WHERE city = ${city}`)
  ).rows[0] as { version: number; etag: string } | undefined;

  return {
    city,
    version: ver?.version ?? 0,
    etag: ver?.etag ?? '',
    streets,
    settlements,
    aliases,
    resolver: new Resolver(streets),
    settlementIndex: new StreetIndex(settlements),
    addressNumbers,
  };
}
