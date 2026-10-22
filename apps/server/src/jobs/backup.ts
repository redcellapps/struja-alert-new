import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

// Nightly pg_dump with 14-day retention (BRIEF §4/§9). Copying the dump off the server and
// testing the restore are part of the ops runbook (docs/ops.md, step 10).
export interface BackupResult {
  file: string;
  bytes: number;
  pruned: string[];
}

export interface BackupRunner {
  run(now: Date): Promise<BackupResult>;
}

export const RETENTION_DAYS = 14;

// Removes dumps older than `days`. Only files that look like ours are touched.
export function pruneBackups(dir: string, now: Date, days = RETENTION_DAYS): string[] {
  const cutoff = now.getTime() - days * 24 * 3600_000;
  const removed: string[] = [];
  for (const name of readdirSync(dir)) {
    if (!/^struja-\d{8}T\d{6}Z\.dump$/.test(name)) continue;
    const path = join(dir, name);
    if (statSync(path).mtimeMs < cutoff) {
      unlinkSync(path);
      removed.push(name);
    }
  }
  return removed;
}

export const backupFileName = (now: Date) =>
  `struja-${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z.dump`;

/** Runs `pg_dump --format=custom` against the database. */
export class PgDumpBackup implements BackupRunner {
  private readonly databaseUrl: string;
  private readonly dir: string;
  private readonly pgDump: string;

  constructor(databaseUrl: string, dir: string, pgDump = 'pg_dump') {
    this.databaseUrl = databaseUrl;
    this.dir = dir;
    this.pgDump = pgDump;
  }

  async run(now: Date): Promise<BackupResult> {
    mkdirSync(this.dir, { recursive: true });
    const file = join(this.dir, backupFileName(now));
    await new Promise<void>((resolve, reject) => {
      const p = spawn(this.pgDump, ['--format=custom', `--file=${file}`, this.databaseUrl], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let err = '';
      p.stderr.on('data', (d) => (err += String(d)));
      p.on('error', reject);
      p.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`pg_dump exited with ${code}: ${err.trim()}`)),
      );
    });
    return { file, bytes: statSync(file).size, pruned: pruneBackups(this.dir, now) };
  }
}
