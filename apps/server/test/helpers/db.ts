import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb, runMigrations, type Db } from '../../src/db/client.ts';

// Same image as docker/compose.yaml: PostGIS + pg_trgm are part of the contract.
export const POSTGIS_IMAGE = 'postgis/postgis:18-3.6';

export interface TestDb {
  db: Db;
  pool: ReturnType<typeof createDb>['pool'];
  url: string;
  stop: () => Promise<void>;
}

export async function startTestDb(): Promise<TestDb> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(POSTGIS_IMAGE)
    .withDatabase('struja')
    .withUsername('struja')
    .withPassword('struja')
    .start();
  const url = container.getConnectionUri();
  const { db, pool } = createDb(url);
  await runMigrations(db);
  return {
    db,
    pool,
    url,
    stop: async () => {
      await pool.end();
      await container.stop();
    },
  };
}

// Postgres error code of a failed query (drizzle wraps the driver error in `cause`).
export function pgCode(e: unknown): string | undefined {
  const err = e as { code?: string; cause?: { code?: string } };
  return err.code ?? err.cause?.code;
}
