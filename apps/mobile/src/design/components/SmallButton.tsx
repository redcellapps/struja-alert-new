import { Pressable, StyleSheet } from 'react-native';
import { haptics } from '../haptics';
import { useTheme } from '../theme';
import { MIN_TOUCH, type IconName } from '../tokens';
import { AppText } from './AppText';
import { Icon } from './Icon';

export interface SmallButtonProps {
  label: string;
  icon: IconName;
  // neutral: the raised fill; danger: the red of "Obriši sve", for what cannot be undone.
  tone?: 'neutral' | 'danger';
  // The chosen one of a few ("Glavna adresa" on the primary address): lime.
  selected?: boolean;
  onPress?: () => void;
  // Spoken instead of the label when the label alone is ambiguous (which address).
  accessibilityLabel?: string;
  disabled?: boolean;
}

/** A compact action with an icon and a short word, 48 high so it stays easy to hit. */
export function SmallButton({
  label,
  icon,
  tone = 'neutral',
  selected,
  onPress,
  accessibilityLabel,
  disabled,
}: SmallButtonProps) {
  const { colors, radius } = useTheme();
  const c = colors.chrome;
  const red = colors.status.active;
  const bg = tone === 'danger' ? red.fill : selected ? c.accent : c.raised;
  const fg = tone === 'danger' ? red.onFill : selected ? c.onAccent : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      disabled={disabled || !onPress}
      onPress={() => {
        haptics.light();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: MIN_TOUCH,
          borderRadius: radius.md,
          backgroundColor: bg,
          opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <Icon name={icon} size={18} color={fg} />
      <AppText variant="label" color={fg}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
  },
});
