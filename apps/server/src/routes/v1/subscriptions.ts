import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { cyrillicToLatin } from '@struja/parser';
import {
  CITIES,
  createSubscriptionRequestSchema,
  MAX_ADDRESSES,
  patchSubscriptionRequestSchema,
  subscriptionsResponseSchema,
  subscriptionWithOutagesSchema,
  type AddressOutageDto,
  type SubscriptionDto,
} from '@struja/shared';
import type { AppDeps } from '../../app.ts';
import type { Db } from '../../db/client.ts';
import { settlement, street, subscription } from '../../db/schema.ts';
import { deviceAuth } from '../../http/auth.ts';
import { ApiError, notFound, parse } from '../../http/errors.ts';
import { outagesForAddress, recordInApp, type AddressOutage } from '../../notify/inapp.ts';

type Row = typeof subscription.$inferSelect;

export const outageDto = (o: AddressOutage, subscriptionId: number): AddressOutageDto => ({
  id: o.id,
  subscriptionId,
  status: o.status,
  startsAt: o.startsAt.toISOString(),
  endsAt: o.endsAt.toISOString(),
  outageDate: o.outageDate,
  municipality: o.municipality,
  revision: o.revision,
  match: o.match,
  reason: o.reason,
});

async function names(
  db: Db,
  rows: Row[],
): Promise<Map<number, { latin: string; cyrillic: string }>> {
  const out = new Map<number, { latin: string; cyrillic: string }>();
  for (const r of rows) {
    if (r.streetId !== null) {
      const s = (await db.select().from(street).where(eq(street.id, r.streetId)))[0];
      if (s)
        out.set(r.id, {
          latin: s.nameLatin ?? cyrillicToLatin(s.nameCyrillic),
          cyrillic: s.nameCyrillic,
        });
    } else if (r.settlementId !== null) {
      const p = (await db.select().from(settlement).where(eq(settlement.id, r.settlementId)))[0];
      if (p)
        out.set(r.id, {
          latin: p.nameLatin ?? cyrillicToLatin(p.nameCyrillic),
          cyrillic: p.nameCyrillic,
        });
    }
  }
  return out;
}

async function toDto(db: Db, rows: Row[]): Promise<SubscriptionDto[]> {
  const n = await names(db, rows);
  return rows.map((r) => ({
    id: r.id,
    streetId: r.streetId,
    settlementId: r.settlementId,
    name: n.get(r.id) ?? { latin: '?', cyrillic: '?' },
    houseNumber: r.houseNumber,
    houseSuffix: r.houseSuffix,
    label: r.label,
    isPrimary: r.isPrimary,
  }));
}

