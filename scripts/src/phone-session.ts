// Prepares a phone session: one physical Android phone on USB reaches the local stack through
// `adb reverse` (Metro on :8081, the API on :3000), so the app talks to the real local server.
//
//   pnpm --filter @struja/scripts phone-session [--install] [--apk <path>] [--serial <id>]
//
// Checks: a phone (not an emulator) is attached; the API and Metro answer on this computer; sets both
// reverse tunnels; with --install installs the debug APK (it is built for the phone's CPU: see
// docs/phone-session.md); then opens the app on Metro. It does not start the server or Metro: those are
// long-running (docs/phone-session.md has the commands). The app must be bundled with
// EXPO_PUBLIC_API_URL=http://localhost:3000, which is what the phone sees through the tunnel.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const value = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const APP_ID = 'rs.example.strujaalert';
const apk =
  value('apk') ??
  join(
    root,
    'apps',
    'mobile',
    'android',
    'app',
    'build',
    'outputs',
    'apk',
    'debug',
    'app-debug.apk',
  );

const run = (...a: string[]): string =>
  execFileSync('adb', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const fail = (message: string): never => {
  console.error(`\n✗ ${message}`);
  process.exit(1);
};
const ok = (message: string) => console.log(`✓ ${message}`);

// 1. the phone
const lines = run('devices', '-l')
  .split('\n')
  .slice(1)
  .filter((l) => l.trim() !== '');
const phones = lines.filter((l) => !l.startsWith('emulator-'));
if (lines.some((l) => l.includes('unauthorized'))) {
  fail(
    'The phone is not authorised: unlock it and accept the USB debugging prompt, then run this again.',
  );
}
const wanted = value('serial');
const phone = wanted ? phones.find((l) => l.startsWith(wanted)) : phones[0];
if (!phone) {
  fail(
    'No phone found. Turn on Developer options > USB debugging, connect it with a data cable, and check `adb devices`.' +
      (lines.length
        ? `\nAttached: ${lines.map((l) => l.split(/\s+/)[0]).join(', ')} (emulators are ignored here).`
        : ''),
  );
}
if (phones.length > 1 && !wanted) {
  fail(
    `More than one phone is attached (${phones.map((l) => l.split(/\s+/)[0]).join(', ')}): pass --serial <id>.`,
  );
}
const serial = (phone as string).split(/\s+/)[0] as string;
const adb = (...a: string[]) => run('-s', serial, ...a);
ok(
  `phone ${serial}: ${adb('shell', 'getprop', 'ro.product.model').trim()}, Android ${adb('shell', 'getprop', 'ro.build.version.release').trim()}, ${adb('shell', 'getprop', 'ro.product.cpu.abi').trim()}`,
);

// 2. the local stack
async function answers(url: string, label: string, hint: string): Promise<void> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ok(`${label} answers on this computer`);
  } catch {
    fail(`${label} does not answer at ${url}. ${hint}`);
  }
}
await answers(
  'http://localhost:3000/healthz',
  'the API',
  'Start the server (docs/phone-session.md, step 2).',
);
await answers(
  'http://localhost:8081/status',
  'Metro',
  'Start Metro with EXPO_PUBLIC_API_URL=http://localhost:3000 (docs/phone-session.md, step 3).',
);

// 3. the tunnels
adb('reverse', 'tcp:8081', 'tcp:8081');
adb('reverse', 'tcp:3000', 'tcp:3000');
ok('adb reverse: the phone reaches Metro and the API as localhost:8081 and localhost:3000');

// 4. the app
if (args.includes('--install')) {
  if (!existsSync(apk)) fail(`No APK at ${apk}. Build it first (docs/phone-session.md, step 1).`);
  console.log(`  installing ${apk} ...`);
  adb('install', '-r', apk);
  ok('debug APK installed');
}
if (!adb('shell', 'pm', 'path', APP_ID).includes('package:')) {
  fail(`${APP_ID} is not installed on the phone. Run this with --install.`);
}
// Android 17 asks debug builds for access to the local network (Metro): grant it up front.
try {
  adb('shell', 'pm', 'grant', APP_ID, 'android.permission.ACCESS_LOCAL_NETWORK');
} catch {
  // an older Android has no such permission
}
adb(
  'shell',
  'am',
  'start',
  '-a',
  'android.intent.action.VIEW',
  '-d',
  'strujaalert://?__expo_url=http%3A%2F%2Flocalhost%3A8081',
  APP_ID,
);
ok('the app is opening on Metro (the first start takes a while: it bundles)');
console.log('\nNow follow docs/phone-session.md, the checklist.');
