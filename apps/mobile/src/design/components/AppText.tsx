import { Text, type TextProps, type TextStyle } from 'react-native';
import { useTheme } from '../theme';
import { tabularNums, type ChromeColors, type TypographyKey } from '../tokens';

export interface AppTextProps extends TextProps {
  variant?: TypographyKey;
  // A chrome colour role, or an explicit colour (status text on a container).
  color?: keyof ChromeColors | (string & {});
  tabular?: boolean;
}

/** The one text component: tokens for size and colour, font scaling always on. */
export function AppText({
  variant = 'body',
  color = 'onSurface',
  tabular,
  style,
  ...rest
}: AppTextProps) {
  const theme = useTheme();
  const resolved =
    color in theme.colors.chrome ? theme.colors.chrome[color as keyof ChromeColors] : color;
  const base: TextStyle = {
    ...theme.typography[variant],
    color: resolved,
    ...(tabular || variant === 'countdown' ? { fontVariant: [...tabularNums] } : null),
  };
  return <Text allowFontScaling maxFontSizeMultiplier={2} style={[base, style]} {...rest} />;
}
