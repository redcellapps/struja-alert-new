import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useTheme } from '../theme';
import type { StatusKey } from '../tokens';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface Blob {
  // Orbit centre and radius in a 100 x 100 box; the phase offsets the blobs from each other.
  cx: number;
  cy: number;
  drift: number;
  r: number;
  phase: number;
  opacity: number;
}

const BLOBS: readonly Blob[] = [
  { cx: 22, cy: 30, drift: 14, r: 52, phase: 0, opacity: 0.55 },
  { cx: 78, cy: 24, drift: 12, r: 46, phase: 0.33, opacity: 0.4 },
  { cx: 55, cy: 82, drift: 16, r: 58, phase: 0.66, opacity: 0.45 },
];

function MeshBlob({ blob, index, animate }: { blob: Blob; index: number; animate: boolean }) {
  const t = useSharedValue(blob.phase);
  const { motion } = useTheme();
  useEffect(() => {
    if (!animate) return;
    t.value = withRepeat(
      withTiming(blob.phase + 1, { duration: motion.duration.mesh, easing: Easing.linear }),
      -1,
      false,
    );
  }, [animate, blob.phase, motion.duration.mesh, t]);
  const props = useAnimatedProps(() => {
    const a = t.value * Math.PI * 2;
    return {
      cx: blob.cx + Math.cos(a) * blob.drift,
      cy: blob.cy + Math.sin(a * (index % 2 === 0 ? 1 : -1)) * blob.drift,
    };
  });
  return <AnimatedCircle animatedProps={props} r={blob.r} fill={`url(#blob${index})`} />;
}

export interface MeshBackgroundProps {
  status: StatusKey;
}

/**
 * The soft, slowly drifting gradient behind the status hero, tinted by the status. Pure decoration:
 * hidden from the accessibility tree, and still when the system asks to remove animations.
 */
export function MeshBackground({ status }: MeshBackgroundProps) {
  const { colors } = useTheme();
  const s = colors.status[status];
  const reduced = useReducedMotion();
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { backgroundColor: s.container }]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          {BLOBS.map((b, i) => (
            <RadialGradient key={i} id={`blob${i}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={s.accent} stopOpacity={b.opacity} />
              <Stop offset="1" stopColor={s.accent} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>
        {BLOBS.map((b, i) => (
          <MeshBlob key={i} blob={b} index={i} animate={!reduced} />
        ))}
      </Svg>
    </View>
  );
}
