import type { Theme } from './theme';
import type { TabsChrome } from './tabsChrome.types';

/**
 * **[MAC]** The iOS tab bar. A stub that compiles (typecheck, Metro bundle) but has never run on a device:
 * the iOS smoke build is Phase 6, on a Mac. On iOS 26 the system draws the tab bar as Liquid Glass and
 * `backgroundColor`, `blurEffect` and the indicator and ripple props have no effect, so the bar is left to
 * the system: only the label fonts and the colours of the icons and labels follow the design system
 * (the lime accent is a fill, so the selected icon and label use the text colour instead of a lime
 * indicator). To decide on the Mac: `minimizeBehavior: 'onScrollDown'` (the bar shrinks while scrolling),
 * and whether the selected tint should be the accent on the dark theme only.
 */
export function tabsChrome(theme: Pick<Theme, 'colors' | 'fonts'>, labelSize: number): TabsChrome {
  const c = theme.colors.chrome;
  return {
    iconColor: { default: c.textSecondary, selected: c.text },
    labelStyle: {
      default: { color: c.textSecondary, fontFamily: theme.fonts.text['500'], fontSize: labelSize },
      selected: { color: c.text, fontFamily: theme.fonts.text['700'], fontSize: labelSize },
    },
  };
}
