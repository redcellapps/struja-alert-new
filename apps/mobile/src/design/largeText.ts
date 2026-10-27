import { useWindowDimensions } from 'react-native';

// Above this system font scale a row of side-by-side things stops fitting on a phone: it is laid out as
// a column, buttons full width.
export const LARGE_TEXT_SCALE = 1.3;
// Bento tiles go one per row from this font scale, or on a screen narrower than NARROW_DP.
export const STACK_TILES_SCALE = 1.5;
export const NARROW_DP = 400;

/** The system font scale (React Native 0.88 refreshes it on resume only: see docs/known-limits.md); it follows a change made in the system settings while the app is open. */
export const useFontScale = (): number => useWindowDimensions().fontScale;

/** True when the system font is large enough that side-by-side rows should stack. */
export const useLargeText = (): boolean => useFontScale() > LARGE_TEXT_SCALE;

/** True when two tiles no longer fit side by side: a large font (150 %) or a screen under 400 dp. */
export function useStackTiles(): boolean {
  const { width, fontScale } = useWindowDimensions();
  return fontScale >= STACK_TILES_SCALE || width < NARROW_DP;
}

/** True when a heading and its action no longer fit on one line: large text, or a raised font on a narrow screen. */
export function useStackHeader(): boolean {
  const { width, fontScale } = useWindowDimensions();
  return fontScale > LARGE_TEXT_SCALE || (width < NARROW_DP && fontScale > 1.1);
}
