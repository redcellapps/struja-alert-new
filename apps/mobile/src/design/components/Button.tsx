import { Pressable, StyleSheet } from 'react-native';
import { haptics } from '../haptics';
import { useTheme } from '../theme';
import { BUTTON_HEIGHT, MIN_TOUCH } from '../tokens';
import { AppText } from './AppText';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  // primary: lime with dark text; secondary: the raised fill; text: lime text on dark, primary text on
  // light; danger: the red of an outage in progress, for what cannot be undone.
  variant?: 'primary' | 'secondary' | 'text' | 'danger';
  disabled?: boolean;
  // Full width (the default for primary) or as wide as its label.
  fullWidth?: boolean;
  accessibilityHint?: string;
  // Spoken instead of the label when the label alone is ambiguous ("Prati" in a list of streets).
  accessibilityLabel?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  fullWidth,
  accessibilityHint,
  accessibilityLabel,
}: ButtonProps) {
  const { colors, radius } = useTheme();
  const c = colors.chrome;
  const red = colors.status.active;
  const bg =
    variant === 'primary'
      ? c.accent
      : variant === 'secondary'
        ? c.raised
        : variant === 'danger'
          ? red.fill
          : 'transparent';
  const fg =
    variant === 'primary'
      ? c.onAccent
      : variant === 'secondary'
        ? c.text
        : variant === 'danger'
          ? red.onFill
          : c.link;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
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
        (fullWidth ?? (variant === 'primary' || variant === 'danger')) && styles.full,
      ]}
    >
      {/* scales like the rest of the text; a word wider than the button is hyphenated, not cut */}
      <AppText variant="button" color={fg} android_hyphenationFrequency="normal">
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  full: { alignSelf: 'stretch' },
});
