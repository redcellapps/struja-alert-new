// Every screen of the app at a large font and on a narrow phone, with a check that every control has a
// spoken label (adb only; the accessibility tree is read with uiautomator, what TalkBack reads).
//
//   node src/a11y-screens.ts <config> [outDir]
//     config: font2         font scale 200 %, the emulator's own width, dark and light
//             narrow        the width of a 360 dp phone, normal font, dark
//             narrow-font2  both together, dark
//     outDir: docs/screens/android/step8/<config>
//
// Needs the same as home-scenarios.ts (a debug build past onboarding with one saved address, the dev
// server, one device, the mock API on :3000 in the "upcoming" scenario). It sets the font scale and the
// screen size, and puts them back at the end. Do not edit the app's code while it runs.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const config = process.argv[2] ?? '';
const CONFIGS = ['font2', 'narrow', 'narrow-font2'] as const;
if (!(CONFIGS as readonly string[]).includes(config)) {
  throw new Error(`Usage: a11y-screens.ts <${CONFIGS.join(' | ')}> [outDir]`);
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const outDir = process.argv[3] ?? join(root, 'docs', 'screens', 'android', 'step8', config);

const sh = (...args: string[]) =>
  execFileSync('adb', ['shell', ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
const wantFont = config === 'font2' || config === 'narrow-font2';
const wantNarrow = config === 'narrow' || config === 'narrow-font2';
const modes = config === 'font2' ? (['dark', 'light'] as const) : (['dark'] as const);

// The size is read when the device module loads, so the configuration is set first.
if (wantFont) sh('settings', 'put', 'system', 'font_scale', '2.0');
if (wantNarrow) sh('wm', 'size', '1080x2400'); // at 480 dpi: 360 dp wide
const dev = await import('./device.ts');
const { APP_ID, adb, back, h, launch, openTab, readUi, screenshotter, setScenario, sleep } = dev;
const {
  ensureApp,
  inForeground,
  spoken,
  swipe,
  tap,
  tapLabelWithRetry,
  tapMatching,
  toTop,
  w,
  walk,
} = dev;
const { shot, files } = screenshotter(outDir);

interface Finding {
  screen: string;
  label: string;
  problem?: string;
}
let evidence: string | undefined;
const labels: Finding[] = [];
const problems: Finding[] = [];

/** Reads what is on screen: every control and what is spoken for it; one with nothing is a problem. */
function audit(screen: string) {
  walk(readUi(), (n) => {
    // only this app's controls: the keyboard and the system bars are not ours to label
    if (!n.clickable || !n.bounds || n.pkg !== APP_ID) return;
    // off screen or under the system bars: not on this page
    if (n.bounds.y2 <= 0 || n.bounds.y1 >= h) return;
    // the sheet's full-screen backdrop (a tap on it closes the sheet; the close button is the control)
    if (n.bounds.x1 <= 0 && n.bounds.y1 <= 0 && n.bounds.x2 >= w && n.bounds.y2 >= h) return;
    const label = spoken(n);
    if (label === '') {
      problems.push({
        screen,
        label: `${n.cls} at ${n.bounds.x1},${n.bounds.y1}`,
        problem: 'no spoken label',
      });
    } else if (!labels.some((l) => l.screen === screen && l.label === label)) {
      labels.push({ screen, label });
    }
  });
}

/** Closes the dev toast (it comes back now and then) until it is gone, then opens the tab and checks its heading. */
async function goTab(tab: 'upcoming' | 'history' | 'settings', title: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    for (let i = 0; i < 4 && dev.dismissDevToast(); i++) await sleep(700);
    // the keyboard (still open after a search) covers the tab bar, and a tap there types letters
    for (let i = 0; i < 3 && dev.keyboardShown(); i++) {
      back();
      await sleep(1000);
    }
    openTab(tab);
    await sleep(1800);
    let found = false;
    walk(readUi(), (n) => {
      if (n.pkg === APP_ID && n.text === title && n.bounds && n.bounds.y1 < h * 0.2) found = true;
    });
    if (found) return;
  }
  // leave what the screen looked like for whoever looks into it
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `debug-${tab}.png`), adb('exec-out', 'screencap', '-p'));
  writeFileSync(join(outDir, `debug-${tab}.xml`), dev.dumpXml());
}

/** Stops when the heading of the screen is not at the top: the script is somewhere else than it thinks. */
async function expectTitle(name: string, title: string): Promise<void> {
  for (let i = 0; i < 5; i++) {
    let found = false;
    walk(readUi(), (n) => {
      if (n.pkg === APP_ID && n.text === title && n.bounds && n.bounds.y1 < h * 0.2) found = true;
    });
    if (found) return;
    await sleep(1000);
  }
  throw new Error(
    `"${name}": the heading "${title}" is not on screen; stopping instead of capturing another screen.`,
  );
}

/** Screenshots and audits the top of a screen and the pages below it (until it stops moving). */
async function pages(name: string, max = 4, sheet = false, title?: string) {
  if (!inForeground()) throw new Error(`The app is not in front before "${name}"; stopping.`);
  dev.dismissDevToast();
  // a swipe down would dismiss a sheet
  if (!sheet) toTop();
  await sleep(900);
  if (title) await expectTitle(name, title);
  shot(`${name}-1.png`);
  audit(`${name} (1)`);
  let previous = adb('exec-out', 'screencap', '-p');
  for (let page = 2; page <= max; page++) {
    swipe(0.85, 0.2, 500);
    await sleep(900);
    const png = adb('exec-out', 'screencap', '-p');
    if (png.equals(previous)) return;
    shot(`${name}-${page}.png`);
    audit(`${name} (${page})`);
    previous = png;
  }
}

