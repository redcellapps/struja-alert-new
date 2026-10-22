import { Platform } from 'react-native';

// Design tokens in one place (BRIEF §7, docs/design/direction.md). Flat fills, no gradients, one
// lime accent, one embedded font family. Every status has an icon and a text label: colour is never
// the only signal.

export type StatusKey = 'clear' | 'upcoming' | 'imminent' | 'active' | 'past';
export const STATUS_KEYS: readonly StatusKey[] = [
  'clear',
  'upcoming',
  'imminent',
  'active',
  'past',
];

export type ThemeName = 'light' | 'dark';
export type ContrastLevel = 'standard' | 'high';

export interface StatusColors {
  // The flat fill of the hero card and the status badge, and the text drawn on it (4.5:1).
  fill: string;
  onFill: string;
  // Dots, bars and icons drawn on the page or a card (non-text UI: 3:1 against both).
  mark: string;
}

export interface ChromeColors {
  background: string;
  card: string;
  // Raised or pressed card, unselected chip, track, secondary button.
  raised: string;
  text: string;
  textSecondary: string;
  // Electric lime. A fill only (selected chip, primary button, selected day, switch on); the text on
  // it is always `onAccent`. Never used as text on a light background, see `link`.
  accent: string;
  onAccent: string;
  // Text-button colour: lime on dark, primary text on light.
  link: string;
  // Borders of unchecked controls and focus (3:1).
  outline: string;
  error: string;
  scrim: string;
}

export interface Palette {
  chrome: ChromeColors;
  status: Record<StatusKey, StatusColors>;
}

const LIME = '#D4F84A';
const NEAR_BLACK = '#0B0B0D';

const darkStandard: Palette = {
  chrome: {
    background: NEAR_BLACK,
    card: '#18181B',
    raised: '#222226',
    text: '#F5F5F7',
    textSecondary: '#9A9AA3',
    accent: LIME,
    onAccent: NEAR_BLACK,
    link: LIME,
    outline: '#6A6A74',
    error: '#FF6B6E',
    scrim: '#000000',
  },
  status: {
    clear: { fill: LIME, onFill: NEAR_BLACK, mark: LIME },
    upcoming: { fill: '#FFC23D', onFill: NEAR_BLACK, mark: '#FFC23D' },
    imminent: { fill: '#FF8A3D', onFill: NEAR_BLACK, mark: '#FF8A3D' },
    active: { fill: '#DC2F34', onFill: '#FFFFFF', mark: '#FF5A5C' },
    past: { fill: '#222226', onFill: '#9A9AA3', mark: '#9A9AA3' },
  },
};

const lightStandard: Palette = {
  chrome: {
    background: '#F2F2F5',
    card: '#FFFFFF',
    raised: '#E9E9EE',
    text: NEAR_BLACK,
    textSecondary: '#5C5C66',
    accent: LIME,
    onAccent: NEAR_BLACK,
    link: NEAR_BLACK,
    outline: '#84848E',
    error: '#B3261E',
    scrim: '#000000',
  },
  status: {
    clear: { fill: LIME, onFill: NEAR_BLACK, mark: '#5C8200' },
    upcoming: { fill: '#FFC23D', onFill: NEAR_BLACK, mark: '#9E6A00' },
    imminent: { fill: '#FF8A3D', onFill: NEAR_BLACK, mark: '#C44D08' },
    active: { fill: '#DC2F34', onFill: '#FFFFFF', mark: '#DC2F34' },
    past: { fill: '#E9E9EE', onFill: '#5C5C66', mark: '#5C5C66' },
  },
};

const darkHigh: Palette = {
  chrome: {
    ...darkStandard.chrome,
    background: '#000000',
    card: '#121214',
    raised: '#26262A',
    text: '#FFFFFF',
    textSecondary: '#D0D0D6',
    outline: '#A0A0AA',
  },
  status: {
    ...darkStandard.status,
    active: { fill: '#A50E14', onFill: '#FFFFFF', mark: '#FF8A8C' },
    past: { fill: '#26262A', onFill: '#D0D0D6', mark: '#D0D0D6' },
  },
};

const lightHigh: Palette = {
  chrome: {
    ...lightStandard.chrome,
    background: '#FFFFFF',
    card: '#FFFFFF',
    raised: '#E4E4EA',
    text: '#000000',
    textSecondary: '#3A3A42',
    link: '#000000',
    outline: '#55555F',
  },
  status: {
    ...lightStandard.status,
    clear: { fill: LIME, onFill: '#000000', mark: '#3F5C00' },
    upcoming: { fill: '#FFC23D', onFill: '#000000', mark: '#6E4A00' },
    imminent: { fill: '#FF8A3D', onFill: '#000000', mark: '#8A3000' },
    active: { fill: '#A50E14', onFill: '#FFFFFF', mark: '#A50E14' },
    past: { fill: '#E4E4EA', onFill: '#3A3A42', mark: '#3A3A42' },
  },
};

export const palettes: Record<ContrastLevel, Record<ThemeName, Palette>> = {
  standard: { light: lightStandard, dark: darkStandard },
  high: { light: lightHigh, dark: darkHigh },
};

// Spacing on a 4-pt grid: 20 side margins and card padding, 12 between cards, 28-32 between sections.
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  section: 28,
  xxxl: 32,
  huge: 48,
} as const;
export const SIDE_MARGIN = 20;
export const CARD_PADDING = 20;
export const CARD_GAP = 12;

