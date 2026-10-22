import { Pressable, StyleSheet } from 'react-native';
import { haptics } from '../haptics';
import { useTheme } from '../theme';
import { MIN_TOUCH } from '../tokens';
import { AppText } from './AppText';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}

/** Selection chip (address labels) or a read-only chip when `onPress` is missing. */
export function Chip({ label, selected, onPress, accessibilityLabel }: ChipProps) {
  const { colors, radius, spacing } = useTheme();
  const c = colors.chrome;
  const bg = selected ? c.primaryContainer : c.surfaceContainer;
  const fg = selected ? c.onPrimaryContainer : c.onSurface;
  return (
    <Pressable
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: !!selected }}
      onPress={() => {
        haptics.selection();
        onPress?.();
      }}
      style={[
        styles.base,
        {
          minHeight: onPress ? MIN_TOUCH : 32,
          paddingHorizontal: spacing.lg,
          borderRadius: radius.full,
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: selected ? c.primary : c.outline,
        },
      ]}
    >
      <AppText variant="label" color={fg}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({ base: { alignItems: 'center', justifyContent: 'center' } });
