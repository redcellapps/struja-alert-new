import Fastify from 'fastify';
import type { Db } from './db/client.ts';
import type { GazetteerService } from './gazetteer/service.ts';
import { citiesRoutes } from './routes/v1/cities.ts';

export interface AppDeps {
  db: Db;
  gazetteers: GazetteerService;
}

// `deps` is optional so the health check can run (and be tested) without a database.
export function buildApp(deps?: AppDeps) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  app.get('/healthz', async () => ({ status: 'ok' }));
  if (deps) citiesRoutes(app, deps);
  return app;
}
