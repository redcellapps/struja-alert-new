import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDb, runMigrations } from './db/client.ts';
import { importGazetteer, type ReviewedAlias } from './gazetteer/import.ts';
import { readNisSnapshots } from './gazetteer/osm-files.ts';
import { GazetteerService } from './gazetteer/service.ts';
import { PgDumpBackup } from './jobs/backup.ts';
import { LogBoundarySink } from './jobs/boundary.ts';
import { registerJobs, startBoss } from './jobs/register.ts';
import { FixturePageSource, HttpPageSource, scraperUserAgent } from './jobs/sources.ts';
import {
  EmailAlertSink,
  LogAlertSink,
  MultiAlertSink,
  PushAlertSink,
  type AlertSink,
} from './monitor/sinks.ts';
import { LogPushProvider } from './notify/provider.ts';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const config = loadConfig();

const { db, pool } = createDb(config.DATABASE_URL);
// Migrations run before the new server version starts serving (BRIEF §4 Deployment).
await runMigrations(db);

// Development convenience: load the saved OSM snapshots into an empty database.
if (config.IMPORT_GAZETTEER) {
  const have = Number((await db.execute(sql`SELECT count(*)::int AS n FROM street`)).rows[0]?.n);
  if (have === 0) {
    const src = readNisSnapshots(`${repoRoot}fixtures/osm`);
    const aliases: ReviewedAlias[] = JSON.parse(
      readFileSync(`${repoRoot}packages/parser/data/aliases.json`, 'utf8'),
    );
    const r = await importGazetteer(db, {
      city: 'Nis',
      gazetteer: src.gazetteer,
      addresses: src.addresses,
      aliases,
    });
    console.log(`Imported gazetteer: ${r.streets} streets, ${r.settlements} settlements`);
  }
}

const gazetteers = new GazetteerService(db);
const admin = config.ADMIN_TOKEN
  ? {
      token: config.ADMIN_TOKEN,
      ipAllowlist: config.ADMIN_IP_ALLOWLIST.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    }
  : undefined;
const app = buildApp(
  { db, gazetteers, admin },
  {
    trustProxy: config.TRUST_PROXY,
    allowDevTokens: config.NODE_ENV === 'development',
  },
);

let stopJobs: (() => Promise<void>) | null = null;
if (config.RUN_JOBS) {
  const boss = await startBoss(config.DATABASE_URL);
  const provider = new LogPushProvider();
  const log = (message: string, extra?: Record<string, unknown>) =>
    app.log.info(extra ?? {}, message);
  const list = (s?: string) =>
    (s ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  const sinks: AlertSink[] = [new LogAlertSink(log)];
  if (config.SMTP_URL && config.ALERT_EMAIL_FROM) {
    sinks.push(
      EmailAlertSink.fromSmtpUrl(
        config.SMTP_URL,
        config.ALERT_EMAIL_FROM,
        list(config.ALERT_EMAIL_TO),
      ),
    );
  }
  if (list(config.ADMIN_PUSH_TOKENS).length) {
    sinks.push(new PushAlertSink(provider, list(config.ADMIN_PUSH_TOKENS)));
  }
  const edsDir = config.FIXTURES_DIR ?? `${repoRoot}fixtures/eds`;
  await registerJobs(boss, {
    db,
    gazetteers,
    // Real delivery is Phase 4; until then the push provider and the start/end signals only log.
    provider,
    alerts: new MultiAlertSink(sinks),
    adminUrl: config.ADMIN_BASE_URL,
    boundary: new LogBoundarySink(),
    pages:
      config.PAGE_SOURCE === 'http'
        ? new HttpPageSource({
            userAgent: scraperUserAgent(pkg.version, config.SCRAPER_CONTACT_EMAIL),
          })
        : new FixturePageSource(edsDir),
    backup: new PgDumpBackup(config.DATABASE_URL, config.BACKUP_DIR),
    cities: ['Nis'],
    now: () => new Date(),
    log,
  });
  stopJobs = () => boss.stop({ graceful: true, timeout: 20_000 });
}

await app.listen({ host: '0.0.0.0', port: config.PORT });

// A graceful stop: no new requests, jobs finish, connections close (the container restarts cleanly).
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    await app.close();
    await stopJobs?.();
    await pool.end();
    process.exit(0);
  });
}
