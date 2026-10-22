import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { leadingNumber, normalizeName, type NisGazetteer } from '@struja/parser';
import type { Db } from '../db/client.ts';
import { gazetteerVersion, street, settlement, streetAlias } from '../db/schema.ts';
import type { OsmAddress } from './osm-files.ts';

export interface ReviewedAlias {
  raw: string;
  raw_norm: string;
  // Name of the street as in the gazetteer (name_cyrillic).
  street: string;
  reviewed?: boolean;
  reviewed_at?: string;
}

export interface ImportInput {
  city: string;
  gazetteer: NisGazetteer;
  addresses?: readonly OsmAddress[];
  aliases?: readonly ReviewedAlias[];
}

export interface ImportResult {
  streets: number;
  settlements: number;
  addressPoints: number;
  aliases: number;
  version: number;
  etag: string;
}

// WKT is x y = lon lat; the gazetteer keeps [lat, lon].
function multiLineWkt(lines: readonly (readonly [number, number][])[]): string | null {
  const parts = lines
    .filter((l) => l.length >= 2)
    .map((l) => `(${l.map(([lat, lon]) => `${lon} ${lat}`).join(', ')})`);
  return parts.length ? `MULTILINESTRING(${parts.join(', ')})` : null;
}

const CHUNK = 5000;

/**
 * Loads a gazetteer into Postgres. Streets are upserted by (city, name_norm), so street ids stay
 * stable across re-imports (subscriptions point at them); streets that disappear from OSM are
 * kept. Only human-reviewed aliases are imported, as `manual` with confidence 1.0.
 */
