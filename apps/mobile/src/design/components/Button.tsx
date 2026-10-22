import { Pressable, StyleSheet } from 'react-native';
import { haptics } from '../haptics';
import { useTheme } from '../theme';
import { BUTTON_HEIGHT, MIN_TOUCH } from '../tokens';
import { AppText } from './AppText';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  // primary: lime with dark text; secondary: the raised fill; text: lime text on dark, primary text on light.
  variant?: 'primary' | 'secondary' | 'text';
  disabled?: boolean;
  // Full width (the default for primary) or as wide as its label.
  fullWidth?: boolean;
  accessibilityHint?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  fullWidth,
  accessibilityHint,
}: ButtonProps) {
  const { colors, radius } = useTheme();
  const c = colors.chrome;
  const bg = variant === 'primary' ? c.accent : variant === 'secondary' ? c.raised : 'transparent';
  const fg = variant === 'primary' ? c.onAccent : variant === 'secondary' ? c.text : c.link;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={() => {
        haptics.light();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: variant === 'text' ? MIN_TOUCH : BUTTON_HEIGHT,
          paddingHorizontal: variant === 'text' ? 12 : 24,
          borderRadius: radius.md,
          backgroundColor: bg,
          opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
        },
        (fullWidth ?? variant === 'primary') && styles.full,
      ]}
    >
      <AppText variant="button" color={fg}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  full: { alignSelf: 'stretch' },
});
