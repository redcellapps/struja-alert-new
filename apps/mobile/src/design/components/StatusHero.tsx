import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { CARD_PADDING } from '../tokens';
import { useTheme } from '../theme';
import { AppText } from './AppText';
import { BoltWatermark } from './BoltWatermark';
import { StatusBadge } from './StatusBadge';
import type { StatusKey } from '../tokens';

export interface StatusHeroProps {
  status: StatusKey;
  // The short status word in the badge ("Sve u redu", "U toku").
  statusLabel: string;
  headline: string;
  // The address the status is about.
  address?: string;
  // Slot for the countdown / window under the headline.
  children?: ReactNode;
  // A full spoken sentence for TalkBack.
  accessibilityLabel: string;
}

// The active state pulses gently, on the badge only.
function PulsingBadge({
  status,
  label,
  enabled,
}: {
  status: StatusKey;
  label: string;
  enabled: boolean;
}) {
  const t = useSharedValue(0);
  const { motion } = useTheme();
  useEffect(() => {
    if (!enabled) return;
    t.value = withRepeat(withTiming(1, { duration: motion.duration.pulse }), -1, true);
  }, [enabled, motion.duration.pulse, t]);
  const style = useAnimatedStyle(() => ({ opacity: enabled ? 1 - t.value * 0.4 : 1 }));
  return (
    <Animated.View style={style}>
      <StatusBadge status={status} label={label} onFill />
    </Animated.View>
  );
}

/**
 * The signature element of Home: a flat card in the status colour with a faint bolt watermark, the
 * status badge, a bold headline, the address and a slot for the huge countdown or time. The content
 * cross-fades when the status changes.
 */
export function StatusHero({
  status,
  statusLabel,
  headline,
  address,
  children,
  accessibilityLabel,
}: StatusHeroProps) {
  const { colors, radius, motion } = useTheme();
  const s = colors.status[status];
  const reduced = useReducedMotion();
  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={accessibilityLabel}
      style={[styles.card, { borderRadius: radius.xl, backgroundColor: s.fill }]}
    >
      <View style={styles.watermark} pointerEvents="none">
        <BoltWatermark color={s.onFill} />
      </View>
      <Animated.View
        key={`content-${status}`}
        entering={reduced ? undefined : FadeIn.duration(motion.duration.hero)}
        style={{ padding: CARD_PADDING, gap: 12 }}
      >
        <PulsingBadge
          status={status}
          label={statusLabel}
          enabled={status === 'active' && !reduced}
        />
        <View style={{ gap: 4 }}>
          <AppText variant="headline" color={s.onFill}>
            {headline}
          </AppText>
          {address ? (
            <AppText variant="body" color={s.onFill} style={styles.address}>
              {address}
            </AppText>
          ) : null}
        </View>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden' },
  watermark: { position: 'absolute', right: -44, bottom: -52 },
  address: { opacity: 0.8 },
});
