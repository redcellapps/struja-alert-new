// Screenshots of Podešavanja, dark and light (adb only): the whole page, the Cyrillic and the English
// UI, the confirmations for deleting an address and for deleting everything (cancelled, never
// confirmed), quiet hours off, and the notifications-off state.
//
//   node src/settings-screens.ts [outDir]     (default: docs/screens/android/step7)
//
// Needs the same as home-scenarios.ts. It changes the settings it shows and puts them back. Do not edit
// the app's code while it runs.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_ID,
  ensureApp,
  adb,
  launch,
  openTab,
  screenshotter,
  setScenario,
  sleep,
  swipe,
  tapLabelWithRetry,
  toTop,
} from './device.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const outDir = process.argv[2] ?? join(root, 'docs', 'screens', 'android', 'step7');
const { shot, files } = screenshotter(outDir);

/** The top of the page and then what lies below, until the page stops moving (at most seven pages). */
async function pages(base: string) {
  toTop();
  await sleep(800);
  shot(`${base}-1.png`);
  let previous = adb('exec-out', 'screencap', '-p');
  for (let page = 2; page <= 7; page++) {
    swipe(0.85, 0.2, 500);
    await sleep(900);
    const png = adb('exec-out', 'screencap', '-p');
    if (png.equals(previous)) return;
    shot(`${base}-${page}.png`);
    previous = png;
  }
}

/** Scrolls down a screen at a time until the label is on screen (at most six times), then taps it. */
async function scrollTap(label: string, prefix = false): Promise<boolean> {
  toTop();
  for (let i = 0; i < 6; i++) {
    if (await tapLabelWithRetry(label, 1, prefix)) return true;
    swipe(0.85, 0.35, 500);
    await sleep(700);
  }
  return false;
}

async function main() {
  await setScenario('upcoming');
  adb('shell', 'am', 'force-stop', APP_ID);
  launch();
  await ensureApp();

  for (const mode of ['dark', 'light'] as const) {
    adb('shell', 'cmd', 'uimode', 'night', mode === 'dark' ? 'yes' : 'no');
    await sleep(2500);
    openTab('settings');
    await sleep(2500);
    await pages(`podesavanja-${mode}`);

    // the Cyrillic and the English interface
    toTop();
    if (await tapLabelWithRetry('Ћирилица')) {
      await sleep(1500);
      toTop();
      shot(`podesavanja-cirilica-${mode}.png`);
      await tapLabelWithRetry('Latinica');
      await sleep(1000);
    }
    if (await tapLabelWithRetry('English')) {
      await sleep(1500);
      toTop();
      shot(`podesavanja-english-${mode}.png`);
      await tapLabelWithRetry('Srpski');
      await sleep(1000);
    }

    // quiet hours off, then on again
    if (await scrollTap('Tihi sati', true)) {
      await sleep(800);
      shot(`podesavanja-tihi-sati-off-${mode}.png`);
      await tapLabelWithRetry('Tihi sati', 1, true);
      await sleep(600);
    }

    // deleting an address asks first
    if (await scrollTap('Obriši: Vojvode Mišića 34a')) {
      await sleep(800);
      shot(`podesavanja-obrisi-adresu-${mode}.png`);
      swipe(0.8, 0.45, 400); // the button can lie under the tab bar
      await sleep(600);
      await tapLabelWithRetry('Otkaži');
      await sleep(600);
    }

    // deleting everything asks first (cancelled here)
    if (await scrollTap('Obriši sve moje podatke')) {
      await sleep(800);
      shot(`podesavanja-obrisi-sve-${mode}.png`);
      swipe(0.8, 0.45, 400); // the button can lie under the tab bar
      await sleep(600);
      await tapLabelWithRetry('Otkaži');
      await sleep(600);
    }

    // the about section with the licences open
    if (await scrollTap('Licence')) {
      await sleep(800);
      swipe(0.85, 0.5, 500);
      await sleep(800);
      shot(`podesavanja-o-aplikaciji-${mode}.png`);
    }

    // notifications off
    adb('shell', 'pm', 'revoke', APP_ID, 'android.permission.POST_NOTIFICATIONS');
    await sleep(1500);
    adb('shell', 'am', 'force-stop', APP_ID);
    launch();
    await ensureApp();
    openTab('settings');
    await sleep(2500);
    toTop();
    swipe(0.85, 0.35, 500);
    await sleep(800);
    shot(`podesavanja-obavestenja-off-${mode}.png`);
    adb('shell', 'pm', 'grant', APP_ID, 'android.permission.POST_NOTIFICATIONS');
    await sleep(1500);
    adb('shell', 'am', 'force-stop', APP_ID);
    launch();
    await ensureApp();
  }
  adb('shell', 'cmd', 'uimode', 'night', 'no');
  console.log(`${files.length} screenshots in ${outDir}`);
  console.log(files.join('\n'));
}

await main();
