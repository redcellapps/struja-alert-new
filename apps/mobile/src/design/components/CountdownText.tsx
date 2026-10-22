import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { clock } from '../../format/duration';
import { useTheme } from '../theme';
import { AppText } from './AppText';

function RollingChar({ ch, color, animate }: { ch: string; color: string; animate: boolean }) {
  const progress = useSharedValue(1);
  const previous = useRef(ch);
  const { motion, typography } = useTheme();
  const shift = typography.countdown.lineHeight * 0.45;
  useEffect(() => {
    if (previous.current === ch) return;
    previous.current = ch;
    if (!animate) return;
    progress.value = 0;
    progress.value = withTiming(1, { duration: motion.duration.base });
  }, [ch, animate, progress, motion.duration.base]);
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * -shift }],
  }));
  return (
    <Animated.View style={style}>
      <AppText variant="countdown" color={color}>
        {ch}
      </AppText>
    </Animated.View>
  );
}

export interface CountdownTextProps {
  // Milliseconds until the event (or until it ends).
  remainingMs: number;
  color: string;
  // A spoken version for TalkBack ("1 čas 12 minuta"): the digits are not read one by one.
  accessibilityLabel: string;
}

/** Big tabular countdown (h:mm:ss) whose digits roll when they change. */
export function CountdownText({ remainingMs, color, accessibilityLabel }: CountdownTextProps) {
  const reduced = useReducedMotion();
  const text = clock(remainingMs);
  return (
    <View
      accessible
      accessibilityRole="timer"
      accessibilityLabel={accessibilityLabel}
      style={styles.row}
    >
      {text.split('').map((ch, i, all) => (
        // keyed from the right, so the seconds digit keeps its identity as the hours appear
        <RollingChar key={all.length - i} ch={ch} color={color} animate={!reduced} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center' } });
