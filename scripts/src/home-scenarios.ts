// Screenshots of Početna in every development scenario of the mock API, dark and light (adb only).
//
//   node src/home-scenarios.ts [outDir]     (default: docs/screens/android/step4)
//
// Needs: a debug build of the app installed and past onboarding with one saved address, the dev
// server running, one device attached, and the mock API on :3000 (`pnpm --filter @struja/mobile mock`).
// Scenarios are switched at run time with POST /__dev/scenario; the app is told to refresh by a pull
// down. "offline" follows a loaded scenario, so the app shows its saved data with the offline notice.
// "notifications off" revokes the notification permission with adb (which restarts the app) and
// grants it again afterwards.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ID = 'rs.example.strujaalert';
const MOCK = process.env.MOCK_URL ?? 'http://localhost:3000';
const root = fileURLToPath(new URL('../../', import.meta.url));
const outDir = process.argv[2] ?? join(root, 'docs', 'screens', 'android', 'step4');

const adb = (...args: string[]): Buffer =>
  execFileSync('adb', args, { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SCENARIOS = [
  'clear',
  'upcoming',
  'imminent',
  'active',
  'cancelled',
  'possible',
  'three',
  'offline',
] as const;

async function setScenario(name: string) {
  const res = await fetch(`${MOCK}/__dev/scenario`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Cannot set the scenario ${name}: HTTP ${res.status}`);
}

function size(): { w: number; h: number } {
  const m = /(\d+)x(\d+)/.exec(adb('shell', 'wm', 'size').toString());
  if (!m) throw new Error('Cannot read the screen size from adb');
  return { w: Number(m[1]), h: Number(m[2]) };
}
const { w, h } = size();
const swipe = (fromY: number, toY: number, ms: number) =>
  adb(
    'shell',
    'input',
    'swipe',
    String(w / 2),
    String(Math.round(h * fromY)),
    String(w / 2),
    String(Math.round(h * toY)),
    String(ms),
  );
const toTop = () => {
  for (let i = 0; i < 4; i++) swipe(0.2, 0.85, 120);
};
const pullToRefresh = () => swipe(0.25, 0.7, 300);
const launch = () =>
  adb('shell', 'monkey', '-p', APP_ID, '-c', 'android.intent.category.LAUNCHER', '1');

function tapLabel(label: string): boolean {
  adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml');
  const xml = adb('exec-out', 'cat', '/sdcard/ui.xml').toString('utf8');
  for (const m of xml.matchAll(/<node [^>]*>/g)) {
    const node = m[0];
    const desc = / content-desc="([^"]*)"/.exec(node)?.[1] ?? '';
    const text = / text="([^"]*)"/.exec(node)?.[1] ?? '';
    const b = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);
    if (b && (desc === label || text === label)) {
      const x = Math.round((Number(b[1]) + Number(b[3])) / 2);
      const y = Math.round((Number(b[2]) + Number(b[4])) / 2);
      adb('shell', 'input', 'tap', String(x), String(y));
      return true;
    }
  }
  return false;
}

const files: string[] = [];
function shot(name: string) {
  writeFileSync(join(outDir, name), adb('exec-out', 'screencap', '-p'));
  files.push(name);
}

/** The top of the page, then the rest of it when it scrolls. */
async function capture(base: string) {
  toTop();
  await sleep(800);
  shot(`${base}-1.png`);
  swipe(0.85, 0.2, 500);
  await sleep(900);
  const before = adb('exec-out', 'screencap', '-p');
  shot(`${base}-2.png`);
  swipe(0.85, 0.2, 500);
  await sleep(900);
  const after = adb('exec-out', 'screencap', '-p');
  if (before.equals(after)) return;
  shot(`${base}-3.png`);
}

/** The outage detail sheet: opened from the hero, its pages captured, then closed with Back. */
async function captureDetail(base: string) {
  toTop();
  await sleep(600);
  adb('shell', 'input', 'tap', String(Math.round(w / 2)), String(Math.round(h * 0.27)));
  await sleep(3500);
  shot(`${base}-1.png`);
  swipe(0.85, 0.2, 500);
  await sleep(900);
  shot(`${base}-2.png`);
  swipe(0.85, 0.2, 500);
  await sleep(900);
  shot(`${base}-3.png`);
  adb('shell', 'input', 'keyevent', '4');
  await sleep(1500);
}

// Scenarios whose hero opens an outage detail worth showing.
const DETAIL = new Set(['upcoming', 'active', 'cancelled', 'possible']);

async function main() {
  mkdirSync(outDir, { recursive: true });
  await setScenario('upcoming');
  adb('shell', 'am', 'force-stop', APP_ID);
  launch();
  await sleep(25000);

  for (const mode of ['dark', 'light'] as const) {
    adb('shell', 'cmd', 'uimode', 'night', mode === 'dark' ? 'yes' : 'no');
    await sleep(2500);
    for (const name of SCENARIOS) {
      await setScenario(name);
      toTop();
      await sleep(500);
      pullToRefresh();
      await sleep(name === 'offline' ? 7000 : 4000);
      await capture(`${name}-${mode}`);
      if (DETAIL.has(name)) await captureDetail(`detail-${name}-${mode}`);
      if (name === 'possible') {
        // "Dodaj broj" opens the address to add the house number
        toTop();
        swipe(0.85, 0.3, 500);
        await sleep(800);
        // the screen can be busy for a moment (the refresh spinner): try a few times
        let tapped = false;
        for (let i = 0; i < 4 && !tapped; i++) {
          try {
            tapped = tapLabel('Dodaj broj');
          } catch {
            // uiautomator could not get an idle state
          }
          if (!tapped) await sleep(1500);
        }
        if (tapped) {
          await sleep(2500);
          shot(`possible-add-number-${mode}.png`);
          adb('shell', 'input', 'keyevent', '4');
          await sleep(1000);
          adb('shell', 'input', 'keyevent', '4');
          await sleep(1500);
        }
      }
    }
    // notifications off: revoking the permission restarts the app, which then shows the banner
    await setScenario('upcoming');
    adb('shell', 'pm', 'revoke', APP_ID, 'android.permission.POST_NOTIFICATIONS');
    await sleep(1500);
    adb('shell', 'am', 'force-stop', APP_ID);
    launch();
    await sleep(15000);
    await capture(`notifications-off-${mode}`);
    adb('shell', 'pm', 'grant', APP_ID, 'android.permission.POST_NOTIFICATIONS');
    await sleep(1500);
    adb('shell', 'am', 'force-stop', APP_ID);
    launch();
    await sleep(15000);
  }
  adb('shell', 'cmd', 'uimode', 'night', 'no');
  await setScenario('upcoming');
  console.log(`${files.length} screenshots in ${outDir}`);
  console.log(files.join('\n'));
}

await main();
