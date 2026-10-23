import { errorSchema } from '@struja/shared';
import type { z } from 'zod';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export interface ClientDeps {
  baseUrl: string;
  fetch: typeof fetch;
  // "<deviceId>.<secret>" for the Authorization header, or null when the device is not registered.
  getCredentials: () => Promise<string | null>;
  // Called once after a 401 on an authenticated request, with the credentials that request used:
  // re-register and re-add the addresses (once, however many requests failed together).
  // Returns true when the request should be retried with the new credentials.
  onUnauthorized?: (usedCredentials: string | null) => Promise<boolean>;
}

export interface RequestOptions<S extends z.ZodType> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  schema?: S;
  body?: unknown;
  // true: must be signed in. 'optional': sent when there are credentials. false: never sent.
  auth?: boolean | 'optional';
  headers?: Record<string, string>;
}

export interface ApiClient {
  request<S extends z.ZodType>(opts: RequestOptions<S>): Promise<z.infer<S>>;
  // Like request, but also exposes the status and a header (ETag handling for the gazetteer).
  raw(opts: Omit<RequestOptions<z.ZodType>, 'schema'>): Promise<Response>;
}

/**
 * A small typed client over fetch. Every response body is parsed with the shared zod schema: a
 * contract mismatch is a visible ApiError('contract'), never a half-working screen. Errors use the
 * server's `{ error: { code, message } }` shape.
 */
export function createClient(deps: ClientDeps): ApiClient {
  async function send(
    opts: Omit<RequestOptions<z.ZodType>, 'schema'>,
    retried = false,
  ): Promise<Response> {
    const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const auth = opts.auth ?? false;
    let credentials: string | null = null;
    if (auth) {
      credentials = await deps.getCredentials();
      if (credentials) headers.authorization = `Bearer ${credentials}`;
      else if (auth === true) throw new ApiError(401, 'unauthorized', 'Not registered');
    }
    let res: Response;
    try {
      res = await deps.fetch(`${deps.baseUrl}${opts.path}`, {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
    } catch (e) {
      throw new ApiError(0, 'network', e instanceof Error ? e.message : 'Network error');
    }
    if (res.status === 401 && auth === true && !retried && deps.onUnauthorized) {
      if (await deps.onUnauthorized(credentials)) return send(opts, true);
    }
    return res;
  }

  async function failure(res: Response): Promise<ApiError> {
    const text = await res.text();
    try {
      const parsed = errorSchema.safeParse(JSON.parse(text));
      if (parsed.success) {
        return new ApiError(res.status, parsed.data.error.code, parsed.data.error.message);
      }
    } catch {
      // not JSON
    }
    return new ApiError(res.status, 'http', `HTTP ${res.status}`);
  }

  return {
    raw: send,
    async request<S extends z.ZodType>(opts: RequestOptions<S>): Promise<z.infer<S>> {
      const res = await send(opts);
      if (!res.ok) throw await failure(res);
      if (res.status === 204 || !opts.schema) return undefined as z.infer<S>;
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new ApiError(
          res.status,
          'contract',
          'The server answered with something that is not JSON',
        );
      }
      const parsed = opts.schema.safeParse(json);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new ApiError(
          res.status,
          'contract',
          `Unexpected response from ${opts.path}: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim(),
        );
      }
      return parsed.data;
    },
  };
}
