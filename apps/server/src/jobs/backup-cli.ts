import { PgDumpBackup } from './backup.ts';

// `make backup-now`: one dump right away, same as the nightly job.
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const r = await new PgDumpBackup(url, process.env.BACKUP_DIR ?? './backups').run(new Date());
console.log(`Wrote ${r.file} (${r.bytes} bytes); pruned ${r.pruned.length} old dump(s).`);
