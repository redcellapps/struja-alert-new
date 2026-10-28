import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Platform } from 'react-native';
import { buildTheme } from '../src/design/theme';
import { tabsChrome as androidTabs } from '../src/design/tabsChrome.ts';
import { tabsChrome as iosTabs } from '../src/design/tabsChrome.ios';

// The iOS code paths cannot run on Windows (the iOS smoke build is Phase 6, on a Mac). What can be checked
// here: the JS compiles for iOS (`pnpm typecheck` also runs tsconfig.ios.json, `pnpm bundle:ios` bundles
// it), and the iOS branches do the safe thing.

const mockStart = jest.fn();
jest.mock('expo-intent-launcher', () => ({
  startActivityAsync: (...a: unknown[]) => mockStart(...a),
}));

afterEach(() => {
  jest.restoreAllMocks();
  mockStart.mockReset();
});

// Loads a module while Platform.OS is "ios", fresh (platform checks that run at import see iOS).
const onIos = <T extends object>(path: string): T => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  let loaded: T | undefined;
  jest.isolateModules(() => {
    loaded = jest.requireActual<T>(path);
  });
  return loaded as T;
};

describe('iOS branches', () => {
  it('has no calendar button and never starts an Android intent', async () => {
    const actions = onIos<typeof import('../src/outage/actions')>('../src/outage/actions');
    expect(actions.calendarAvailable).toBe(false);
    await actions.addToCalendar({
      title: 't',
      begin: 0,
      end: 1,
      description: 'd',
      location: 'l',
    });
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('reports the notification permission as undetermined until iOS gets expo-notifications [MAC]', async () => {
    const permission = onIos<typeof import('../src/notifications/permission')>(
      '../src/notifications/permission',
    );
    await expect(permission.requestNotificationPermission()).resolves.toBe('undetermined');
    await expect(permission.checkNotificationPermission()).resolves.toBe('undetermined');
  });

  it('uses the iOS touch target of 44 pt (48 dp on Android)', () => {
    const tokens = onIos<typeof import('../src/design/tokens')>('../src/design/tokens');
    expect(tokens.MIN_TOUCH).toBe(44);
  });
});

describe('the tab bar per platform', () => {
  const theme = buildTheme('dark');
  const android = androidTabs(theme, 12);
  const ios = iosTabs(theme, 12);

  it('Android: card colour, lime indicator, labels always shown', () => {
    expect(android).toMatchObject({
      backgroundColor: theme.colors.chrome.card,
      indicatorColor: theme.colors.chrome.accent,
      labelVisibilityMode: 'labeled',
    });
  });

  it('iOS: leaves the bar to the system (Liquid Glass), only fonts and colours follow the design', () => {
    expect(ios.backgroundColor).toBeUndefined();
    expect(ios.indicatorColor).toBeUndefined();
    expect(ios.rippleColor).toBeUndefined();
    expect(ios.labelVisibilityMode).toBeUndefined();
    expect(ios.iconColor).toEqual({
      default: theme.colors.chrome.textSecondary,
      selected: theme.colors.chrome.text,
    });
    expect(ios.labelStyle).toBeDefined();
  });
});

describe('[MAC] markers', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });

  it('every iOS-only file says so with [MAC]', () => {
    const root = join(__dirname, '..', 'src');
    const iosFiles = walk(root).filter((f) => /\.ios\.[tj]sx?$/.test(f));
    expect(iosFiles.length).toBeGreaterThan(0);
    for (const f of iosFiles) expect(readFileSync(f, 'utf8')).toContain('[MAC]');
  });
});
