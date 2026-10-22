import { Platform } from 'react-native';

// Design tokens in one place (BRIEF §7). Status colours are fixed and semantic; the chrome colours
// are the fallback palette that Material You dynamic colour replaces on Android 12+ (Phase 3,
// step 2 checks how). Every status has an icon and a text label: colour is never the only signal.

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
  // Icons, borders, the pulse: must reach 3:1 on the surface (non-text UI).
  accent: string;
  // Hero / card background tinted by the status, and the text drawn on it (4.5:1).
  container: string;
  onContainer: string;
}

export interface ChromeColors {
  surface: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  onSurface: string;
  onSurfaceVariant: string;
  outline: string;
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  error: string;
  scrim: string;
}

export interface Palette {
  chrome: ChromeColors;
  status: Record<StatusKey, StatusColors>;
}

const lightStandard: Palette = {
  chrome: {
    surface: '#FAFAF7',
    surfaceContainer: '#F0F0EB',
    surfaceContainerHigh: '#E8E8E2',
    onSurface: '#1B1C1A',
    onSurfaceVariant: '#464843',
    outline: '#6E706A',
    primary: '#2B5C8C',
    onPrimary: '#FFFFFF',
    primaryContainer: '#D3E4FA',
    onPrimaryContainer: '#0A2744',
    error: '#B3261E',
    scrim: '#000000',
  },
  status: {
    clear: { accent: '#1B7A3A', container: '#D5F0DB', onContainer: '#0A3A1A' },
    upcoming: { accent: '#9A6700', container: '#FFEDB8', onContainer: '#3F2B00' },
    imminent: { accent: '#B84300', container: '#FFDFCB', onContainer: '#521C00' },
    active: { accent: '#B3261E', container: '#FFD9D4', onContainer: '#410002' },
    past: { accent: '#5F6368', container: '#E6E8EA', onContainer: '#1F2022' },
  },
};

const darkStandard: Palette = {
  chrome: {
    surface: '#121311',
    surfaceContainer: '#1D1E1B',
    surfaceContainerHigh: '#272825',
    onSurface: '#E4E4DF',
    onSurfaceVariant: '#C5C7C0',
    outline: '#8F918A',
    primary: '#A8C8F0',
    onPrimary: '#0A2744',
    primaryContainer: '#1F4570',
    onPrimaryContainer: '#D3E4FA',
    error: '#FFB4AB',
    scrim: '#000000',
  },
  status: {
    clear: { accent: '#6FD08A', container: '#0F3D1E', onContainer: '#C2F0CC' },
    upcoming: { accent: '#F2C14E', container: '#4A3500', onContainer: '#FFE59A' },
    imminent: { accent: '#FF9A5C', container: '#5C2300', onContainer: '#FFCDAE' },
    active: { accent: '#FF6B61', container: '#5C0A0A', onContainer: '#FFB9B2' },
    past: { accent: '#9AA0A6', container: '#2C2F33', onContainer: '#CDD0D4' },
  },
};

const lightHigh: Palette = {
  chrome: {
    ...lightStandard.chrome,
    surface: '#FFFFFF',
    onSurface: '#000000',
    onSurfaceVariant: '#1F201D',
    outline: '#3B3D38',
    primary: '#0B3A66',
    primaryContainer: '#C2DAF7',
  },
  status: {
    clear: { accent: '#0B5A24', container: '#C6EBCF', onContainer: '#001D09' },
    upcoming: { accent: '#6E4A00', container: '#FFE49A', onContainer: '#1F1400' },
    imminent: { accent: '#8A3000', container: '#FFD0B4', onContainer: '#2A0E00' },
    active: { accent: '#8C1912', container: '#FFC9C2', onContainer: '#1F0001' },
    past: { accent: '#3F4347', container: '#DADDE0', onContainer: '#000000' },
  },
};

const darkHigh: Palette = {
  chrome: {
    ...darkStandard.chrome,
    surface: '#000000',
    onSurface: '#FFFFFF',
    onSurfaceVariant: '#E6E8E1',
    outline: '#C5C7C0',
    primary: '#C9DEF8',
  },
  status: {
    clear: { accent: '#8FE3A7', container: '#052A12', onContainer: '#DDFBE4' },
    upcoming: { accent: '#FFD56E', container: '#2E2000', onContainer: '#FFF1C2' },
    imminent: { accent: '#FFB07F', container: '#3E1500', onContainer: '#FFE6D6' },
    active: { accent: '#FF9086', container: '#3E0505', onContainer: '#FFE0DC' },
    past: { accent: '#C0C5CA', container: '#1A1C1E', onContainer: '#F1F2F3' },
  },
};

export const palettes: Record<ContrastLevel, Record<ThemeName, Palette>> = {
  standard: { light: lightStandard, dark: darkStandard },
  high: { light: lightHigh, dark: darkHigh },
};

// Spacing on a 4-pt grid, 16-pt side margins.
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;
export const SIDE_MARGIN = 16;

// 20–24 corner radii (continuous curves are an iOS-only refinement, added with the iOS polish).
export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  xl: 24,
  full: 999,
} as const;

// Minimum touch targets: 48 dp on Android, 44 pt on iOS.
export const MIN_TOUCH = Platform.select({ ios: 44, default: 48 });

export interface TextStyleToken {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '500' | '600' | '700' | '800';
  letterSpacing?: number;
}

// System font on each platform; sizes scale with the user's font setting (allowFontScaling stays on).
export const typography = {
  display: { fontSize: 44, lineHeight: 52, fontWeight: '800', letterSpacing: -0.5 },
  headline: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '500', letterSpacing: 0.1 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400', letterSpacing: 0.2 },
  // Countdown numerals: heavy, with tabular digits so they do not jitter (see tabularNums).
  countdown: { fontSize: 40, lineHeight: 46, fontWeight: '800', letterSpacing: -0.5 },
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
  duration: { fast: 120, base: 220, slow: 420, hero: 600, pulse: 1600, mesh: 14000 },
  stagger: 40,
} as const;

export const icons: Record<StatusKey, { ios: string; android: string }> = {
  clear: { android: 'bolt', ios: 'bolt.fill' },
  upcoming: { android: 'schedule', ios: 'clock.fill' },
  imminent: { android: 'timer', ios: 'timer' },
  active: { android: 'power_off', ios: 'bolt.slash.fill' },
  past: { android: 'history', ios: 'clock.arrow.circlepath' },
};