export function subscriptionRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = deviceAuth(deps.db);
  const now = () => (deps.now ?? (() => new Date()))();
  const own = async (deviceId: string, id: number): Promise<Row> => {
    const r = (
      await deps.db
        .select()
        .from(subscription)
        .where(and(eq(subscription.id, id), eq(subscription.deviceId, deviceId)))
    )[0];
    if (!r) throw notFound('Address');
    return r;
  };
  const idParam = (req: { params: unknown }) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id < 1) throw notFound('Address');
    return id;
  };

  app.get('/v1/subscriptions', { preHandler: auth }, async (req) => {
    const rows = await deps.db
      .select()
      .from(subscription)
      .where(eq(subscription.deviceId, req.device?.id as string))
      .orderBy(asc(subscription.id));
    return subscriptionsResponseSchema.parse({
      subscriptions: await toDto(deps.db, rows),
      max: MAX_ADDRESSES,
    });
  });

  // Adding an address returns the outages already published for it. Nothing is pushed for those:
  // they are shown on screen and recorded as told in the app, so later changes still reach the person.
  app.post('/v1/subscriptions', { preHandler: auth }, async (req, reply) => {
    const body = parse(createSubscriptionRequestSchema, req.body);
    const deviceId = req.device?.id as string;
    const city = CITIES.find((c) => c.id === body.city && c.active);
    if (!city) throw new ApiError(404, 'city_not_found', `Unknown or inactive city: ${body.city}`);

    if (body.streetId !== undefined) {
      const s = (await deps.db.select().from(street).where(eq(street.id, body.streetId)))[0];
      if (!s || s.city !== city.slug) throw new ApiError(404, 'street_not_found', 'No such street');
    } else {
      const p = (
        await deps.db
          .select()
          .from(settlement)
          .where(eq(settlement.id, body.settlementId as number))
      )[0];
      if (!p || p.city !== city.slug)
        throw new ApiError(404, 'street_not_found', 'No such settlement');
    }

    const result = await deps.db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(subscription)
        .where(eq(subscription.deviceId, deviceId));
      if (existing.length >= MAX_ADDRESSES) {
        throw new ApiError(409, 'limit_reached', `At most ${MAX_ADDRESSES} addresses`);
      }
      const primary = existing.length === 0 ? true : (body.isPrimary ?? false);
      if (primary && existing.length > 0) {
        await tx
          .update(subscription)
          .set({ isPrimary: false })
          .where(eq(subscription.deviceId, deviceId));
      }
      const [created] = await tx
        .insert(subscription)
        .values({
          deviceId,
          streetId: body.streetId ?? null,
          settlementId: body.settlementId ?? null,
          houseNumber: body.houseNumber ?? null,
          houseSuffix: body.houseSuffix ?? null,
          label: body.label ?? null,
          isPrimary: primary,
        })
        .returning();
      const sub = created as Row;
      const outages = await outagesForAddress(
        tx as unknown as Db,
        { streetId: sub.streetId, settlementId: sub.settlementId, houseNumber: sub.houseNumber },
        'published',
        now(),
      );
      await recordInApp(tx as unknown as Db, sub.id, outages);
      return { sub, outages };
    });
    const [dto] = await toDto(deps.db, [result.sub]);
    return reply.code(201).send(
      subscriptionWithOutagesSchema.parse({
        subscription: dto,
        outages: result.outages.map((o) => outageDto(o, result.sub.id)),
      }),
    );
  });

  app.patch('/v1/subscriptions/:id', { preHandler: auth }, async (req) => {
    const body = parse(patchSubscriptionRequestSchema, req.body);
    const deviceId = req.device?.id as string;
    const current = await own(deviceId, idParam(req));
    if (body.isPrimary === false && current.isPrimary) {
      throw new ApiError(400, 'primary_required', 'Make another address primary instead');
    }
    const updated = await deps.db.transaction(async (tx) => {
      if (body.isPrimary === true) {
        await tx
          .update(subscription)
          .set({ isPrimary: false })
          .where(and(eq(subscription.deviceId, deviceId), ne(subscription.id, current.id)));
      }
      const [row] = await tx
        .update(subscription)
        .set({
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.isPrimary !== undefined ? { isPrimary: body.isPrimary } : {}),
          ...(body.houseNumber !== undefined ? { houseNumber: body.houseNumber } : {}),
          ...(body.houseSuffix !== undefined ? { houseSuffix: body.houseSuffix } : {}),
        })
        .where(eq(subscription.id, current.id))
        .returning();
      const sub = row as Row;
      // A new house number can put the address inside outages it was not in before.
      const outages = await outagesForAddress(
        tx as unknown as Db,
        { streetId: sub.streetId, settlementId: sub.settlementId, houseNumber: sub.houseNumber },
        'published',
        now(),
      );
      await recordInApp(tx as unknown as Db, sub.id, outages);
      return { sub, outages };
    });
    const [dto] = await toDto(deps.db, [updated.sub]);
    return subscriptionWithOutagesSchema.parse({
      subscription: dto,
      outages: updated.outages.map((o) => outageDto(o, updated.sub.id)),
    });
  });

  app.delete('/v1/subscriptions/:id', { preHandler: auth }, async (req, reply) => {
    const deviceId = req.device?.id as string;
    const current = await own(deviceId, idParam(req));
    await deps.db.transaction(async (tx) => {
      await tx.delete(subscription).where(eq(subscription.id, current.id));
      if (current.isPrimary) {
        // keep exactly one primary address
        await tx.execute(sql`
          UPDATE subscription SET is_primary = true
          WHERE id = (SELECT id FROM subscription WHERE device_id = ${deviceId} ORDER BY id LIMIT 1)`);
      }
    });
    return reply.code(204).send();
  });
}
