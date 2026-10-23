// Screenshots of Početna in every development scenario of the mock API, dark and light (adb only).
//
//   node src/home-scenarios.ts [outDir]     (default: docs/screens/android/step4)
//
// Needs: a debug build of the app installed and past onboarding with one saved address, the dev
// server running, one device attached, and the mock API on :3000 (`pnpm --filter @struja/mobile mock`).
// Scenarios are switched at run time with POST /__dev/scenario; the app is told to refresh by a pull
// down. "offline" follows a loaded scenario, so the app shows its saved data with the offline notice.
// "notifications off" revokes the notification permission with adb (which restarts the app) and
// grants it again afterwards. Do not edit the app's code while it runs: Fast Refresh would put a
// banner in the pictures.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_ID,
  adb,
  back,
  h,
  launch,
  pullToRefresh,
  screenshotter,
  setScenario,
  sleep,
  swipe,
  tap,
  tapLabelWithRetry,
  toTop,
  w,
} from './device.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const outDir = process.argv[2] ?? join(root, 'docs', 'screens', 'android', 'step4');
const { shot, files } = screenshotter(outDir);

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

// Scenarios whose hero opens an outage detail worth showing.
const DETAIL = new Set(['upcoming', 'active', 'cancelled', 'possible']);

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
  tap(w / 2, h * 0.27);
  await sleep(3500);
  shot(`${base}-1.png`);
  swipe(0.85, 0.2, 500);
  await sleep(900);
  shot(`${base}-2.png`);
  swipe(0.85, 0.2, 500);
  await sleep(900);
  shot(`${base}-3.png`);
  back();
  await sleep(1500);
}

async function main() {
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
        if (await tapLabelWithRetry('Dodaj broj')) {
          await sleep(2500);
          shot(`possible-add-number-${mode}.png`);
          back();
          await sleep(1000);
          back();
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
