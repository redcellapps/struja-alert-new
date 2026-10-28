// adb helpers shared by the screenshot scripts (`design-review`, `home-scenarios`, `list-screens`):
// swipes, taps, screenshots and the development mock API's scenario switch. adb only, no Maestro.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const APP_ID = 'rs.strujaalert.app';
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
  // "Physical size" first, then "Override size" when `wm size` was changed: the override is the real one
  const out = adb('shell', 'wm', 'size').toString();
  const m = /Override size: (\d+)x(\d+)/.exec(out) ?? /(\d+)x(\d+)/.exec(out);
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
// The dev toast sits right over the bar and takes the tap: close it first.
export function openTab(tab: (typeof TABS)[number]): void {
  dismissDevToast();
  tap(w * (0.125 + 0.25 * TABS.indexOf(tab)), h * 0.936);
}

/**
 * The accessibility tree of the screen now, as uiautomator writes it. A failed dump ("null root node",
 * while the screen animates) leaves the file of the dump before: it is removed first and the dump asked
 * for again, or an old screen would be read as the current one.
 */
export function dumpXml(): string {
  for (let attempt = 0; attempt < 8; attempt++) {
    adb('shell', 'rm', '-f', '/sdcard/ui.xml');
    try {
      adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml');
    } catch {
      // "null root node": the screen is still animating, ask again
    }
    const xml = adb('exec-out', 'cat', '/sdcard/ui.xml').toString('utf8');
    if (xml.includes('<hierarchy')) return xml;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 800);
  }
  throw new Error('uiautomator could not read the screen');
}

/**
 * Taps the element whose spoken label or text is exactly `label` (or starts with it, with `prefix`);
 * false when it is not on screen.
 */
export function tapLabel(label: string, prefix = false): boolean {
  const xml = dumpXml();
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

// ---- the accessibility tree (uiautomator), for checking that every control has a spoken label

export interface UiNode {
  cls: string;
  // The app (or system component, such as the keyboard) the node belongs to.
  pkg: string;
  text: string;
  desc: string;
  clickable: boolean;
  bounds: { x1: number; y1: number; x2: number; y2: number } | null;
  children: UiNode[];
}

const attr = (tag: string, name: string): string =>
  new RegExp(` ${name}="([^"]*)"`).exec(tag)?.[1] ?? '';

/** The tree of what is on screen now. */
export function readUi(): UiNode[] {
  const xml = dumpXml();
  const roots: UiNode[] = [];
  const stack: UiNode[] = [];
  for (const m of xml.matchAll(/<node [^>]*?\/?>|<\/node>/g)) {
    const tag = m[0];
    if (tag === '</node>') {
      stack.pop();
      continue;
    }
    const b = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(tag);
    const node: UiNode = {
      cls: attr(tag, 'class'),
      pkg: attr(tag, 'package'),
      text: attr(tag, 'text'),
      desc: attr(tag, 'content-desc'),
      clickable: attr(tag, 'clickable') === 'true',
      bounds: b ? { x1: +b[1]!, y1: +b[2]!, x2: +b[3]!, y2: +b[4]! } : null,
      children: [],
    };
    (stack.at(-1)?.children ?? roots).push(node);
    if (!tag.endsWith('/>')) stack.push(node);
  }
  return roots;
}

export const walk = (nodes: UiNode[], visit: (n: UiNode) => void) => {
  for (const n of nodes) {
    visit(n);
    walk(n.children, visit);
  }
};

/** What TalkBack would read for a node: its own label, or the text of what is inside it. */
export function spoken(node: UiNode): string {
  if (node.desc) return node.desc;
  if (node.text) return node.text;
  const parts: string[] = [];
  walk(node.children, (n) => {
    if (n.desc) parts.push(n.desc);
    else if (n.text) parts.push(n.text);
  });
  return parts.join(' ').trim();
}

/** Taps the first element whose spoken label matches. */
export function tapMatching(re: RegExp): boolean {
  let hit: UiNode | undefined;
  walk(readUi(), (n) => {
    if (!hit && n.bounds && (re.test(n.desc) || re.test(n.text))) hit = n;
  });
  if (!hit?.bounds) return false;
  tap((hit.bounds.x1 + hit.bounds.x2) / 2, (hit.bounds.y1 + hit.bounds.y2) / 2);
  return true;
}

/** True when the app is the foreground activity. */
export const inForeground = () =>
  adb('shell', 'dumpsys', 'activity', 'activities')
    .toString()
    .split(/\r?\n/)
    .some((l) => l.includes('topResumedActivity') && l.includes(APP_ID));

/** Waits until the app is in front and shows controls (the bundle can still be loading); relaunches if not. */
export async function ensureApp(): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!inForeground()) {
      adb('shell', 'am', 'force-stop', APP_ID);
      launch();
    }
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      if (inForeground()) {
        // the dev client's own "Downloading…" screen has no tab bar; the app has
        let found = false;
        walk(readUi(), (n) => {
          // the selected tab is not clickable, so any of the four tab labels counts
          if (
            n.pkg === APP_ID &&
            /^(Početna|Najave|Istorija|Podešavanja)$/.test(n.desc || n.text)
          ) {
            found = true;
          }
        });
        dismissDevToast();
        if (found) return;
      }
    }
  }
  throw new Error('The app did not come up; stopping instead of capturing something else.');
}

/**
 * The development build shows a red warning toast over the tab bar now and then ("Looks like you have
 * configured linking in multiple places"). It is not part of the app's design: close it before a shot.
 */
export function dismissDevToast(): boolean {
  let closed = false;
  walk(readUi(), (n) => {
    if (n.pkg === APP_ID && n.clickable && n.bounds && /^!, /.test(n.desc)) {
      // the round close button at the right end of the toast
      tap(n.bounds.x2 - 75, (n.bounds.y1 + n.bounds.y2) / 2);
      closed = true;
    }
  });
  return closed;
}
