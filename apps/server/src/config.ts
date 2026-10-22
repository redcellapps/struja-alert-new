import { z } from 'zod';

// Environment configuration, validated at startup. See .env.example.
const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

export const configSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Run the scheduled jobs in this process.
  RUN_JOBS: bool.default(true),
  // `fixtures`: read the saved pages (development). `http`: the production scheduler requests EDS.
  PAGE_SOURCE: z.enum(['fixtures', 'http']).default('fixtures'),
  FIXTURES_DIR: z.string().optional(),
  // Required for PAGE_SOURCE=http: goes into the User-Agent.
  SCRAPER_CONTACT_EMAIL: z.string().optional(),
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
  return c;
}
