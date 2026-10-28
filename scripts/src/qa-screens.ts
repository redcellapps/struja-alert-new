// Android design QA (step 11): every screen and state in light and dark, at font scale 1.0 and 2.0,
// through the Maestro flows of `.maestro/` against the development mock API.
//
//   pnpm --filter @struja/scripts qa-screens [outDir] [--configs light-font1,dark-font2] [--flows 02,03]
//   (default outDir: docs/screens/android/step11, one folder per configuration)
//
// Needs: Maestro (MAESTRO_BIN, or `maestro` on the PATH), one device or emulator, a debug build of the
// app installed, Metro on :8081 (`npx expo start --dev-client`) and the mock API on :3000
// (`pnpm --filter @struja/mobile mock`). `adb reverse tcp:8081 tcp:8081` is set here. The theme and the
// font scale are switched with adb and put back at the end (a font change restarts the app). The flows
// start from a clean install, so the app's data is cleared. Do not edit the app's code while it runs.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adb, sleep } from './device.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const outDir =
  args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ??
  join(root, 'docs', 'screens', 'android', 'step11');
const maestro = process.env.MAESTRO_BIN ?? 'maestro';
const DEV_URL = 'strujaalert://?__expo_url=http%3A%2F%2Flocalhost%3A8081';

const CONFIGS = [
  { name: 'light-font1', night: false, font: '1.0' },
  { name: 'dark-font1', night: true, font: '1.0' },
  { name: 'light-font2', night: false, font: '2.0' },
  { name: 'dark-font2', night: true, font: '2.0' },
] as const;
const FLOWS = [
  '01-onboarding',
  '02-home-scenarios',
  '03-detail-and-actions',
  '04-tabs-and-settings',
] as const;

const wanted = (flag('configs') ?? '').split(',').filter(Boolean);
const flows = (flag('flows') ?? '').split(',').filter(Boolean);
const configs = CONFIGS.filter((c) => wanted.length === 0 || wanted.includes(c.name));
const selected = FLOWS.filter((f) => flows.length === 0 || flows.some((p) => f.startsWith(p)));

function pngs(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? pngs(p) : f.endsWith('.png') ? [p] : [];
  });
}

const failures: string[] = [];
adb('reverse', 'tcp:8081', 'tcp:8081');
try {
  for (const c of configs) {
    console.log(`\n=== ${c.name}`);
    adb('shell', 'cmd', 'uimode', 'night', c.night ? 'yes' : 'no');
    adb('shell', 'settings', 'put', 'system', 'font_scale', c.font);
    await sleep(2500);
    const target = join(outDir, c.name);
    // a run of some flows only keeps the pictures of the others
    if (flows.length === 0) rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    for (const flow of selected) {
      // a stray swipe after a failure can leave the notification shade open: start every flow from a clean screen
      adb('shell', 'cmd', 'statusbar', 'collapse');
      adb('shell', 'input', 'keyevent', '3');
      await sleep(800);
      const tmp = join(outDir, `.tmp-${c.name}-${flow}`);
      rmSync(tmp, { recursive: true, force: true });
      mkdirSync(tmp, { recursive: true });
      const r = spawnSync(
        maestro,
        [
          'test',
          join('.maestro', `${flow}.yaml`),
          '-e',
          `DEV_URL=${DEV_URL}`,
          '--test-output-dir',
          tmp,
        ],
        {
          cwd: root,
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1' },
        },
      );
      const files = pngs(tmp);
      for (const f of files) copyFileSync(f, join(target, f.replace(/^.*[\\/]/, '')));
      rmSync(tmp, { recursive: true, force: true });
      const ok = r.status === 0;
      console.log(`  ${flow}: ${ok ? 'passed' : 'FAILED'}, ${files.length} screenshots`);
      if (!ok) {
        failures.push(`${c.name}/${flow}`);
        console.log(
          r.stdout
            .toString('utf8')
            .split('\n')
            .filter((l) => /FAILED|Assert|rror/.test(l))
            .slice(0, 6)
            .join('\n'),
        );
      }
    }
  }
} finally {
  adb('shell', 'cmd', 'uimode', 'night', 'no');
  adb('shell', 'settings', 'put', 'system', 'font_scale', '1.0');
}
console.log(failures.length === 0 ? '\nAll flows passed.' : `\nFailed: ${failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
