// `pnpm --filter @struja/mobile live-contract`: the live contract test against a local server
// (LIVE_API_URL, default http://localhost:3000). Works the same on Windows and macOS.
import { spawnSync } from 'node:child_process';

const url = process.env.LIVE_API_URL ?? 'http://localhost:3000';
const r = spawnSync('npx', ['vitest', 'run', 'live/live-contract.test.ts', '--root', '.'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, LIVE_API_URL: url },
});
process.exit(r.status ?? 1);
