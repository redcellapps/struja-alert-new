import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';

// Every error leaves the API as { error: { code, message } } (the shared `errorSchema`).
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message: string) => new ApiError(400, 'invalid_request', message);
export const unauthorized = () =>
  new ApiError(401, 'unauthorized', 'Missing or invalid device credentials');
export const notFound = (what: string) => new ApiError(404, 'not_found', `${what} not found`);

/** Validates `data` against a shared zod schema; a failure is a 400 naming the first problem. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
  throw badRequest(`${where}${issue?.message ?? 'invalid'}`);
}

export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    // Fastify's own errors (rate limit, malformed JSON, ...) keep their status.
    if (e.statusCode && e.statusCode < 500) {
      const code = e.statusCode === 429 ? 'rate_limited' : 'invalid_request';
      return reply
        .code(e.statusCode)
        .send({ error: { code, message: e.message ?? 'Bad request' } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'internal', message: 'Something went wrong' } });
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: 'No such route' } }),
  );
}
