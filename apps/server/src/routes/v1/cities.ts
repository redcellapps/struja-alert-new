import type { FastifyInstance } from 'fastify';
import { CITIES, citiesResponseSchema, gazetteerResponseSchema } from '@struja/shared';
import type { AppDeps } from '../../app.ts';

function notFound(city: string) {
  return { error: { code: 'city_not_found', message: `Unknown or inactive city: ${city}` } };
}

export function citiesRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/v1/cities', async () => {
    const cities = await Promise.all(
      CITIES.map(async (c) => ({
        id: c.id,
        name: c.name,
        active: c.active,
        gazetteerVersion: c.active ? (await deps.gazetteers.get(c.slug)).version : null,
      })),
    );
    return citiesResponseSchema.parse({ cities });
  });

  // The street list for offline search, versioned: the app sends If-None-Match.
  app.get<{ Params: { city: string } }>('/v1/cities/:city/gazetteer', async (req, reply) => {
    const info = CITIES.find((c) => c.id === req.params.city && c.active);
    if (!info) return reply.code(404).send(notFound(req.params.city));
    const g = await deps.gazetteers.get(info.slug);
    const etag = `"${g.etag}"`;
    reply.header('ETag', etag).header('Cache-Control', 'private, max-age=0, must-revalidate');
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return gazetteerResponseSchema.parse({
      city: info.id,
      version: g.version,
      etag: g.etag,
      streets: g.streets.map((s) => ({
        id: Number(s.id),
        nameCyrillic: s.name,
        nameLatin: s.nameLatin,
        nameNorm: s.nameNorm,
        altNorms: s.altNorms ?? [],
        municipality: s.municipality,
      })),
      settlements: g.settlements.map((p) => ({
        id: Number(p.id),
        nameCyrillic: p.name,
        nameNorm: p.nameNorm,
        altNorms: p.altNorms ?? [],
        kind: p.kind,
        municipality: p.municipality,
      })),
    });
  });
}
