import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createReportRequestSchema, createReportResponseSchema } from '@struja/shared';
import type { AppDeps } from '../../app.ts';
import { outage, report, subscription } from '../../db/schema.ts';
import { deviceAuth } from '../../http/auth.ts';
import { notFound, parse } from '../../http/errors.ts';

export function reportRoutes(app: FastifyInstance, deps: AppDeps): void {
  const auth = deviceAuth(deps.db);

  // "Prijavi grešku": the person says what looks wrong with an outage.
  app.post('/v1/reports', { preHandler: auth }, async (req, reply) => {
    const body = parse(createReportRequestSchema, req.body);
    if (body.subscriptionId !== undefined) {
      const own = await deps.db
        .select({ id: subscription.id })
        .from(subscription)
        .where(
          and(
            eq(subscription.id, body.subscriptionId),
            eq(subscription.deviceId, req.device?.id as string),
          ),
        );
      if (own.length === 0) throw notFound('Address');
    }
    if (body.outageId !== undefined) {
      const o = await deps.db
        .select({ id: outage.id })
        .from(outage)
        .where(eq(outage.id, body.outageId));
      if (o.length === 0) throw notFound('Outage');
    }
    const [row] = await deps.db
      .insert(report)
      .values({
        outageId: body.outageId ?? null,
        subscriptionId: body.subscriptionId ?? null,
        message: body.message,
      })
      .returning({ id: report.id });
    return reply.code(201).send(createReportResponseSchema.parse({ id: row?.id }));
  });
}
