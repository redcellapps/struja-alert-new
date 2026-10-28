import type { Theme } from './theme';
import type { TabsChrome } from './tabsChrome.types';

/**
 * How the tab bar follows the design system on Android: the card colour, a lime indicator with a dark
 * icon, and the label of every tab always visible. No Material You tint. (`tabsChrome.ios.ts` has iOS.)
 */
export function tabsChrome(theme: Pick<Theme, 'colors' | 'fonts'>, labelSize: number): TabsChrome {
  const c = theme.colors.chrome;
  return {
    backgroundColor: c.card,
    indicatorColor: c.accent,
    rippleColor: c.raised,
    iconColor: { default: c.textSecondary, selected: c.onAccent },
    labelVisibilityMode: 'labeled',
    labelStyle: {
      default: { color: c.textSecondary, fontFamily: theme.fonts.text['500'], fontSize: labelSize },
      selected: { color: c.text, fontFamily: theme.fonts.text['700'], fontSize: labelSize },
    },
  };
}