/** A sheet is open when its close button ("Zatvori") is on screen. */
async function sheetOpen(): Promise<boolean> {
  for (let i = 0; i < 6; i++) {
    await sleep(1000);
    let open = false;
    walk(readUi(), (n) => {
      if (n.clickable && spoken(n) === 'Zatvori') open = true;
    });
    if (open) return true;
  }
  return false;
}

/** Closes the open sheet with its own button (Back could leave the app). */
async function closeSheet(): Promise<void> {
  await tapLabelWithRetry('Zatvori', 3);
  await sleep(1500);
}

const deepLink = (path: string) =>
  adb('shell', `am start -a android.intent.action.VIEW -d 'strujaalert:///${path}' -p ${APP_ID}`);

async function screens(mode: string) {
  const at = (s: string) => `${s}-${mode}`;
  await ensureApp();

  // the first run: three steps (nothing is finished or saved)
  deepLink('onboarding');
  await sleep(3500);
  await pages(at('onboarding-1'), 2);
  if (await tapLabelWithRetry('Dalje')) {
    await sleep(1200);
    await pages(at('onboarding-2'), 2);
    if (await tapLabelWithRetry('Ne sada')) {
      await sleep(2500);
      await pages(at('onboarding-3'), 3);
    }
  }

  // Početna and the outage detail
  adb('shell', 'am', 'force-stop', APP_ID);
  launch();
  await ensureApp();
  await pages(at('pocetna'), 4, false, 'Početna');
  toTop();
  if (tapMatching(/Najavljeno|Sutra bez struje|Danas bez struje/) && (await sheetOpen())) {
    await pages(at('detalj'), 4, true);
    await closeSheet();
    await sleep(1500);
  } else {
    problems.push({
      screen: at('detalj'),
      label: 'the outage detail did not open',
      problem: 'script',
    });
  }

  // Najave: the list, a search, the follow sheet, an outage of the city
  await goTab('upcoming', 'Najave');
  await pages(at('najave'), 3, false, 'Najave');
  toTop();
  tap(w / 2, h * 0.2); // the search field
  await sleep(700);
  adb('shell', 'input', 'text', 'cegar');
  await sleep(1200);
  if (dev.keyboardShown()) back();
  await sleep(800);
  await pages(at('najave-trazi'), 2);
  if (await tapLabelWithRetry('Prati Čegarska')) {
    await sleep(3000);
    if (dev.keyboardShown()) back();
    await sleep(600);
    await pages(at('prati'), 3, true);
    await closeSheet();
    await sleep(1200);
  }
  toTop();
  tap(w * 0.878, h * 0.2); // clear the search
  await sleep(600);
  if (dev.keyboardShown()) back();
  await sleep(600);
  toTop();
  if (tapMatching(/^[\p{L}]+, \d+\. [\p{L}]+, \d{2}:\d{2}–\d{2}:\d{2}/u)) {
    await sleep(3500);
    await pages(at('najave-detalj'), 3, true);
    await closeSheet();
    await sleep(1500);
  }

  // Istorija
  await goTab('history', 'Istorija');
  await pages(at('istorija'), 3, false, 'Istorija');

  // Podešavanja, the add address sheet, the house number sheet
  await goTab('settings', 'Podešavanja');
  await pages(at('podesavanja'), 8, false, 'Podešavanja');
  toTop();
  for (let i = 0; i < 8; i++) {
    if (await tapLabelWithRetry('Dodaj adresu', 1)) break;
    swipe(0.85, 0.3, 500);
    await sleep(600);
  }
  await sleep(3000);
  if (dev.keyboardShown()) back();
  await pages(at('dodaj-adresu'), 3, true);
  await closeSheet();
  await sleep(1500);
  toTop();
  for (let i = 0; i < 8; i++) {
    if (tapMatching(/^(Promeni|Dodaj) broj: /)) break;
    swipe(0.85, 0.3, 500);
    await sleep(600);
  }
  await sleep(3000);
  if (dev.keyboardShown()) back();
  await pages(at('broj'), 2, true);
  await closeSheet();
  await sleep(1500);
}

try {
  await setScenario('upcoming');
  adb('shell', 'am', 'force-stop', APP_ID);
  launch();
  await ensureApp();
  const oneLine = (b: Buffer) => b.toString().trim().replace(/\s+/g, ' ');
  evidence = `font scale ${oneLine(sh('settings', 'get', 'system', 'font_scale'))}, ${oneLine(sh('wm', 'size'))}, ${oneLine(sh('wm', 'density'))}`;
  console.log(`device: ${evidence}`);
  for (const mode of modes) {
    sh('cmd', 'uimode', 'night', mode === 'dark' ? 'yes' : 'no');
    await sleep(2500);
    await screens(mode);
  }
} finally {
  if (wantFont) sh('settings', 'put', 'system', 'font_scale', '1.0');
  if (wantNarrow) sh('wm', 'size', 'reset');
  sh('cmd', 'uimode', 'night', 'no');
}

const lines = [
  `# Accessibility labels: ${config}`,
  '',
  `Device during the run: ${evidence ?? 'not read'}.`,
  '',
  `Read from the accessibility tree of each screen (what TalkBack reads). ${labels.length} labelled controls, ${problems.length} without a spoken label.`,
  '',
  '## Controls without a spoken label',
  '',
  ...(problems.length === 0 ? ['None.'] : problems.map((p) => `- ${p.screen}: ${p.label}`)),
  '',
  '## Controls and what is spoken for them',
  '',
  ...labels.map((l) => `- ${l.screen}: ${l.label}`),
  '',
];
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'a11y-labels.md'), lines.join('\n'));
console.log(
  `${files.length} screenshots in ${outDir}; ${labels.length} labelled controls, ${problems.length} without a label`,
);
for (const p of problems) console.log(`NO LABEL: ${p.screen}: ${p.label}`);
