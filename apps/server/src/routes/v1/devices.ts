import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  deviceSchema,
  NOTIFICATION_KINDS,
  patchDeviceRequestSchema,
  registerDeviceRequestSchema,
  registerDeviceResponseSchema,
  type DeviceDto,
} from '@struja/shared';
import type { AppDeps, AppOptions } from '../../app.ts';
import { device, report, subscription } from '../../db/schema.ts';
import { hashSecret, newDeviceSecret, deviceAuth } from '../../http/auth.ts';
import { ApiError, parse } from '../../http/errors.ts';
import { parseQuietHours } from '../../notify/quiet.ts';

export function toDeviceDto(d: typeof device.$inferSelect): DeviceDto {
  return deviceSchema.parse({
    id: d.id,
    platform: d.platform,
    locale: d.locale === 'en' ? 'en' : 'sr',
    script: d.script,
    quietHours: d.quietHours ? parseQuietHours(d.quietHours) : null,
    enabledKinds: d.enabledKinds.filter((k) =>
      (NOTIFICATION_KINDS as readonly string[]).includes(k),
    ),
  });
}

const isUniqueViolation = (e: unknown) =>
  ((e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code) === '23505';

export function deviceRoutes(app: FastifyInstance, deps: AppDeps, opts: AppOptions): void {
  const auth = deviceAuth(deps.db);

  // Registration is the one unauthenticated write, so it is rate limited per IP.
  app.post(
    '/v1/devices',
    { config: { rateLimit: { max: opts.devicesPerHour ?? 30, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const body = parse(registerDeviceRequestSchema, req.body);
      const secret = newDeviceSecret();
      try {
        const [d] = await deps.db
          .insert(device)
          .values({
            pushToken: body.pushToken,
            deviceSecretHash: await hashSecret(secret),
            platform: body.platform,
            osVersion: body.osVersion ?? null,
            locale: body.locale,
            script: body.script,
          })
          .returning({ id: device.id });
        return reply
          .code(201)
          .send(registerDeviceResponseSchema.parse({ deviceId: d?.id, deviceSecret: secret }));
      } catch (e) {
        // A token can belong to one device. Without the secret nobody can take it over.
        if (isUniqueViolation(e)) {
          throw new ApiError(409, 'token_exists', 'This push token is already registered');
        }
        throw e;
      }
    },
  );

  app.get('/v1/devices/me', { preHandler: auth }, async (req) => {
    const d = (
      await deps.db
        .select()
        .from(device)
        .where(eq(device.id, req.device?.id as string))
    )[0];
    if (!d) throw new ApiError(404, 'not_found', 'Device not found');
    return toDeviceDto(d);
  });

  // Token refresh, language, script, quiet hours, notification kinds.
  app.patch('/v1/devices/me', { preHandler: auth }, async (req) => {
    const body = parse(patchDeviceRequestSchema, req.body);
    const id = req.device?.id as string;
    try {
      const [d] = await deps.db
        .update(device)
        .set({
          ...(body.pushToken !== undefined ? { pushToken: body.pushToken } : {}),
          ...(body.locale !== undefined ? { locale: body.locale } : {}),
          ...(body.script !== undefined ? { script: body.script } : {}),
          ...(body.quietHours !== undefined ? { quietHours: body.quietHours } : {}),
          ...(body.enabledKinds !== undefined
            ? { enabledKinds: [...new Set(body.enabledKinds)] }
            : {}),
        })
        .where(eq(device.id, id))
        .returning();
      return toDeviceDto(d as typeof device.$inferSelect);
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ApiError(409, 'token_exists', 'This push token belongs to another device');
      }
      throw e;
    }
  });

  // "Obriši sve moje podatke": the device, its addresses, its notification log and its reports.
  app.delete('/v1/devices/me', { preHandler: auth }, async (req, reply) => {
    const id = req.device?.id as string;
    await deps.db.transaction(async (tx) => {
      const subs = await tx
        .select({ id: subscription.id })
        .from(subscription)
        .where(eq(subscription.deviceId, id));
      if (subs.length) {
        await tx.delete(report).where(
          inArray(
            report.subscriptionId,
            subs.map((s) => s.id),
          ),
        );
      }
      await tx.delete(device).where(and(eq(device.id, id)));
    });
    return reply.code(204).send();
  });
}
