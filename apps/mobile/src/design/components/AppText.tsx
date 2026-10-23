import { Text, type TextProps, type TextStyle } from 'react-native';
import { useTheme } from '../theme';
import { type ChromeColors, type TextStyleToken, type TypographyKey } from '../tokens';

export interface AppTextProps extends TextProps {
  variant?: TypographyKey;
  // A chrome colour role, or an explicit colour (status text on a fill).
  color?: keyof ChromeColors | (string & {});
}

/** The one text component: tokens for font, size and colour; font scaling always on. */
export function AppText({ variant = 'body', color = 'text', style, ...rest }: AppTextProps) {
  const theme = useTheme();
  const token: TextStyleToken = theme.typography[variant];
  const resolved =
    color in theme.colors.chrome ? theme.colors.chrome[color as keyof ChromeColors] : color;
  const scale = token.role === 'display' ? theme.fonts.displayScale : 1;
  const base: TextStyle = {
    // The weight is part of the family name (static font files); fontWeight stays normal.
    fontFamily: theme.fonts[token.role][token.weight],
    fontWeight: 'normal',
    fontSize: Math.round(token.fontSize * scale),
    lineHeight: Math.round(token.lineHeight * scale),
    letterSpacing: token.tracking ? token.tracking * token.fontSize * scale : undefined,
    color: resolved,
  };
  return <Text allowFontScaling maxFontSizeMultiplier={2} style={[base, style]} {...rest} />;
}
