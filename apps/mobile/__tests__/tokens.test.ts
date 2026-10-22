import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contrastRatio } from '../src/design/contrast';
import { buildTheme } from '../src/design/theme';
import {
  DEFAULT_FONT,
  fontSets,
  palettes,
  STATUS_KEYS,
  type ContrastLevel,
  type FontSetKey,
  type ThemeName,
} from '../src/design/tokens';

const levels: ContrastLevel[] = ['standard', 'high'];
const themes: ThemeName[] = ['light', 'dark'];

describe('contrast', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1);
  });
});

describe.each(levels.flatMap((l) => themes.map((t) => [l, t] as const)))(
  'palette %s %s',
  (level, theme) => {
    const p = palettes[level][theme];
    const textMin = level === 'high' ? 7 : 4.5;

    it.each(STATUS_KEYS)(
      'status %s: text on its fill is readable, the mark is visible on the page and on cards',
      (key) => {
        const s = p.status[key];
        expect(contrastRatio(s.onFill, s.fill)).toBeGreaterThanOrEqual(textMin);
        // dots, bars and icons (non-text UI) need 3:1 against the surfaces they sit on
        expect(contrastRatio(s.mark, p.chrome.background)).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(s.mark, p.chrome.card)).toBeGreaterThanOrEqual(3);
      },
    );

    it('chrome text is readable on the surfaces it sits on', () => {
      const c = p.chrome;
      for (const bg of [c.background, c.card, c.raised]) {
        expect(contrastRatio(c.text, bg)).toBeGreaterThanOrEqual(textMin);
        expect(contrastRatio(c.textSecondary, bg)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastRatio(c.onAccent, c.accent)).toBeGreaterThanOrEqual(textMin);
      for (const bg of [c.background, c.card]) {
        expect(contrastRatio(c.link, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(c.outline, bg)).toBeGreaterThanOrEqual(3);
      }
    });

    it('lime is the accent, as a fill with near-black text on it', () => {
      expect(p.chrome.accent).toBe('#D4F84A');
      expect(p.status.clear.fill).toBe(p.chrome.accent);
    });

    it('every colour is a #RRGGBB value', () => {
      const all = [
        ...Object.values(p.chrome),
        ...Object.values(p.status).flatMap((s) => Object.values(s)),
      ];
      for (const colour of all) expect(colour).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });
  },
);

describe('fonts', () => {
  const fontDir = join(__dirname, '..', 'assets', 'fonts');
  const appJson = JSON.parse(readFileSync(join(__dirname, '..', 'app.json'), 'utf8')) as {
    expo: { plugins: unknown[] };
  };
  const plugin = appJson.expo.plugins.find((x) => Array.isArray(x) && x[0] === 'expo-font') as
    [string, { fonts: string[] }] | undefined;
  const embedded = (plugin?.[1].fonts ?? []).map((f) => f.split('/').pop());

  it.each(Object.keys(fontSets) as FontSetKey[])(
    'font set %s: every family is a file in assets/fonts and embedded by the expo-font plugin',
    (key) => {
      const set = fontSets[key];
      for (const name of [...Object.values(set.text), ...Object.values(set.display)]) {
        expect(existsSync(join(fontDir, `${name}.ttf`))).toBe(true);
        expect(embedded).toContain(`${name}.ttf`);
      }
    },
  );

  it('the default font is one token', () => {
    expect(fontSets[DEFAULT_FONT]).toBeDefined();
    expect(buildTheme('dark').fonts).toBe(fontSets[DEFAULT_FONT]);
    expect(buildTheme('dark', 'standard', 'C').fonts.display['800']).toBe('Unbounded_800ExtraBold');
  });
});

describe('buildTheme', () => {
  it('picks the palette by name and contrast', () => {
    expect(buildTheme('dark').colors).toBe(palettes.standard.dark);
    expect(buildTheme('light', 'high').colors).toBe(palettes.high.light);
    expect(buildTheme('light').spacing.xl).toBe(20);
  });
});