export async function importGazetteer(db: Db, input: ImportInput): Promise<ImportResult> {
  const { city, gazetteer } = input;
  return db.transaction(async (tx) => {
    // Streets.
    for (const s of gazetteer.streets) {
      const wkt = multiLineWkt(s.lines);
      const geom = wkt ? sql`ST_GeomFromText(${wkt}, 4326)` : null;
      const values = {
        city,
        municipality: s.municipality,
        municipalities: s.municipalities,
        nameLatin: s.nameLatin,
        nameCyrillic: s.name,
        nameNorm: s.nameNorm,
        altNorms: s.altNorms ?? [],
        osmWayIds: s.wayIds,
        geom: geom as unknown as string | null,
      };
      await tx
        .insert(street)
        .values(values)
        .onConflictDoUpdate({
          target: [street.city, street.nameNorm],
          set: {
            municipality: values.municipality,
            municipalities: values.municipalities,
            nameLatin: values.nameLatin,
            nameCyrillic: values.nameCyrillic,
            altNorms: values.altNorms,
            osmWayIds: values.osmWayIds,
            geom: values.geom,
          },
        });
    }

    // Settlements (villages, hamlets, suburbs, ...).
    for (const p of gazetteer.settlements) {
      const geom =
        p.lat !== null && p.lon !== null
          ? sql`ST_SetSRID(ST_MakePoint(${p.lon}, ${p.lat}), 4326)`
          : null;
      const values = {
        city,
        osmId: Number(p.id),
        municipality: p.municipality,
        kind: p.kind,
        nameCyrillic: p.name,
        nameNorm: p.nameNorm,
        altNorms: p.altNorms ?? [],
        geom: geom as unknown as string | null,
      };
      await tx
        .insert(settlement)
        .values(values)
        .onConflictDoUpdate({
          target: [settlement.city, settlement.osmId],
          set: {
            municipality: values.municipality,
            kind: values.kind,
            nameCyrillic: values.nameCyrillic,
            nameNorm: values.nameNorm,
            altNorms: values.altNorms,
            geom: values.geom,
          },
        });
    }

    // street name_norm / alt name -> id, for address points and aliases.
    const rows = await tx.execute(
      sql`SELECT id, name_norm, alt_norms FROM street WHERE city = ${city}`,
    );
    const idByNorm = new Map<string, number>();
    for (const r of rows.rows as { id: number; name_norm: string; alt_norms: string[] }[]) {
      idByNorm.set(r.name_norm, r.id);
      for (const a of r.alt_norms) if (!idByNorm.has(a)) idByNorm.set(a, r.id);
    }

    // Address points: replaced wholesale, in batches (there are tens of thousands).
    await tx.execute(
      sql`DELETE FROM address_point WHERE street_id IN (SELECT id FROM street WHERE city = ${city})`,
    );
    const points: { s: number; h: string; x: number; y: number }[] = [];
    for (const a of input.addresses ?? []) {
      const streetName = a.tags['addr:street'];
      const hn = a.tags['addr:housenumber'];
      const lat = a.lat ?? a.center?.lat;
      const lon = a.lon ?? a.center?.lon;
      if (!streetName || !hn || lat === undefined || lon === undefined) continue;
      if (leadingNumber(hn) === null) continue;
      const id = idByNorm.get(normalizeName(streetName));
      if (id === undefined) continue;
      points.push({ s: id, h: hn, x: lon, y: lat });
    }
    for (let i = 0; i < points.length; i += CHUNK) {
      // One JSON parameter per batch (an array interpolated into `sql` would become many binds).
      await tx.execute(sql`
        INSERT INTO address_point (street_id, housenumber, geom)
        SELECT s, h, ST_SetSRID(ST_MakePoint(x, y), 4326)
        FROM jsonb_to_recordset(${JSON.stringify(points.slice(i, i + CHUNK))}::jsonb)
             AS t(s int, h text, x float8, y float8)`);
    }

    // Reviewed aliases only.
    let aliases = 0;
    const byCyrillic = new Map<string, number>();
    for (const s of gazetteer.streets) {
      const id = idByNorm.get(s.nameNorm);
      if (id !== undefined) byCyrillic.set(s.name, id);
    }
    for (const a of input.aliases ?? []) {
      if (!a.reviewed) continue;
      const streetId = byCyrillic.get(a.street);
      if (streetId === undefined) continue;
      const res = await tx
        .insert(streetAlias)
        .values({
          streetId,
          raw: a.raw,
          rawNorm: a.raw_norm,
          confidence: 1,
          source: 'manual',
          reviewedAt: a.reviewed_at ? new Date(a.reviewed_at) : new Date(),
        })
        .onConflictDoNothing({ target: streetAlias.rawNorm })
        .returning({ id: streetAlias.id });
      aliases += res.length;
    }

    // Version + ETag: changes only when the street/settlement list changes.
    const names = (
      await tx.execute(
        sql`SELECT 's' || id || ':' || name_norm AS k FROM street WHERE city = ${city}
            UNION ALL SELECT 'p' || id || ':' || name_norm FROM settlement WHERE city = ${city}
            ORDER BY 1`,
      )
    ).rows.map((r) => String(r.k));
    const etag = createHash('sha1').update(names.join('\n')).digest('hex').slice(0, 16);
    const prev = (
      await tx.execute(sql`SELECT version, etag FROM gazetteer_version WHERE city = ${city}`)
    ).rows[0] as { version: number; etag: string } | undefined;
    const version = !prev ? 1 : prev.etag === etag ? prev.version : prev.version + 1;
    await tx
      .insert(gazetteerVersion)
      .values({ city, version, etag })
      .onConflictDoUpdate({
        target: gazetteerVersion.city,
        set: { version, etag, updatedAt: sql`now()` },
      });

    const count = (
      await tx.execute(sql`SELECT count(*)::int AS n FROM address_point
      WHERE street_id IN (SELECT id FROM street WHERE city = ${city})`)
    ).rows[0] as { n: number };
    return {
      streets: gazetteer.streets.length,
      settlements: gazetteer.settlements.length,
      addressPoints: count.n,
      aliases,
      version,
      etag,
    };
  });
}
