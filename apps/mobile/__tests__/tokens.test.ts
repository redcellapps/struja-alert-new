import { contrastRatio } from '../src/design/contrast';
import { buildTheme } from '../src/design/theme';
import { palettes, STATUS_KEYS, type ContrastLevel, type ThemeName } from '../src/design/tokens';

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
      'status %s: text on its container is readable, the accent is visible on the surface',
      (key) => {
        const s = p.status[key];
        expect(contrastRatio(s.onContainer, s.container)).toBeGreaterThanOrEqual(textMin);
        // icons and borders (non-text UI) need 3:1 against the surface they sit on
        expect(contrastRatio(s.accent, p.chrome.surface)).toBeGreaterThanOrEqual(3);
      },
    );

    it('chrome text is readable on the surfaces it sits on', () => {
      const c = p.chrome;
      for (const bg of [c.surface, c.surfaceContainer, c.surfaceContainerHigh]) {
        expect(contrastRatio(c.onSurface, bg)).toBeGreaterThanOrEqual(textMin);
        expect(contrastRatio(c.onSurfaceVariant, bg)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastRatio(c.onPrimary, c.primary)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.onPrimaryContainer, c.primaryContainer)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.outline, c.surface)).toBeGreaterThanOrEqual(3);
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

describe('buildTheme', () => {
  it('picks the palette by name and contrast', () => {
    expect(buildTheme('dark').colors).toBe(palettes.standard.dark);
    expect(buildTheme('light', 'high').colors).toBe(palettes.high.light);
    expect(buildTheme('light').spacing.lg).toBe(16);
  });
});
