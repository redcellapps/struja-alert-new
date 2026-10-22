import { Pressable, StyleSheet, View } from 'react-native';
import { haptics } from '../haptics';
import { useTheme } from '../theme';
import { MIN_TOUCH } from '../tokens';
import { AppText } from './AppText';

export interface DayItem {
  // YYYY-MM-DD
  date: string;
  weekday: string;
  dayOfMonth: number;
  hasOutage: boolean;
  // Spoken: "utorak, 4. novembar, ima isključenja".
  accessibilityLabel: string;
}

export interface DayStripProps {
  days: DayItem[];
  selected: string;
  onSelect: (date: string) => void;
}

/** Today and the next three days (EDS publishes four), with a dot on days that have an outage. */
export function DayStrip({ days, selected, onSelect }: DayStripProps) {
  const { colors, radius, spacing } = useTheme();
  const c = colors.chrome;
  return (
    <View style={[styles.row, { gap: spacing.sm }]} accessibilityRole="tablist">
      {days.map((d) => {
        const active = d.date === selected;
        return (
          <Pressable
            key={d.date}
            accessibilityRole="tab"
            accessibilityLabel={d.accessibilityLabel}
            accessibilityState={{ selected: active }}
            onPress={() => {
              haptics.selection();
              onSelect(d.date);
            }}
            style={[
              styles.day,
              {
                minHeight: MIN_TOUCH + 24,
                borderRadius: radius.lg,
                backgroundColor: active ? c.primaryContainer : c.surfaceContainer,
                borderColor: active ? c.primary : 'transparent',
              },
            ]}
          >
            <AppText variant="caption" color={active ? c.onPrimaryContainer : c.onSurfaceVariant}>
              {d.weekday}
            </AppText>
            <AppText variant="title" color={active ? c.onPrimaryContainer : c.onSurface} tabular>
              {String(d.dayOfMonth)}
            </AppText>
            <View
              style={[
                styles.dot,
                { backgroundColor: d.hasOutage ? colors.status.upcoming.accent : 'transparent' },
              ]}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  day: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    paddingVertical: 8,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
});
