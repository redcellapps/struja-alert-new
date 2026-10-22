import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../http/errors.ts';

export interface AdminConfig {
  token: string;
  // Exact addresses or IPv4 CIDR ranges.
  ipAllowlist: string[];
}

const digest = (s: string) => createHash('sha256').update(s).digest();

export function tokenMatches(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected));
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = n * 256 + Number(p);
  }
  return n;
}

export function ipAllowed(ip: string, allowlist: readonly string[]): boolean {
  const addr = ip.replace(/^::ffff:/, '');
  for (const entry of allowlist) {
    if (entry === addr) return true;
    const [base, bits] = entry.split('/');
    if (base && bits !== undefined) {
      const a = ipv4ToInt(addr);
      const b = ipv4ToInt(base);
      const n = Number(bits);
      if (a === null || b === null || !Number.isInteger(n) || n < 0 || n > 32) continue;
      const mask = n === 0 ? 0 : (0xffffffff << (32 - n)) >>> 0;
      if ((a & mask) >>> 0 === (b & mask) >>> 0) return true;
    }
  }
  return false;
}

// Bearer <token> for scripts, or HTTP Basic (any user name, the token as password) so a browser can
// open the page with its own login prompt.
function presentedToken(header: string | undefined): string | null {
  if (!header) return null;
  const bearer = /^Bearer (.+)$/i.exec(header);
  if (bearer) return bearer[1] as string;
  const basic = /^Basic (.+)$/i.exec(header);
  if (basic) {
    const decoded = Buffer.from(basic[1] as string, 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    return i >= 0 ? decoded.slice(i + 1) : null;
  }
  return null;
}

/**
 * The admin guard: the caller IP must be on the allowlist and the token must match (403 for the
 * address, 401 for the token).
 */
export function adminGuard(cfg: AdminConfig) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!ipAllowed(req.ip, cfg.ipAllowlist)) {
      throw new ApiError(403, 'forbidden', 'Not allowed from this address');
    }
    const given = presentedToken(req.headers.authorization);
    if (!given || !tokenMatches(given, cfg.token)) {
      void reply.header('www-authenticate', 'Basic realm="Struja Alert admin", charset="UTF-8"');
      throw new ApiError(401, 'unauthorized', 'Admin token required');
    }
    // A browser sends Basic credentials on its own to any request to this site, so state-changing
    // requests must come from this site (Origin, or Sec-Fetch-Site when there is no Origin).
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      const site = req.headers['sec-fetch-site'];
      const sameOrigin = origin ? safeHost(origin) === req.headers.host : true;
      const crossSite = site === 'cross-site' || site === 'same-site';
      if (!sameOrigin || crossSite) {
        throw new ApiError(403, 'forbidden', 'Cross-site request refused');
      }
    }
  };
}

function safeHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}
