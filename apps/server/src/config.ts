import { z } from 'zod';

// Environment configuration, validated at startup. See .env.example.
const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

export const configSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // Only `development` accepts the app's development push tokens. Anything else, or nothing, is
  // treated as production.
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Run the scheduled jobs in this process.
  RUN_JOBS: bool.default(true),
  // `fixtures`: read the saved pages (development). `http`: the production scheduler requests EDS.
  PAGE_SOURCE: z.enum(['fixtures', 'http']).default('fixtures'),
  FIXTURES_DIR: z.string().optional(),
  // Required for PAGE_SOURCE=http: goes into the User-Agent.
  SCRAPER_CONTACT_EMAIL: z.string().optional(),
  // The admin page and API are served only when a token is set (16 characters or more).
  ADMIN_TOKEN: z.string().min(16, 'ADMIN_TOKEN must be at least 16 characters').optional(),
  // Comma-separated addresses or IPv4 CIDR ranges that may reach the admin routes.
  ADMIN_IP_ALLOWLIST: z.string().default('127.0.0.1,::1'),
  // Behind a reverse proxy: take the client address from X-Forwarded-For.
  TRUST_PROXY: bool.default(false),
  // Public base URL of the admin page (for links in alerts), e.g. https://struja.example
  ADMIN_BASE_URL: z.string().optional(),
  // Alerts by email (SMTP) and by push to the admin's own device(s). Either, both or neither (log only).
  SMTP_URL: z.string().optional(),
  ALERT_EMAIL_FROM: z.string().optional(),
  ALERT_EMAIL_TO: z.string().optional(),
  ADMIN_PUSH_TOKENS: z.string().optional(),
  BACKUP_DIR: z.string().default('./backups'),
  // Development convenience: load the saved OSM snapshots when the database has no streets yet.
  IMPORT_GAZETTEER: bool.default(false),
});
export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const r = configSchema.safeParse(env);
  if (!r.success) {
    const problems = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  const c = r.data;
  if (c.PAGE_SOURCE === 'http' && !c.SCRAPER_CONTACT_EMAIL) {
    throw new Error('Invalid configuration: PAGE_SOURCE=http requires SCRAPER_CONTACT_EMAIL');
  }
  if (c.SMTP_URL && (!c.ALERT_EMAIL_TO || !c.ALERT_EMAIL_FROM)) {
    throw new Error('Invalid configuration: SMTP_URL requires ALERT_EMAIL_FROM and ALERT_EMAIL_TO');
  }
  return c;
}
