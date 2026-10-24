// adb helpers shared by the screenshot scripts (`design-review`, `home-scenarios`, `list-screens`):
// swipes, taps, screenshots and the development mock API's scenario switch. adb only, no Maestro.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const APP_ID = 'rs.example.strujaalert';
const MOCK = process.env.MOCK_URL ?? 'http://localhost:3000';

export const adb = (...args: string[]): Buffer =>
  execFileSync('adb', args, { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] });
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Switches the mock API's development scenario (see apps/mobile/mock-server/scenarios.ts). */
export async function setScenario(name: string): Promise<void> {
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
export const { w, h } = size();

/** A vertical swipe in the middle of the screen, `fromY` and `toY` as fractions of its height. */
export const swipe = (fromY: number, toY: number, ms: number) =>
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
export const toTop = () => {
  for (let i = 0; i < 4; i++) swipe(0.2, 0.85, 120);
};
export const pullToRefresh = () => swipe(0.25, 0.7, 300);
export const tap = (x: number, y: number) =>
  adb('shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y)));
export const back = () => adb('shell', 'input', 'keyevent', '4');

/** Is the soft keyboard open? (Back would otherwise leave the screen instead of closing it.) */
export const keyboardShown = (): boolean =>
  adb('shell', 'dumpsys', 'input_method').toString().includes('mInputShown=true');

/** Closes the keyboard if it is open, and does nothing otherwise. */
export async function closeKeyboard(): Promise<void> {
  if (!keyboardShown()) return;
  back();
  await sleep(800);
}
export const launch = () =>
  adb('shell', 'monkey', '-p', APP_ID, '-c', 'android.intent.category.LAUNCHER', '1');

// The four tabs of the bar, in order: Početna, Najave, Istorija, Podešavanja.
export const TABS = ['home', 'upcoming', 'history', 'settings'] as const;
export const openTab = (tab: (typeof TABS)[number]) =>
  tap(w * (0.125 + 0.25 * TABS.indexOf(tab)), h * 0.936);

/**
 * Taps the element whose spoken label or text is exactly `label` (or starts with it, with `prefix`);
 * false when it is not on screen.
 */
export function tapLabel(label: string, prefix = false): boolean {
  adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml');
  const xml = adb('exec-out', 'cat', '/sdcard/ui.xml').toString('utf8');
  for (const m of xml.matchAll(/<node [^>]*>/g)) {
    const node = m[0];
    const desc = / content-desc="([^"]*)"/.exec(node)?.[1] ?? '';
    const text = / text="([^"]*)"/.exec(node)?.[1] ?? '';
    const b = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);
    const hit = (s: string) => (prefix ? s.startsWith(label) : s === label);
    if (b && (hit(desc) || hit(text))) {
      tap((Number(b[1]) + Number(b[3])) / 2, (Number(b[2]) + Number(b[4])) / 2);
      return true;
    }
  }
  return false;
}

/** `tapLabel` a few times: the screen can be busy for a moment (a refresh spinner). */
export async function tapLabelWithRetry(
  label: string,
  tries = 4,
  prefix = false,
): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try {
      if (tapLabel(label, prefix)) return true;
    } catch {
      // uiautomator could not get an idle state
    }
    await sleep(1500);
  }
  return false;
}

/** Collects the file names it saves, for the summary line of a script. */
export function screenshotter(outDir: string) {
  mkdirSync(outDir, { recursive: true });
  const files: string[] = [];
  return {
    files,
    shot(name: string) {
      writeFileSync(join(outDir, name), adb('exec-out', 'screencap', '-p'));
      files.push(name);
    },
  };
}
