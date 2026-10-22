// Design review screenshots of the component gallery on a running Android emulator or device
// (adb only, no Maestro). For light and dark it opens the gallery sections through the app's deep
// link and saves PNGs, so the owner can open one folder and judge the look.
//
//   node src/design-review.ts [outDir]     (default: docs/screens/android/design-review)
//
// Needs: a debug build of the app installed, the dev server running, one device attached.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ID = 'rs.example.strujaalert';
const root = fileURLToPath(new URL('../../', import.meta.url));
const outDir = process.argv[2] ?? join(root, 'docs', 'screens', 'android', 'design-review');

const adb = (...args: string[]): Buffer =>
  execFileSync('adb', args, { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Shot {
  name: string;
  link: string;
  // How many screens to capture; the page is scrolled between them.
  pages: number;
}

const STATUSES = ['clear', 'upcoming', 'imminent', 'active', 'past'] as const;
const SHOTS: Shot[] = [
  ...STATUSES.map((s) => ({
    name: `hero-${s}`,
    link: `gallery?section=hero&status=${s}`,
    pages: 1,
  })),
  { name: 'hero-all', link: 'gallery?section=hero', pages: 3 },
  { name: 'cards', link: 'gallery?section=cards', pages: 2 },
  { name: 'controls', link: 'gallery?section=controls', pages: 2 },
  { name: 'feedback', link: 'gallery?section=feedback', pages: 3 },
];

function size(): { w: number; h: number } {
  const m = /(\d+)x(\d+)/.exec(adb('shell', 'wm', 'size').toString());
  if (!m) throw new Error('Cannot read the screen size from adb');
  return { w: Number(m[1]), h: Number(m[2]) };
}

const openLink = (link: string) =>
  adb('shell', `am start -a android.intent.action.VIEW -d 'strujaalert:///${link}' -p ${APP_ID}`);

async function main() {
  mkdirSync(outDir, { recursive: true });
  // Warm start: let the bundle load once before any screenshot.
  adb('shell', 'am', 'force-stop', APP_ID);
  openLink('gallery');
  await sleep(30000);
  const { w, h } = size();
  const files: string[] = [];
  for (const mode of ['light', 'dark'] as const) {
    adb('shell', 'cmd', 'uimode', 'night', mode === 'dark' ? 'yes' : 'no');
    await sleep(1500);
    for (const shot of SHOTS) {
      // The app stays running (a restart makes the dev client download the bundle again); the
      // deep link navigates it. One string: the device shell would split the link at the &.
      openLink(shot.link);
      await sleep(4000);
      for (let page = 0; page < shot.pages; page++) {
        const file = `${shot.name}-${mode}${shot.pages > 1 ? `-${page + 1}` : ''}.png`;
        writeFileSync(join(outDir, file), adb('exec-out', 'screencap', '-p'));
        files.push(file);
        if (page < shot.pages - 1) {
          // scroll by about 80 % of the screen
          adb(
            'shell',
            'input',
            'swipe',
            String(w / 2),
            String(h * 0.85),
            String(w / 2),
            String(h * 0.2),
            '600',
          );
          await sleep(1200);
        }
      }
    }
  }
  adb('shell', 'cmd', 'uimode', 'night', 'no');
  console.log(`${files.length} screenshots in ${outDir}`);
  console.log(files.join('\n'));
}

await main();