// 24 for cards, 16 for inputs, tiles and buttons, 20 for the day tiles; a full pill only for small
// badges.
export const radius = {
  xs: 8,
  md: 16,
  lg: 20,
  xl: 24,
  full: 999,
} as const;

// Minimum touch targets: 48 dp on Android, 44 pt on iOS.
export const MIN_TOUCH = Platform.select({ ios: 44, default: 48 });
export const BUTTON_HEIGHT = 56;

// ---- Fonts ------------------------------------------------------------------------------------
// One family, embedded at build time (the expo-font config plugin in app.json lists the files).
// Static weight files only; on Android the weight is part of the family name. The font is ONE token:
// change DEFAULT_FONT to switch the whole app.

export type FontWeight = '400' | '500' | '600' | '700' | '800';
export type FontRole = 'text' | 'display';
export type FontSetKey = 'A' | 'B' | 'C';

export interface FontSet {
  name: string;
  // Family name per weight for ordinary text, and for the big numerals and headlines.
  text: Record<FontWeight, string>;
  display: Record<FontWeight, string>;
  // Wide display faces (Unbounded) are drawn smaller to take the same width.
  displayScale: number;
}

const family = (name: string): Record<FontWeight, string> => ({
  '400': `${name}_400Regular`,
  '500': `${name}_500Medium`,
  '600': `${name}_600SemiBold`,
  '700': `${name}_700Bold`,
  '800': `${name}_800ExtraBold`,
});

const onest = family('Onest');
const manrope = family('Manrope');
// Unbounded ships only SemiBold, Bold and ExtraBold here (display use); lighter weights fall back.
const unbounded: Record<FontWeight, string> = {
  '400': 'Unbounded_600SemiBold',
  '500': 'Unbounded_600SemiBold',
  '600': 'Unbounded_600SemiBold',
  '700': 'Unbounded_700Bold',
  '800': 'Unbounded_800ExtraBold',
};

export const fontSets: Record<FontSetKey, FontSet> = {
  A: { name: 'Onest', text: onest, display: onest, displayScale: 1 },
  B: { name: 'Manrope', text: manrope, display: manrope, displayScale: 1 },
  C: { name: 'Unbounded + Onest', text: onest, display: unbounded, displayScale: 0.78 },
};
export const DEFAULT_FONT: FontSetKey = 'A';

export interface TextStyleToken {
  fontSize: number;
  lineHeight: number;
  weight: FontWeight;
  role: FontRole;
  // In em (-0.005 = -0.5 %).
  tracking?: number;
}

// Scale from docs/design/direction.md. Sizes follow the user's font setting (allowFontScaling stays on).
export const typography = {
  displayHuge: { fontSize: 72, lineHeight: 80, weight: '800', role: 'display', tracking: -0.01 },
  display: { fontSize: 56, lineHeight: 64, weight: '800', role: 'display', tracking: -0.01 },
  // The countdown inside the hero and tiles.
  countdown: { fontSize: 48, lineHeight: 56, weight: '800', role: 'display', tracking: -0.01 },
  headline: { fontSize: 30, lineHeight: 36, weight: '700', role: 'display', tracking: -0.005 },
  // The one big value in a half-width bento tile.
  tile: { fontSize: 36, lineHeight: 42, weight: '800', role: 'display', tracking: -0.01 },
  // Big time on an address card ("08:30–12:30").
  value: { fontSize: 24, lineHeight: 30, weight: '700', role: 'display', tracking: -0.005 },
  title: { fontSize: 20, lineHeight: 26, weight: '600', role: 'text' },
  body: { fontSize: 16, lineHeight: 24, weight: '400', role: 'text' },
  bodyStrong: { fontSize: 16, lineHeight: 24, weight: '600', role: 'text' },
  label: { fontSize: 14, lineHeight: 20, weight: '500', role: 'text' },
  button: { fontSize: 17, lineHeight: 22, weight: '700', role: 'text' },
  caption: { fontSize: 13, lineHeight: 18, weight: '500', role: 'text' },
} satisfies Record<string, TextStyleToken>;
export type TypographyKey = keyof typeof typography;

export const tabularNums = ['tabular-nums'] as const;

// Reanimated springs and durations; non-essential motion is skipped when the system asks for it.
export const motion = {
  spring: {
    gentle: { damping: 20, stiffness: 140, mass: 1 },
    snappy: { damping: 18, stiffness: 320, mass: 0.9 },
    soft: { damping: 26, stiffness: 90, mass: 1.1 },
  },
  duration: { fast: 120, base: 220, slow: 420, hero: 600, pulse: 1600 },
  stagger: 40,
} as const;

// Material Symbols Rounded (filled, one weight) on Android; SF Symbols on iOS.
export interface IconName {
  ios: string;
  android: string;
}
export const icons: Record<StatusKey, IconName> = {
  clear: { android: 'bolt', ios: 'bolt.fill' },
  upcoming: { android: 'schedule', ios: 'clock.fill' },
  imminent: { android: 'timer', ios: 'timer' },
  active: { android: 'power_off', ios: 'bolt.slash.fill' },
  past: { android: 'history', ios: 'clock.arrow.circlepath' },
};
