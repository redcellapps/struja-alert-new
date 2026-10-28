import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { leadingNumber, normalizeName, type NisGazetteer, type NisStreet } from '@struja/parser';
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
  // Rows of the old, name-merged street list that were replaced by the split streets.
  replacedLegacy: number;
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
const MID_LAT_RAD = (43.3 * Math.PI) / 180;

// A street's vertices, thinned to at most `max`, for "which of these streets is the point on".
function sampled(s: NisStreet, max = 300): [number, number][] {
  const all = s.lines.flat();
  if (all.length <= max) return all;
  const step = all.length / max;
  return Array.from({ length: max }, (_, i) => all[Math.floor(i * step)] as [number, number]);
}

function metersApart(a: readonly [number, number], b: readonly [number, number]): number {
  const dy = (a[0] - b[0]) * 111_320;
  const dx = (a[1] - b[1]) * 111_320 * Math.cos(MID_LAT_RAD);
  return Math.hypot(dx, dy);
}

/**
 * Loads a gazetteer into Postgres. Streets are upserted by (city, name_norm, cluster_key), so
 * street ids stay stable across re-imports (subscriptions point at them); streets that disappear
 * from OSM are kept. Streets that share a name in different places are different rows (BRIEF §3).
 * Rows of the old, name-merged list (no cluster key) are replaced: whatever pointed at one (a saved
 * address, an outage, an alias) is moved to the split street of that name with the most geometry.
 * Only human-reviewed aliases are imported, as `manual` with confidence 1.0.
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
        clusterKey: s.clusterKey,
        settlementName: s.settlement,
        altNorms: s.altNorms ?? [],
        osmWayIds: s.wayIds,
        geom: geom as unknown as string | null,
      };
      await tx
        .insert(street)
        .values(values)
        .onConflictDoUpdate({
          target: [street.city, street.nameNorm, street.clusterKey],
          set: {
            municipality: values.municipality,
            municipalities: values.municipalities,
            nameLatin: values.nameLatin,
            nameCyrillic: values.nameCyrillic,
            settlementName: values.settlementName,
            altNorms: values.altNorms,
            osmWayIds: values.osmWayIds,
            geom: values.geom,
          },
        });
    }

    // Replace the rows of the old, name-merged street list (dev data from before the split).
    const legacyMap = sql`
      SELECT DISTINCT ON (o.id) o.id AS old_id, n.id AS new_id
      FROM street o
      JOIN street n ON n.city = o.city AND n.name_norm = o.name_norm AND n.cluster_key IS NOT NULL
      WHERE o.city = ${city} AND o.cluster_key IS NULL
      ORDER BY o.id, ST_Length(n.geom::geography) DESC NULLS LAST, n.id`;
    await tx.execute(
      sql`WITH map AS (${legacyMap}) UPDATE subscription SET street_id = map.new_id
          FROM map WHERE subscription.street_id = map.old_id`,
    );
    await tx.execute(
      sql`WITH map AS (${legacyMap}) UPDATE outage_street SET street_id = map.new_id
          FROM map WHERE outage_street.street_id = map.old_id`,
    );
    await tx.execute(
      sql`WITH map AS (${legacyMap}) UPDATE street_alias SET street_id = map.new_id
          FROM map WHERE street_alias.street_id = map.old_id`,
    );
    const replaced = await tx.execute(
      sql`DELETE FROM street o WHERE o.city = ${city} AND o.cluster_key IS NULL
          AND EXISTS (SELECT 1 FROM street n WHERE n.city = o.city AND n.name_norm = o.name_norm
                      AND n.cluster_key IS NOT NULL)`,
    );

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

    // (name_norm, cluster_key) -> id, for address points and aliases.
    const rows = await tx.execute(
      sql`SELECT id, name_norm, cluster_key FROM street WHERE city = ${city} AND cluster_key IS NOT NULL`,
    );
    const idOf = new Map<string, number>();
    for (const r of rows.rows as { id: number; name_norm: string; cluster_key: string }[]) {
      idOf.set(`${r.name_norm}|${r.cluster_key}`, r.id);
    }
    const idOfStreet = (s: NisStreet): number | undefined =>
      idOf.get(`${s.nameNorm}|${s.clusterKey}`);

    // Every street an `addr:street` name can mean: by its name or an alternate name. Several when the
    // name is shared; the point then belongs to the nearest of them.
    const byName = new Map<string, NisStreet[]>();
    for (const s of gazetteer.streets) {
      for (const n of [s.nameNorm, ...(s.altNorms ?? [])]) {
        const list = byName.get(n);
        if (!list) byName.set(n, [s]);
        else if (!list.includes(s)) list.push(s);
      }
    }
    const vertices = new Map<NisStreet, [number, number][]>();
    const nearest = (
      list: readonly NisStreet[],
      lat: number,
      lon: number,
    ): NisStreet | undefined => {
      let best: NisStreet | undefined;
      let bestMeters = Infinity;
      for (const s of list) {
        let v = vertices.get(s);
        if (!v) vertices.set(s, (v = sampled(s)));
        for (const p of v) {
          const d = metersApart(p, [lat, lon]);
          if (d < bestMeters) {
            bestMeters = d;
            best = s;
          }
        }
      }
      return best;
    };

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
      const candidates = byName.get(normalizeName(streetName));
      if (!candidates?.length) continue;
      const owner = candidates.length === 1 ? candidates[0] : nearest(candidates, lat, lon);
      const id = owner ? idOfStreet(owner) : undefined;
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

    // Reviewed aliases only. An alias names a street, and the name may belong to several streets:
    // it is stored on the first of them and resolved like the name itself (placed by its row).
    let aliases = 0;
    const byCyrillic = new Map<string, number>();
    for (const s of gazetteer.streets) {
      const id = idOfStreet(s);
      if (id !== undefined && !byCyrillic.has(s.name)) byCyrillic.set(s.name, id);
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
      replacedLegacy: replaced.rowCount ?? 0,
      version,
      etag,
    };
  });
}
