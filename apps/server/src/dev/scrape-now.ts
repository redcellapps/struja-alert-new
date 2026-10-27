// Development only: queues one scrape so a running local server (RUN_JOBS=true) ingests its pages now
// instead of at 07/13/19. The scrape chains the planner as usual.
import { PgBoss } from 'pg-boss';
import { JOBS } from '../jobs/handlers.ts';
import { assertLocalDatabase } from './local-only.ts';

const url = process.env.DATABASE_URL;
assertLocalDatabase(url, 'dev:scrape');
if (!url) throw new Error('DATABASE_URL is not set');
const boss = new PgBoss(url);
await boss.start();
await boss.send(JOBS.scrape, null);
console.log('scrape queued');
await boss.stop({ graceful: true, timeout: 5000 });
