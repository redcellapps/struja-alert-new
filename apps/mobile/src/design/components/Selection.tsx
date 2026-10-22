import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { haptics } from '../haptics';
import { useTheme } from '../theme';
import { MIN_TOUCH } from '../tokens';
import { AppText } from './AppText';
import { Icon } from './Icon';

const CHECK = { ios: 'checkmark', android: 'check' };

// ---- Radio rows: full-width selectable rows with a filled lime check circle on the right ----------

export interface RadioRowProps {
  label: string;
  description?: string;
  selected: boolean;
  onSelect: () => void;
}

export function RadioRow({ label, description, selected, onSelect }: RadioRowProps) {
  const { colors, radius } = useTheme();
  const c = colors.chrome;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={description ? `${label}. ${description}` : label}
      accessibilityState={{ checked: selected }}
      onPress={() => {
        haptics.selection();
        onSelect();
      }}
      style={({ pressed }) => [
        styles.row,
        { borderRadius: radius.md, backgroundColor: pressed ? c.raised : c.card, minHeight: 64 },
      ]}
    >
      <View style={styles.rowText}>
        <AppText variant="bodyStrong">{label}</AppText>
        {description ? (
          <AppText variant="label" color="textSecondary">
            {description}
          </AppText>
        ) : null}
      </View>
      <View
        style={[
          styles.circle,
          selected ? { backgroundColor: c.accent } : { borderWidth: 2, borderColor: c.outline },
        ]}
      >
        {selected ? <Icon name={CHECK} size={18} color={c.onAccent} /> : null}
      </View>
    </Pressable>
  );
}

// ---- Checkbox: a rounded square, 24 x 24, filled lime with a dark check ---------------------------

export interface CheckboxRowProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}

export function CheckboxRow({ label, description, checked, onChange }: CheckboxRowProps) {
  const { colors, radius } = useTheme();
  const c = colors.chrome;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={description ? `${label}. ${description}` : label}
      accessibilityState={{ checked }}
      onPress={() => {
        haptics.selection();
        onChange(!checked);
      }}
      style={[styles.plain, { minHeight: MIN_TOUCH + 8 }]}
    >
      <View
        style={[
          styles.box,
          { borderRadius: radius.xs },
          checked ? { backgroundColor: c.accent } : { borderWidth: 2, borderColor: c.outline },
        ]}
      >
        {checked ? <Icon name={CHECK} size={18} color={c.onAccent} /> : null}
      </View>
      <View style={styles.rowText}>
        <AppText variant="bodyStrong">{label}</AppText>
        {description ? (
          <AppText variant="label" color="textSecondary">
            {description}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

// ---- Switch: a pill track, lime when on, with a white thumb ---------------------------------------

export interface SwitchRowProps {
  label: string;
  description?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}

const TRACK_W = 56;
const TRACK_H = 32;
const THUMB = 24;

function SwitchTrack({ value }: { value: boolean }) {
  const { colors, motion } = useTheme();
  const reduced = useReducedMotion();
  const x = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    x.value = reduced
      ? value
        ? 1
        : 0
      : withTiming(value ? 1 : 0, { duration: motion.duration.base });
  }, [value, reduced, x, motion.duration.base]);
  const thumb = useAnimatedStyle(() => ({
    transform: [{ translateX: 4 + x.value * (TRACK_W - THUMB - 8) }],
  }));
  return (
    <View
      style={[
        styles.track,
        { backgroundColor: value ? colors.chrome.accent : colors.chrome.raised },
      ]}
    >
      <Animated.View
        style={[
          styles.thumb,
          { backgroundColor: value ? '#FFFFFF' : colors.chrome.textSecondary },
          value && { borderWidth: 1.5, borderColor: colors.chrome.onAccent + '33' },
          thumb,
        ]}
      />
    </View>
  );
}

export function SwitchRow({ label, description, value, onChange }: SwitchRowProps) {
  const { colors, radius } = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={description ? `${label}. ${description}` : label}
      accessibilityState={{ checked: value }}
      onPress={() => {
        haptics.selection();
        onChange(!value);
      }}
      style={({ pressed }) => [
        styles.row,
        {
          borderRadius: radius.md,
          backgroundColor: pressed ? colors.chrome.raised : colors.chrome.card,
          minHeight: 64,
        },
      ]}
    >
      <View style={styles.rowText}>
        <AppText variant="bodyStrong">{label}</AppText>
        {description ? (
          <AppText variant="label" color="textSecondary">
            {description}
          </AppText>
        ) : null}
      </View>
      <SwitchTrack value={value} />
    </Pressable>
  );
}

// ---- Segmented control: script and theme choices, the selected segment filled ---------------------

export interface SegmentedProps<T extends string> {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  accessibilityLabel: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: SegmentedProps<T>) {
  const { colors, radius } = useTheme();
  const c = colors.chrome;
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={[styles.segments, { backgroundColor: c.raised, borderRadius: radius.md }]}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ checked: selected }}
            onPress={() => {
              haptics.selection();
              onChange(o.value);
            }}
            style={[
              styles.segment,
              { borderRadius: radius.md - 4, backgroundColor: selected ? c.accent : 'transparent' },
            ]}
          >
            <AppText variant="label" color={selected ? c.onAccent : c.text} style={styles.centre}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  plain: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  rowText: { flex: 1, gap: 2 },
  circle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  box: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  track: { width: TRACK_W, height: TRACK_H, borderRadius: TRACK_H / 2, justifyContent: 'center' },
  thumb: { width: THUMB, height: THUMB, borderRadius: THUMB / 2, position: 'absolute', left: 0 },
  segments: { flexDirection: 'row', padding: 4, gap: 4 },
  segment: {
    flex: 1,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  centre: { textAlign: 'center' },
});
