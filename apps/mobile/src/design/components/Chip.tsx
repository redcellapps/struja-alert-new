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

/** Filled selection chip (never outlined): raised fill, lime when selected. */
export function Chip({ label, selected, onPress, accessibilityLabel }: ChipProps) {
  const { colors, radius } = useTheme();
  const c = colors.chrome;
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
          minHeight: onPress ? MIN_TOUCH : 36,
          borderRadius: radius.md,
          backgroundColor: selected ? c.accent : c.raised,
        },
      ]}
    >
      <AppText variant="label" color={selected ? c.onAccent : c.text}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
});
