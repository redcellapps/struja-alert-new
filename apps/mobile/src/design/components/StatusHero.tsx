import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme';
import { icons, type StatusKey } from '../tokens';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { MeshBackground } from './MeshBackground';

export interface StatusHeroProps {
  status: StatusKey;
  // The short status word above the headline ("Sve u redu", "U toku").
  statusLabel: string;
  headline: string;
  // The address the status is about.
  address?: string;
  // Slot for the countdown / window under the headline.
  children?: ReactNode;
  // A full spoken sentence for TalkBack.
  accessibilityLabel: string;
}

function PulseRing({ color, enabled }: { color: string; enabled: boolean }) {
  const t = useSharedValue(0);
  const { motion } = useTheme();
  useEffect(() => {
    if (!enabled) return;
    t.value = withRepeat(
      withTiming(1, { duration: motion.duration.pulse, easing: Easing.out(Easing.quad) }),
      -1,
      false,
    );
  }, [enabled, motion.duration.pulse, t]);
  const style = useAnimatedStyle(() => ({
    opacity: enabled ? 0.55 * (1 - t.value) : 0,
    transform: [{ scale: 1 + t.value * 0.55 }],
  }));
  return <Animated.View style={[styles.ring, { borderColor: color }, style]} />;
}

/**
 * The signature element of Home: a status-tinted gradient mesh with the status icon, a short label,
 * the headline and a slot for the countdown. The content cross-fades when the status changes, and the
 * active state pulses gently (not when animations are off).
 */
export function StatusHero({
  status,
  statusLabel,
  headline,
  address,
  children,
  accessibilityLabel,
}: StatusHeroProps) {
  const { colors, radius, spacing, motion } = useTheme();
  const s = colors.status[status];
  const reduced = useReducedMotion();
  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={accessibilityLabel}
      style={[styles.card, { borderRadius: radius.xl, borderColor: s.accent + '55' }]}
    >
      <Animated.View
        key={status}
        entering={reduced ? undefined : FadeIn.duration(motion.duration.hero)}
        exiting={reduced ? undefined : FadeOut.duration(motion.duration.hero)}
        style={StyleSheet.absoluteFill}
      >
        <MeshBackground status={status} />
      </Animated.View>
      <Animated.View
        key={`content-${status}`}
        entering={reduced ? undefined : FadeIn.duration(motion.duration.slow)}
        style={{ padding: spacing.xxl, gap: spacing.md }}
      >
        <View style={styles.statusRow}>
          <View>
            <PulseRing color={s.accent} enabled={status === 'active' && !reduced} />
            <View style={[styles.iconDot, { backgroundColor: s.accent }]}>
              <Icon name={icons[status]} size={22} color={colors.chrome.surface} />
            </View>
          </View>
          <AppText variant="label" color={s.onContainer} style={styles.statusLabel}>
            {statusLabel.toUpperCase()}
          </AppText>
        </View>
        <AppText variant="headline" color={s.onContainer}>
          {headline}
        </AppText>
        {address ? (
          <AppText variant="body" color={s.onContainer} style={styles.address}>
            {address}
          </AppText>
        ) : null}
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden', borderWidth: 1 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusLabel: { letterSpacing: 1.2 },
  address: { opacity: 0.85 },
  iconDot: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: { position: 'absolute', width: 40, height: 40, borderRadius: 20, borderWidth: 2 },
});
