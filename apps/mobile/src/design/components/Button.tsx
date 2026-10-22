import { Pressable, StyleSheet, View } from 'react-native';
import { haptics } from '../haptics';
import { useTheme } from '../theme';
import { MIN_TOUCH } from '../tokens';
import { AppText } from './AppText';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: 'filled' | 'tonal' | 'text';
  disabled?: boolean;
  accessibilityHint?: string;
}

export function Button({
  label,
  onPress,
  variant = 'filled',
  disabled,
  accessibilityHint,
}: ButtonProps) {
  const { colors, radius, spacing } = useTheme();
  const c = colors.chrome;
  const bg =
    variant === 'filled' ? c.primary : variant === 'tonal' ? c.primaryContainer : 'transparent';
  const fg =
    variant === 'filled' ? c.onPrimary : variant === 'tonal' ? c.onPrimaryContainer : c.primary;
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
          minHeight: MIN_TOUCH,
          paddingHorizontal: spacing.xl,
          borderRadius: radius.full,
          backgroundColor: bg,
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
        },
      ]}
    >
      <View>
        <AppText variant="label" color={fg}>
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({ base: { alignItems: 'center', justifyContent: 'center' } });
