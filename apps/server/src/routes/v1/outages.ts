import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { cyrillicToLatin } from '@struja/parser';
import {
  CITIES,
  cityOutagesResponseSchema,
  myOutagesResponseSchema,
  outageDetailSchema,
} from '@struja/shared';
import type { AppDeps } from '../../app.ts';
import { outage, outageStreet, settlement, street, subscription } from '../../db/schema.ts';
import { deviceAuth } from '../../http/auth.ts';
import { ApiError, badRequest, notFound } from '../../http/errors.ts';
import { outagesForAddress } from '../../notify/inapp.ts';
import { matchSubscription, type OutageStreetRow } from '../../notify/match.ts';
import { outageDto } from './subscriptions.ts';

const SOURCE_NAME = 'Elektrodistribucija Srbije';

const latin = (cyr: string, lat: string | null) => lat ?? cyrillicToLatin(cyr);

// A replaced row is shown as cancelled (it no longer applies); the live version has its own id.
const publicStatus = (s: 'active' | 'changed' | 'cancelled') => s;

export function outageRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = deviceAuth(deps.db);
  const optionalAuth = deviceAuth(deps.db, { required: false });
  const now = () => (deps.now ?? (() => new Date()))();

  // Outages that concern my saved addresses: what is coming, or what has passed.
  app.get('/v1/me/outages', { preHandler: auth }, async (req) => {
    const range = (req.query as { range?: string }).range ?? 'upcoming';
    if (range !== 'upcoming' && range !== 'history') {
      throw badRequest('range must be "upcoming" or "history"');
    }
    const subs = await deps.db
      .select()
      .from(subscription)
      .where(eq(subscription.deviceId, req.device?.id as string));
    const items = [];
    for (const s of subs) {
      const found = await outagesForAddress(
        deps.db,
        { streetId: s.streetId, settlementId: s.settlementId, houseNumber: s.houseNumber },
        range,
        now(),
      );
      for (const o of found) items.push({ o, subscriptionId: s.id });
    }
    items.sort((a, b) =>
      range === 'history'
        ? b.o.startsAt.getTime() - a.o.startsAt.getTime()
        : a.o.startsAt.getTime() - b.o.startsAt.getTime(),
    );
    return myOutagesResponseSchema.parse({
      outages: items.map((i) => outageDto(i.o, i.subscriptionId)),
    });
  });

  // Outage detail: the window, the parsed list of streets and ranges, the raw EDS text kept
  // verbatim, the geometry for the map, and (when signed in) how it concerns my addresses.
  app.get('/v1/outages/:id', { preHandler: optionalAuth }, async (req) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id < 1) throw notFound('Outage');
    const o = (await deps.db.select().from(outage).where(eq(outage.id, id)))[0];
    // Rows outside the app's scope (other branches) are stored but not exposed.
    if (!o || !o.inScope) throw notFound('Outage');

    const rows = await deps.db
      .select()
      .from(outageStreet)
      .where(eq(outageStreet.outageId, id))
      .orderBy(asc(outageStreet.id));
    const streetIds = [
      ...new Set(rows.map((r) => r.streetId).filter((x): x is number => x !== null)),
    ];
    const settlementIds = [
      ...new Set(rows.map((r) => r.settlementId).filter((x): x is number => x !== null)),
    ];
    const streets = streetIds.length
      ? await deps.db.select().from(street).where(inArray(street.id, streetIds))
      : [];
    const places = settlementIds.length
      ? await deps.db.select().from(settlement).where(inArray(settlement.id, settlementIds))
      : [];
    const streetBy = new Map(streets.map((s) => [s.id, s]));
    const placeBy = new Map(places.map((p) => [p.id, p]));

    const segments = new Map<number, ReturnType<typeof segmentOf>>();
    function segmentOf(r: (typeof rows)[number]) {
      const s = r.streetId !== null ? streetBy.get(r.streetId) : undefined;
      const p = r.settlementId !== null ? placeBy.get(r.settlementId) : undefined;
      const named = s ?? p;
      return {
        raw: r.rawSegment,
        kind: s ? ('street' as const) : p ? ('settlement' as const) : ('unresolved' as const),
        name: named
          ? { latin: latin(named.nameCyrillic, named.nameLatin), cyrillic: named.nameCyrillic }
          : null,
        partial: r.partial,
        ranges: [] as {
          raw: string;
          from: number | null;
          to: number | null;
          parity: 'odd' | 'even' | null;
        }[],
      };
    }
    for (const r of rows) {
      const seg = segments.get(r.segmentIndex) ?? segmentOf(r);
      if (r.houseRaw !== null) {
        seg.ranges.push({ raw: r.houseRaw, from: r.houseFrom, to: r.houseTo, parity: r.parity });
      }
      segments.set(r.segmentIndex, seg);
    }

    // Street geometry (simplified to ~1 m) for the mini map.
    const features: unknown[] = [];
    if (streetIds.length) {
      const g = await deps.db.execute(sql`
        SELECT id, name_cyrillic, ST_AsGeoJSON(geom, 5)::json AS geometry
        FROM street WHERE id IN (${sql.join(
          streetIds.map((x) => sql`${x}`),
          sql`, `,
        )}) AND geom IS NOT NULL`);
      for (const r of g.rows as { id: number; name_cyrillic: string; geometry: unknown }[]) {
        features.push({
          type: 'Feature',
          properties: { streetId: r.id, name: r.name_cyrillic },
          geometry: r.geometry,
        });
      }
    }
    if (settlementIds.length) {
      const g = await deps.db.execute(sql`
        SELECT id, name_cyrillic, ST_AsGeoJSON(geom, 6)::json AS geometry
        FROM settlement WHERE id IN (${sql.join(
          settlementIds.map((x) => sql`${x}`),
          sql`, `,
        )}) AND geom IS NOT NULL`);
      for (const r of g.rows as { id: number; name_cyrillic: string; geometry: unknown }[]) {
        features.push({
          type: 'Feature',
          properties: { settlementId: r.id, name: r.name_cyrillic },
          geometry: r.geometry,
        });
      }
    }

    const mine = [];
    if (req.device) {
      const subs = await deps.db
        .select()
        .from(subscription)
        .where(eq(subscription.deviceId, req.device.id));
      const target: OutageStreetRow[] = rows.map((r) => ({
        segmentIndex: r.segmentIndex,
        streetId: r.streetId,
        settlementId: r.settlementId,
        partial: r.partial,
        houseFrom: r.houseFrom,
        houseTo: r.houseTo,
        houseRaw: r.houseRaw,
        parity: r.parity,
        resolvedBy: r.resolvedBy,
        candidates: (r.candidates as OutageStreetRow['candidates']) ?? null,
      }));
      for (const s of subs) {
        const m = matchSubscription(
          { streetId: s.streetId, settlementId: s.settlementId, houseNumber: s.houseNumber },
          target,
        );
        if (m) {
          mine.push({
            subscriptionId: s.id,
            match: m.kind,
            reason: m.kind === 'possible' ? m.reason : null,
          });
        }
      }
    }

    return outageDetailSchema.parse({
      id: o.id,
      city: o.city,
      municipality: o.municipality,
      outageDate: o.outageDate,
      startsAt: o.startsAt.toISOString(),
      endsAt: o.endsAt.toISOString(),
      status: publicStatus(o.status),
      revision: o.revision,
      rawStreets: o.rawStreets,
      segments: [...segments.values()],
      geometry: { type: 'FeatureCollection', features },
      source: { name: SOURCE_NAME, url: o.sourceUrl },
      mine,
    });
  });

  // City-wide browse ("Najave"): every outage of the city, optionally for one day.
  app.get('/v1/cities/:city/outages', async (req) => {
    const slug = (req.params as { city: string }).city;
    const city = CITIES.find((c) => c.id === slug && c.active);
    if (!city) throw new ApiError(404, 'city_not_found', `Unknown or inactive city: ${slug}`);
    const date = (req.query as { date?: string }).date;
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw badRequest('date must be YYYY-MM-DD');

    const found = await deps.db
      .select()
      .from(outage)
      .where(
        and(
          eq(outage.city, city.slug),
          eq(outage.inScope, true),
          sql`${outage.supersededByOutageId} IS NULL AND ${outage.changeGroupId} IS NULL`,
          date
            ? eq(outage.outageDate, date)
            : sql`${outage.endsAt} > ${now().toISOString()}::timestamptz`,
        ),
      )
      .orderBy(asc(outage.startsAt))
      .limit(500);
    const ids = found.map((f) => f.id);
    const rows = ids.length
      ? await deps.db.select().from(outageStreet).where(inArray(outageStreet.outageId, ids))
      : [];
    const sIds = [...new Set(rows.map((r) => r.streetId).filter((x): x is number => x !== null))];
    const pIds = [
      ...new Set(rows.map((r) => r.settlementId).filter((x): x is number => x !== null)),
    ];
    const sNames = new Map(
      (sIds.length ? await deps.db.select().from(street).where(inArray(street.id, sIds)) : []).map(
        (s) => [s.id, latin(s.nameCyrillic, s.nameLatin)],
      ),
    );
    const pNames = new Map(
      (pIds.length
        ? await deps.db.select().from(settlement).where(inArray(settlement.id, pIds))
        : []
      ).map((p) => [p.id, latin(p.nameCyrillic, p.nameLatin)]),
    );
    return cityOutagesResponseSchema.parse({
      city: city.id,
      outages: found.map((o) => {
        const names = new Set<string>();
        for (const r of rows.filter((x) => x.outageId === o.id)) {
          const n =
            (r.streetId !== null ? sNames.get(r.streetId) : undefined) ??
            (r.settlementId !== null ? pNames.get(r.settlementId) : undefined) ??
            cyrillicToLatin(r.rawSegment);
          names.add(n);
        }
        return {
          id: o.id,
          municipality: o.municipality,
          startsAt: o.startsAt.toISOString(),
          endsAt: o.endsAt.toISOString(),
          outageDate: o.outageDate,
          status: publicStatus(o.status),
          streets: [...names].slice(0, 20),
        };
      }),
    });
  });
}
