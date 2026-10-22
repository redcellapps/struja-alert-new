import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { eq, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Db } from '../db/client.ts';
import { device } from '../db/schema.ts';
import { unauthorized } from './errors.ts';

// There are no accounts. Registration issues a random device secret; the app keeps it in
// secure storage (Keystore / Keychain) and sends it on every request:
//   Authorization: Bearer <deviceId>.<secret>
// The server stores only a scrypt hash of it.
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;
const KEYLEN = 32;

export function newDeviceSecret(): string {
  return randomBytes(32).toString('base64url');
}

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(secret, salt, KEYLEN);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scryptAsync(secret, Buffer.from(salt, 'base64'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Verified against this when the device id is unknown, so the response time does not reveal
// whether an id exists.
let dummyHash: Promise<string> | null = null;
const dummy = () => (dummyHash ??= hashSecret('not-a-real-secret'));

const BEARER = /^Bearer ([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,})$/;

export interface AuthedDevice {
  id: string;
  platform: 'android' | 'ios';
}

declare module 'fastify' {
  interface FastifyRequest {
    device?: AuthedDevice;
  }
}

/** A Fastify preHandler: 401 unless the request carries a valid device secret. */
export function deviceAuth(db: Db, { required = true }: { required?: boolean } = {}) {
  return async (req: FastifyRequest): Promise<void> => {
    const header = req.headers.authorization;
    const m = header ? BEARER.exec(header) : null;
    if (!m) {
      if (!required && !header) return;
      throw unauthorized();
    }
    const [, id, secret] = m as unknown as [string, string, string];
    const row = (await db.select().from(device).where(eq(device.id, id)))[0];
    const ok = await verifySecret(secret, row?.deviceSecretHash ?? (await dummy()));
    if (!row || !ok) throw unauthorized();
    req.device = { id: row.id, platform: row.platform };
    // Keep "last seen" fresh without a write on every request.
    if (Date.now() - row.lastSeenAt.getTime() > 60_000) {
      await db
        .update(device)
        .set({ lastSeenAt: sql`now()` })
        .where(eq(device.id, id));
    }
  };
}
