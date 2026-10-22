import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme';

export interface SkeletonCardProps {
  // Number of text-like lines inside the card.
  lines?: number;
  accessibilityLabel: string;
}

/** A loading placeholder shaped like a card. Never a full-screen spinner. */
export function SkeletonCard({ lines = 2, accessibilityLabel }: SkeletonCardProps) {
  const { colors, radius, spacing, motion } = useTheme();
  const reduced = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    t.value = withRepeat(withTiming(1, { duration: motion.duration.pulse }), -1, true);
  }, [reduced, motion.duration.pulse, t]);
  const style = useAnimatedStyle(() => ({ opacity: reduced ? 0.7 : 0.45 + t.value * 0.4 }));
  const bar = { backgroundColor: colors.chrome.surfaceContainerHigh, borderRadius: radius.sm };
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.card,
        {
          backgroundColor: colors.chrome.surfaceContainer,
          borderRadius: radius.lg,
          padding: spacing.lg,
          gap: spacing.md,
        },
      ]}
    >
      <Animated.View style={[style, { gap: spacing.md }]}>
        <View style={[bar, { height: 14, width: '35%' }]} />
        <View style={[bar, { height: 20, width: '70%' }]} />
        {Array.from({ length: lines }, (_, i) => (
          <View key={i} style={[bar, { height: 14, width: i === lines - 1 ? '50%' : '90%' }]} />
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({ card: { minHeight: 112 } });
