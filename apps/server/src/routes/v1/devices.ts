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

type Tx = Parameters<Parameters<AppDeps['db']['transaction']>[0]>[0];

// Removes a device with everything that hangs off it (addresses, notification log, reports).
async function eraseDevice(tx: Tx, where: ReturnType<typeof eq>): Promise<void> {
  const subs = await tx
    .select({ id: subscription.id })
    .from(subscription)
    .innerJoin(device, eq(device.id, subscription.deviceId))
    .where(where);
  if (subs.length) {
    await tx.delete(report).where(
      inArray(
        report.subscriptionId,
        subs.map((x) => x.id),
      ),
    );
  }
  await tx.delete(device).where(where);
}

export function deviceRoutes(app: FastifyInstance, deps: AppDeps, opts: AppOptions): void {
  const auth = deviceAuth(deps.db);

  // Registration is the one unauthenticated write, so it is rate limited per IP.
  app.post(
    '/v1/devices',
    { config: { rateLimit: { max: opts.devicesPerHour ?? 30, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const body = parse(registerDeviceRequestSchema, req.body);
      const secret = newDeviceSecret();
      // A push token belongs to one installation. If it is already on file (the app lost its secret:
      // reinstall, cleared storage), this registration takes it over: the old device and its
      // addresses are dropped and the app registers its own list again. Nothing is pushed twice
      // because an added address records the already published outages as told in the app.
      const hashed = await hashSecret(secret);
      const id = await deps.db.transaction(async (tx) => {
        await eraseDevice(tx, eq(device.pushToken, body.pushToken));
        const [d] = await tx
          .insert(device)
          .values({
            pushToken: body.pushToken,
            deviceSecretHash: hashed,
            platform: body.platform,
            osVersion: body.osVersion ?? null,
            locale: body.locale,
            script: body.script,
          })
          .returning({ id: device.id });
        return d?.id as string;
      });
      return reply
        .code(201)
        .send(registerDeviceResponseSchema.parse({ deviceId: id, deviceSecret: secret }));
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
    await deps.db.transaction((tx) => eraseDevice(tx, eq(device.id, id)));
    return reply.code(204).send();
  });
}
