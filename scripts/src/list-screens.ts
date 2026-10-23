// Screenshots of Najave and Istorija in their states, dark and light (adb only).
//
//   node src/list-screens.ts [outDir]     (default: docs/screens/android/step6)
//
// Needs the same as home-scenarios.ts: a debug build past onboarding with one saved address, the dev
// server, one device, the mock API on :3000. Do not edit the app's code while it runs.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_ID,
  adb,
  back,
  closeKeyboard,
  h,
  launch,
  openTab,
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
const outDir = process.argv[2] ?? join(root, 'docs', 'screens', 'android', 'step6');
const { shot, files } = screenshotter(outDir);

/** The top of the page and then what lies below, until the page stops moving (at most four pages). */
async function pages(base: string) {
  toTop();
  await sleep(800);
  shot(`${base}-1.png`);
  let previous = adb('exec-out', 'screencap', '-p');
  for (let page = 2; page <= 4; page++) {
    swipe(0.85, 0.2, 500);
    await sleep(900);
    const png = adb('exec-out', 'screencap', '-p');
    if (png.equals(previous)) return;
    shot(`${base}-${page}.png`);
    previous = png;
  }
}

const refresh = async (ms = 4000) => {
  toTop();
  await sleep(500);
  pullToRefresh();
  await sleep(ms);
};

const type = async (text: string) => {
  tap(w / 2, h * 0.1725); // the search field
  await sleep(800);
  adb('shell', 'input', 'text', text);
  await sleep(1200);
};
const clearSearch = async () => {
  tap(w * 0.878, h * 0.1725); // its clear button
  await sleep(600);
};

async function main() {
  await setScenario('upcoming');
  adb('shell', 'am', 'force-stop', APP_ID);
  launch();
  await sleep(25000);

  for (const mode of ['dark', 'light'] as const) {
    adb('shell', 'cmd', 'uimode', 'night', mode === 'dark' ? 'yes' : 'no');
    await sleep(2500);

    // ---- Najave
    await setScenario('upcoming');
    openTab('upcoming');
    await sleep(2500);
    await refresh();
    await pages(`najave-${mode}`);

    // a search with results, and a street that can be followed
    toTop();
    await type('cegar');
    await closeKeyboard();
    shot(`najave-search-${mode}.png`);
    if (await tapLabelWithRetry('Prati Čegarska')) {
      await sleep(3000);
      shot(`najave-follow-${mode}.png`);
      back();
      await sleep(1200);
    }
    // a search with no results
    await clearSearch();
    await type('zzzz');
    await closeKeyboard();
    shot(`najave-no-results-${mode}.png`);
    await clearSearch();
    await closeKeyboard();

    // the detail of the first announced outage, with "Prati" on its streets
    openTab('upcoming');
    await sleep(1000);
    toTop();
    await sleep(500);
    tap(w / 2, h * 0.34);
    await sleep(3500);
    shot(`najave-detail-${mode}-1.png`);
    swipe(0.85, 0.2, 500);
    await sleep(900);
    shot(`najave-detail-${mode}-2.png`);
    back();
    await sleep(1500);

    // ---- Istorija
    openTab('history');
    await sleep(2500);
    await refresh();
    await pages(`istorija-${mode}`);

    // ---- offline: the lists keep their data and say so
    await setScenario('offline');
    openTab('upcoming');
    await sleep(1500);
    await refresh(7000);
    shot(`najave-offline-${mode}.png`);
    openTab('history');
    await sleep(1500);
    await refresh(7000);
    shot(`istorija-offline-${mode}.png`);

    // ---- a quiet city and a new person: nothing to list
    await setScenario('clear');
    openTab('upcoming');
    await sleep(1500);
    await refresh();
    shot(`najave-empty-${mode}.png`);
    openTab('history');
    await sleep(1500);
    await refresh();
    shot(`istorija-empty-${mode}.png`);
    await tapLabelWithRetry('Početna', 1);
    openTab('home');
    await sleep(1000);
  }
  adb('shell', 'cmd', 'uimode', 'night', 'no');
  await setScenario('upcoming');
  console.log(`${files.length} screenshots in ${outDir}`);
  console.log(files.join('\n'));
}

await main();
