import helmet from '@fastify/helmet';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { adminGuard } from '../admin/auth.ts';
import { renderAdminPage } from '../admin/page.ts';
import {
  confirmAlias,
  dismissSegment,
  healthSummary,
  recentReports,
  reducedRuns,
  reviewSpotCheck,
  spotCheckList,
  unresolvedQueue,
} from '../admin/service.ts';
import type { AppDeps } from '../app.ts';
import { ApiError, parse } from '../http/errors.ts';
import { confirmReducedRun } from '../ingest/ingest.ts';

const confirmBody = z.object({
  segNorm: z.string().min(1),
  streetId: z.coerce.number().int().positive(),
  raw: z.string().optional(),
});
const dismissBody = z.object({ segNorm: z.string().min(1) });
const reviewBody = z.object({
  rowIds: z
    .union([z.array(z.coerce.number().int()), z.string()])
    .transform((v) =>
      (Array.isArray(v) ? v : v.split(',').map((x) => Number(x.trim()))).filter(Number.isInteger),
    ),
  decision: z.enum(['confirmed', 'rejected']),
});

/**
 * The admin API and the one server-rendered page. Everything sits behind the token and the IP
 * allowlist; helmet's security headers (CSP and friends) are applied to this scope only, and there
 * is no CORS anywhere. The page's forms post to the same JSON endpoints.
 */
export async function adminRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const cfg = deps.admin;
  if (!cfg) return;
  const now = () => (deps.now ? deps.now() : new Date());

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        styleSrc: ["'unsafe-inline'"],
        formAction: ["'self'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
  });
  // Forms post application/x-www-form-urlencoded; the JSON endpoints take JSON.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string', bodyLimit: 64 * 1024 },
    (_req, body, done) => {
      const params = new URLSearchParams(body as string);
      const out: Record<string, string> = {};
      for (const [k, v] of params) out[k] = v;
      done(null, out);
    },
  );
  app.addHook('onRequest', adminGuard(cfg));
  app.addHook('onSend', async (_req, reply) => {
    void reply.header('cache-control', 'no-store');
  });

  const wantsHtml = (req: FastifyRequest) => (req.headers.accept ?? '').includes('text/html');
  // A form post goes back to the page; a script gets JSON.
  const done = (req: FastifyRequest, reply: FastifyReply, body: unknown) =>
    wantsHtml(req) ? reply.redirect('/admin', 303) : reply.send(body);

  app.get('/admin', async (_req, reply) => {
    const at = now();
    const [health, reduced, unresolved, spot, reports] = await Promise.all([
      healthSummary(deps.db, at),
      reducedRuns(deps.db),
      unresolvedQueue(deps.db, at),
      spotCheckList(deps.db, at),
      recentReports(deps.db, 30),
    ]);
    return reply
      .type('text/html; charset=utf-8')
      .send(renderAdminPage({ health, reduced, unresolved, spot, reports }));
  });

  app.get('/admin/health', async () => healthSummary(deps.db, now()));
  app.get('/admin/reports', async () => ({ reports: await recentReports(deps.db) }));
  app.get('/admin/reduced', async () => ({ runs: await reducedRuns(deps.db) }));
  app.get('/admin/unresolved', async () => ({ items: await unresolvedQueue(deps.db, now()) }));
  app.get('/admin/spot-checks', async () => ({ items: await spotCheckList(deps.db, now()) }));

  app.post('/admin/unresolved/confirm', async (req, reply) => {
    const b = parse(confirmBody, req.body);
    const r = await confirmAlias(deps.db, deps.gazetteers, b);
    if (!r) throw new ApiError(404, 'street_not_found', 'No such street');
    return done(req, reply, r);
  });

  app.post('/admin/unresolved/dismiss', async (req, reply) => {
    const b = parse(dismissBody, req.body);
    await dismissSegment(deps.db, b.segNorm);
    return done(req, reply, { ok: true });
  });

  app.post('/admin/spot-checks/review', async (req, reply) => {
    const b = parse(reviewBody, req.body);
    const reviewed = await reviewSpotCheck(deps.db, b);
    return done(req, reply, { reviewed });
  });

  app.post('/admin/runs/:id/confirm-reduced', async (req, reply) => {
    const id = parse(z.coerce.number().int().positive(), (req.params as { id: string }).id);
    const result = await confirmReducedRun(deps.db, id, now());
    if (result === 'not_reduced') {
      throw new ApiError(409, 'not_reduced', 'That fetch is not a reduced page waiting for review');
    }
    if (result === 'superseded') {
      throw new ApiError(
        409,
        'superseded',
        'A newer fetch of that date exists; the automatic rule applies',
      );
    }
    return done(req, reply, { result });
  });
}
