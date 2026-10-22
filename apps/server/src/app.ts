import { sql } from 'drizzle-orm';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import type { AdminConfig } from './admin/auth.ts';
import type { Db } from './db/client.ts';
import type { GazetteerService } from './gazetteer/service.ts';
import { installErrorHandler } from './http/errors.ts';
import { adminRoutes } from './routes/admin.ts';
import { citiesRoutes } from './routes/v1/cities.ts';
import { deviceRoutes } from './routes/v1/devices.ts';
import { outageRoutes } from './routes/v1/outages.ts';
import { reportRoutes } from './routes/v1/reports.ts';
import { subscriptionRoutes } from './routes/v1/subscriptions.ts';

export interface AppDeps {
  db: Db;
  gazetteers: GazetteerService;
  // For tests; defaults to the current time.
  now?: () => Date;
  // The admin page and API; without it they are not served at all.
  admin?: AdminConfig;
}

export interface AppOptions {
  // New device registrations per IP per hour (the one unauthenticated write).
  devicesPerHour?: number;
  // Requests per IP per minute across the API.
  perMinute?: number;
  logger?: boolean;
  // Behind a reverse proxy the client address comes from X-Forwarded-For (the admin allowlist).
  trustProxy?: boolean;
}

// `deps` is optional so the health check can run (and be tested) without a database.
export function buildApp(deps?: AppDeps, opts: AppOptions = {}) {
  const app = Fastify({
    logger: opts.logger ?? process.env.NODE_ENV !== 'test',
    trustProxy: opts.trustProxy ?? false,
  });
  installErrorHandler(app);
  // Liveness, and with a database also readiness: the container healthcheck fails when it is down.
  app.get('/healthz', async (_req, reply) => {
    if (deps) {
      try {
        await deps.db.execute(sql`SELECT 1`);
      } catch {
        return reply.code(503).send({ status: 'db_unavailable' });
      }
    }
    return { status: 'ok' };
  });
  if (deps) {
    app.register(rateLimit, { global: true, max: opts.perMinute ?? 300, timeWindow: '1 minute' });
    // Routes are registered after the rate limiter has loaded, so per-route limits apply.
    app.register(async (api) => {
      citiesRoutes(api, deps);
      deviceRoutes(api, deps, opts);
      subscriptionRoutes(api, deps);
      outageRoutes(api, deps);
      reportRoutes(api, deps);
      // Its own scope: the admin hooks and helmet's headers apply to the admin routes only.
      api.register((admin) => adminRoutes(admin, deps));
    });
  }
  return app;
}
